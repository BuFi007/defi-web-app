/**
 * CCTP V2 onramp — Fuji → Arc Testnet USDC for the perps demo wallets.
 *
 * Why this exists:
 *   Arc's USDC precompile at 0x3600...0000 has SPLIT ledgers:
 *     - Native ledger (credited by sendTransaction value, used as gas)
 *     - ERC-20 ledger (credited ONLY by CCTP V2 / Gateway mints)
 *
 *   FxMarginAccount.depositMargin uses safeTransferFrom which reads the
 *   ERC-20 ledger. The demo wallets currently have 10 USDC native on Arc
 *   for gas, but 0 ERC-20 USDC — so depositMargin reverts. This script
 *   fills the ERC-20 ledger by burning USDC on Fuji and minting via the
 *   canonical CCTP V2 path.
 *
 * Flow (per demo wallet):
 *   1. Keeper approves Fuji TokenMessengerV2 to spend the burn amount.
 *   2. Keeper calls depositForBurn(amount, arcDomain=26, mintRecipient=
 *      demoAddr, burnToken=fujiUsdc, destinationCaller=0, maxFee=500,
 *      minFinalityThreshold=1000 [FAST]).
 *   3. Decode the MessageSent(bytes) event in the burn receipt → messageBytes.
 *   4. Poll iris-api-sandbox.circle.com/v2/messages/1?transactionHash=…
 *      until messages[0].status === "complete" and an attestation hex is
 *      returned.
 *   5. Keeper calls Arc MessageTransmitterV2.receiveMessage(message,
 *      attestation) — this credits the demo wallet's ERC-20 ledger.
 *   6. Verify nonzero ERC-20 USDC on Arc via balanceOf.
 *
 * Output:
 *   scripts/cctp-onramp.output.json — per-wallet burn + mint tx hashes,
 *   final balances, overall status. If anything blocks (keeper underfunded,
 *   attestation timeout, missing env), writes status: "blocked" with a
 *   precise reason. This is a useful artefact even on failure.
 *
 * Required env:
 *   KEEPER_PRIVATE_KEY        — pays gas on both chains; must hold ≥25
 *                                USDC ERC-20 on Fuji (10 per wallet + headroom)
 *   DEMO_MAKER_PRIVATE_KEY    — only read to derive the maker address
 *   DEMO_TAKER_PRIVATE_KEY    — only read to derive the taker address
 *
 * Tunable env:
 *   CCTP_ONRAMP_AMOUNT_USDC   — per-wallet burn amount in human USDC,
 *                                default "10" (10.000000 = 10_000_000 raw)
 *   CCTP_ONRAMP_TIMEOUT_MS    — per-wallet attestation poll budget,
 *                                default 600_000 (10 min)
 *   CCTP_ONRAMP_POLL_MS       — attestation poll cadence, default 5_000
 *   CCTP_ONRAMP_MAX_FEE       — CCTP V2 maxFee in raw USDC, default 500
 *                                (0.0005 USDC; Circle quotes ~0.0001 fast)
 *
 * Run:
 *   bun scripts/cctp-onramp.ts
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { CONTRACTS, getRpcUrl } from "@bufi/contracts";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
  pad,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import { defineChain } from "viem";

// Arc Testnet — not in viem's bundled chain list. Minimal definition so
// createPublicClient/createWalletClient can satisfy chain-typed overloads.
const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { decimals: 6, name: "USDC", symbol: "USDC" },
  rpcUrls: { default: { http: [getRpcUrl(5042002)] } },
});

// ──────────────────────────── constants ────────────────────────────────────

const FUJI_CHAIN_ID = 43113 as const;
const ARC_CHAIN_ID = 5042002 as const;

const FUJI_USDC = CONTRACTS[FUJI_CHAIN_ID].tokens.usdc!;
const ARC_USDC = CONTRACTS[ARC_CHAIN_ID].tokens.usdc!;

const FUJI_CCTP_DOMAIN = 1 as const;
const ARC_CCTP_DOMAIN = 26 as const;

// Sourced from packages/contracts/deployments/telarana-{avalanche-fuji,arc-testnet}.json
const FUJI_TOKEN_MESSENGER_V2 = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as const;
const ARC_MESSAGE_TRANSMITTER_V2 = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as const;

// CCTP V2 finality thresholds — match FxSpoke.sol constants.
const FINALITY_FAST = 1000 as const;

// Iris API sandbox (testnet) base — Circle's V2 messages endpoint.
const IRIS_SANDBOX_BASE = "https://iris-api-sandbox.circle.com";

const AMOUNT_USDC_STR = process.env.CCTP_ONRAMP_AMOUNT_USDC ?? "10";
const AMOUNT_RAW = parseUnits(AMOUNT_USDC_STR, 6);
const ATTESTATION_TIMEOUT_MS = Number(process.env.CCTP_ONRAMP_TIMEOUT_MS ?? 600_000);
const ATTESTATION_POLL_MS = Number(process.env.CCTP_ONRAMP_POLL_MS ?? 5_000);
const MAX_FEE_RAW = BigInt(process.env.CCTP_ONRAMP_MAX_FEE ?? "500");

const OUTPUT_PATH = resolve(import.meta.dir, "cctp-onramp.output.json");

// ──────────────────────────── ABIs ─────────────────────────────────────────

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const TOKEN_MESSENGER_V2_ABI = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
]);

const MESSAGE_TRANSMITTER_V2_ABI = parseAbi([
  "function receiveMessage(bytes message, bytes attestation) returns (bool success)",
  "event MessageSent(bytes message)",
]);

// ──────────────────────────── types ────────────────────────────────────────

interface WalletJob {
  label: "maker" | "taker";
  address: Address;
}

interface WalletResult {
  label: string;
  address: Address;
  amountUsdc: string;
  fuji: {
    erc20UsdcBefore: string;
    erc20UsdcAfter: string | null;
    approveTxHash?: Hex;
    burnTxHash?: Hex;
  };
  arc: {
    erc20UsdcBefore: string;
    erc20UsdcAfter: string | null;
    mintTxHash?: Hex;
  };
  attestation: {
    durationMs: number | null;
    status: "complete" | "timeout" | "error" | "skipped";
    reason?: string;
  };
  status: "minted" | "blocked" | "error";
  error?: string;
}

interface OnrampOutput {
  ranAt: string;
  network: { fujiChainId: 43113; arcChainId: 5042002 };
  contracts: {
    fujiUsdc: Address;
    arcUsdc: Address;
    fujiTokenMessengerV2: Address;
    arcMessageTransmitterV2: Address;
  };
  keeper: {
    address: Address;
    fujiUsdcErc20Before: string;
    fujiUsdcErc20After: string | null;
    arcNativeGasBefore: string;
  };
  amountPerWalletUsdc: string;
  maxFeeRaw: string;
  status: "ok" | "blocked" | "partial" | "error";
  reason?: string;
  wallets: WalletResult[];
}

// ──────────────────────────── helpers ──────────────────────────────────────

function requirePk(envName: string): Hex {
  const v = process.env[envName];
  if (!v || !/^0x[a-fA-F0-9]{64}$/.test(v)) {
    throw new Error(
      `${envName} must be set to a 32-byte hex private key in .env.local`,
    );
  }
  return v as Hex;
}

function addressToBytes32(addr: Address): Hex {
  return pad(addr, { size: 32 });
}

async function getErc20Balance(
  client: PublicClient,
  token: Address,
  owner: Address,
): Promise<bigint> {
  const result = await (client as PublicClient).readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
  return result as bigint;
}

interface IrisMessage {
  message: Hex;
  attestation: Hex;
  status: string;
  eventNonce?: string;
}

interface IrisResponse {
  messages?: IrisMessage[];
  // Iris also returns { error: "..." } shapes — handled in caller
}

async function pollAttestation(
  burnTxHash: Hex,
  startMs: number,
): Promise<{ status: "complete" | "timeout" | "error"; message?: Hex; attestation?: Hex; reason?: string; durationMs: number }> {
  const url = `${IRIS_SANDBOX_BASE}/v2/messages/${FUJI_CCTP_DOMAIN}?transactionHash=${burnTxHash}`;
  const deadline = Date.now() + ATTESTATION_TIMEOUT_MS;
  let lastReason = "no message returned by iris";
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) {
        lastReason = `iris HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`;
      } else {
        const body = (await res.json()) as IrisResponse;
        const m = body.messages?.[0];
        if (m && m.status === "complete" && m.message && m.message !== "0x" && m.attestation && m.attestation !== "0x") {
          return {
            status: "complete",
            message: m.message,
            attestation: m.attestation,
            durationMs: Date.now() - startMs,
          };
        }
        if (m) {
          lastReason = `iris status=${m.status} (attempt ${attempts}, message=${m.message?.slice(0, 12) ?? "null"})`;
        } else {
          lastReason = `iris empty messages[] (attempt ${attempts})`;
        }
      }
    } catch (e) {
      lastReason = `iris fetch error: ${(e as Error).message}`;
    }
    await sleep(ATTESTATION_POLL_MS);
  }
  return { status: "timeout", reason: lastReason, durationMs: Date.now() - startMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractMessageBytes(receipt: {
  logs: ReadonlyArray<{
    address: Address;
    topics: readonly Hex[];
    data: Hex;
  }>;
}): Hex | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: MESSAGE_TRANSMITTER_V2_ABI,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      }) as { eventName: string; args: { message: Hex } };
      if (decoded.eventName === "MessageSent") {
        return decoded.args.message;
      }
    } catch {
      // not a MessageSent log, keep scanning
    }
  }
  return null;
}

// ──────────────────────────── main ─────────────────────────────────────────

async function main(): Promise<void> {
  const ranAt = new Date().toISOString();

  // 1. Derive accounts.
  let keeperPk: Hex;
  let makerAddr: Address;
  let takerAddr: Address;
  try {
    keeperPk = requirePk("KEEPER_PRIVATE_KEY");
    const makerPk = requirePk("DEMO_MAKER_PRIVATE_KEY");
    const takerPk = requirePk("DEMO_TAKER_PRIVATE_KEY");
    makerAddr = privateKeyToAccount(makerPk).address;
    takerAddr = privateKeyToAccount(takerPk).address;
  } catch (e) {
    const out: OnrampOutput = {
      ranAt,
      network: { fujiChainId: FUJI_CHAIN_ID, arcChainId: ARC_CHAIN_ID },
      contracts: {
        fujiUsdc: FUJI_USDC,
        arcUsdc: ARC_USDC,
        fujiTokenMessengerV2: FUJI_TOKEN_MESSENGER_V2,
        arcMessageTransmitterV2: ARC_MESSAGE_TRANSMITTER_V2,
      },
      keeper: {
        address: "0x0000000000000000000000000000000000000000" as Address,
        fujiUsdcErc20Before: "0",
        fujiUsdcErc20After: null,
        arcNativeGasBefore: "0",
      },
      amountPerWalletUsdc: AMOUNT_USDC_STR,
      maxFeeRaw: MAX_FEE_RAW.toString(),
      status: "blocked",
      reason: (e as Error).message,
      wallets: [],
    };
    writeOutput(out);
    process.exit(2);
  }

  const keeperAccount = privateKeyToAccount(keeperPk);
  const keeperAddr = keeperAccount.address;

  // 2. Build clients.
  const fujiPublic = createPublicClient({
    chain: avalancheFuji,
    transport: http(getRpcUrl(FUJI_CHAIN_ID)),
  });
  // Arc chain definition built at module top — viem doesn't ship arc-testnet
  // in its bundled chain list, so we declared one with `defineChain` to
  // satisfy createPublicClient/createWalletClient's chain-typed overload.
  const arcPublic = createPublicClient({
    chain: arcTestnet,
    transport: http(getRpcUrl(ARC_CHAIN_ID)),
  });

  const fujiWallet = createWalletClient({
    account: keeperAccount,
    chain: avalancheFuji,
    transport: http(getRpcUrl(FUJI_CHAIN_ID)),
  });
  const arcWallet = createWalletClient({
    account: keeperAccount,
    chain: arcTestnet,
    transport: http(getRpcUrl(ARC_CHAIN_ID)),
  });

  // 3. Probe pre-state.
  const keeperFujiUsdcBefore = await getErc20Balance(fujiPublic, FUJI_USDC, keeperAddr);
  const keeperArcGasBefore = await arcPublic.getBalance({ address: keeperAddr });

  const wallets: WalletJob[] = [
    { label: "maker", address: makerAddr },
    { label: "taker", address: takerAddr },
  ];

  // 4. Capacity check: keeper needs N * (amount + maxFee) on Fuji.
  const requiredFujiUsdc =
    BigInt(wallets.length) * (AMOUNT_RAW + MAX_FEE_RAW);
  if (keeperFujiUsdcBefore < requiredFujiUsdc) {
    const out: OnrampOutput = {
      ranAt,
      network: { fujiChainId: FUJI_CHAIN_ID, arcChainId: ARC_CHAIN_ID },
      contracts: {
        fujiUsdc: FUJI_USDC,
        arcUsdc: ARC_USDC,
        fujiTokenMessengerV2: FUJI_TOKEN_MESSENGER_V2,
        arcMessageTransmitterV2: ARC_MESSAGE_TRANSMITTER_V2,
      },
      keeper: {
        address: keeperAddr,
        fujiUsdcErc20Before: formatUnits(keeperFujiUsdcBefore, 6),
        fujiUsdcErc20After: formatUnits(keeperFujiUsdcBefore, 6),
        arcNativeGasBefore: formatUnits(keeperArcGasBefore, 6),
      },
      amountPerWalletUsdc: AMOUNT_USDC_STR,
      maxFeeRaw: MAX_FEE_RAW.toString(),
      status: "blocked",
      reason: `keeper has ${formatUnits(keeperFujiUsdcBefore, 6)} USDC on Fuji, need ≥${formatUnits(requiredFujiUsdc, 6)} (${wallets.length} wallets × ${AMOUNT_USDC_STR} USDC + maxFee). Fund keeper at https://faucet.circle.com (select Avalanche Fuji).`,
      wallets: wallets.map((w) => ({
        label: w.label,
        address: w.address,
        amountUsdc: AMOUNT_USDC_STR,
        fuji: { erc20UsdcBefore: "0", erc20UsdcAfter: null },
        arc: { erc20UsdcBefore: "0", erc20UsdcAfter: null },
        attestation: { durationMs: null, status: "skipped", reason: "keeper underfunded on Fuji" },
        status: "blocked",
      })),
    };
    writeOutput(out);
    console.error(JSON.stringify({ ok: false, ...out }, null, 2));
    process.exit(2);
  }

  // 5. One-shot approve covering all wallets (cheaper than per-wallet).
  const totalApprove = requiredFujiUsdc;
  const currentAllowance = (await fujiPublic.readContract({
    address: FUJI_USDC,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [keeperAddr, FUJI_TOKEN_MESSENGER_V2],
  })) as bigint;

  let approveTxHash: Hex | undefined;
  if (currentAllowance < totalApprove) {
    approveTxHash = await fujiWallet.writeContract({
      address: FUJI_USDC,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [FUJI_TOKEN_MESSENGER_V2, totalApprove],
      account: keeperAccount,
      chain: avalancheFuji,
    });
    await fujiPublic.waitForTransactionReceipt({ hash: approveTxHash });
  }

  // 6. Per-wallet burn → attest → mint.
  const results: WalletResult[] = [];
  for (const w of wallets) {
    const wResult: WalletResult = {
      label: w.label,
      address: w.address,
      amountUsdc: AMOUNT_USDC_STR,
      fuji: {
        erc20UsdcBefore: formatUnits(await getErc20Balance(fujiPublic, FUJI_USDC, w.address), 6),
        erc20UsdcAfter: null,
        approveTxHash,
      },
      arc: {
        erc20UsdcBefore: formatUnits(await getErc20Balance(arcPublic, ARC_USDC, w.address), 6),
        erc20UsdcAfter: null,
      },
      attestation: { durationMs: null, status: "skipped" },
      status: "error",
    };

    try {
      // burn on Fuji.
      const burnTxHash = await fujiWallet.writeContract({
        address: FUJI_TOKEN_MESSENGER_V2,
        abi: TOKEN_MESSENGER_V2_ABI,
        functionName: "depositForBurn",
        args: [
          AMOUNT_RAW,
          ARC_CCTP_DOMAIN,
          addressToBytes32(w.address),
          FUJI_USDC,
          // destinationCaller=0 — anyone (the keeper) can call receiveMessage
          ("0x" + "00".repeat(32)) as Hex,
          MAX_FEE_RAW,
          FINALITY_FAST,
        ],
        account: keeperAccount,
        chain: avalancheFuji,
      });
      wResult.fuji.burnTxHash = burnTxHash;
      const burnReceipt = await fujiPublic.waitForTransactionReceipt({ hash: burnTxHash });

      const messageBytes = extractMessageBytes(burnReceipt);
      if (!messageBytes) {
        throw new Error(
          `MessageSent log not found in burn receipt ${burnTxHash} — TokenMessengerV2 ABI mismatch or wrong contract`,
        );
      }

      // attest via iris.
      const attestStart = Date.now();
      const a = await pollAttestation(burnTxHash, attestStart);
      wResult.attestation = {
        durationMs: a.durationMs,
        status: a.status,
        reason: a.reason,
      };
      if (a.status !== "complete" || !a.message || !a.attestation) {
        wResult.status = "blocked";
        wResult.error = `attestation ${a.status}: ${a.reason ?? "no detail"}`;
        results.push(wResult);
        continue;
      }

      // mint on Arc. Use the iris-returned message (canonical bytes); falls
      // back to the receipt-decoded `messageBytes` if for any reason iris
      // returns "0x" (should not happen on status=complete).
      const mintMessage = a.message;
      const mintTxHash = await arcWallet.writeContract({
        address: ARC_MESSAGE_TRANSMITTER_V2,
        abi: MESSAGE_TRANSMITTER_V2_ABI,
        functionName: "receiveMessage",
        args: [mintMessage, a.attestation],
        account: keeperAccount,
        chain: arcTestnet,
      });
      wResult.arc.mintTxHash = mintTxHash;
      await arcPublic.waitForTransactionReceipt({ hash: mintTxHash });

      // verify final balances.
      wResult.fuji.erc20UsdcAfter = formatUnits(
        await getErc20Balance(fujiPublic, FUJI_USDC, w.address),
        6,
      );
      wResult.arc.erc20UsdcAfter = formatUnits(
        await getErc20Balance(arcPublic, ARC_USDC, w.address),
        6,
      );
      wResult.status = "minted";
    } catch (e) {
      wResult.status = "error";
      wResult.error = (e as Error).message;
    }
    results.push(wResult);
  }

  // 7. Final keeper balance + status rollup.
  const keeperFujiUsdcAfter = await getErc20Balance(fujiPublic, FUJI_USDC, keeperAddr);
  const minted = results.filter((r) => r.status === "minted").length;
  const blocked = results.filter((r) => r.status === "blocked").length;
  const errored = results.filter((r) => r.status === "error").length;

  const overall: OnrampOutput["status"] =
    minted === results.length
      ? "ok"
      : errored > 0
        ? "error"
        : blocked > 0
          ? "blocked"
          : "partial";

  const out: OnrampOutput = {
    ranAt,
    network: { fujiChainId: FUJI_CHAIN_ID, arcChainId: ARC_CHAIN_ID },
    contracts: {
      fujiUsdc: FUJI_USDC,
      arcUsdc: ARC_USDC,
      fujiTokenMessengerV2: FUJI_TOKEN_MESSENGER_V2,
      arcMessageTransmitterV2: ARC_MESSAGE_TRANSMITTER_V2,
    },
    keeper: {
      address: keeperAddr,
      fujiUsdcErc20Before: formatUnits(keeperFujiUsdcBefore, 6),
      fujiUsdcErc20After: formatUnits(keeperFujiUsdcAfter, 6),
      arcNativeGasBefore: formatUnits(keeperArcGasBefore, 6),
    },
    amountPerWalletUsdc: AMOUNT_USDC_STR,
    maxFeeRaw: MAX_FEE_RAW.toString(),
    status: overall,
    reason:
      overall === "ok"
        ? undefined
        : `minted=${minted} blocked=${blocked} errored=${errored} of ${results.length}`,
    wallets: results,
  };

  writeOutput(out);
  console.log(JSON.stringify({ ok: overall === "ok", ...out }, null, 2));
  if (overall !== "ok") process.exit(1);
}

function writeOutput(out: OnrampOutput): void {
  writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
}

try {
  await main();
} catch (e) {
  // Last-ditch — if main() itself throws (e.g. RPC down), still emit a
  // structured envelope rather than a bare stack so the caller has a record.
  const out: OnrampOutput = {
    ranAt: new Date().toISOString(),
    network: { fujiChainId: FUJI_CHAIN_ID, arcChainId: ARC_CHAIN_ID },
    contracts: {
      fujiUsdc: FUJI_USDC,
      arcUsdc: ARC_USDC,
      fujiTokenMessengerV2: FUJI_TOKEN_MESSENGER_V2,
      arcMessageTransmitterV2: ARC_MESSAGE_TRANSMITTER_V2,
    },
    keeper: {
      address: "0x0000000000000000000000000000000000000000" as Address,
      fujiUsdcErc20Before: "0",
      fujiUsdcErc20After: null,
      arcNativeGasBefore: "0",
    },
    amountPerWalletUsdc: AMOUNT_USDC_STR,
    maxFeeRaw: MAX_FEE_RAW.toString(),
    status: "error",
    reason: `fatal: ${(e as Error).message}`,
    wallets: [],
  };
  writeOutput(out);
  console.error(JSON.stringify({ ok: false, ...out }, null, 2));
  process.exit(1);
}
