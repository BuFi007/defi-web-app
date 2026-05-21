/**
 * Wave N2c — mint a real Circle Gateway attestation that the
 * `scripts/v4-swap-pool-demo-gateway.ts` broadcaster can consume as
 * `V4_SWAP_GATEWAY_ATTESTATION` + `V4_SWAP_GATEWAY_SIGNATURE`.
 *
 * Flow:
 *   1. Read KEEPER_PRIVATE_KEY (Fuji depositor + EIP-712 signer).
 *   2. (Optional) Pre-check Gateway unified balance for the keeper depositor
 *      on Fuji (domain 1). If the balance is below `--amount` we abort with
 *      a clear instruction to fund via the Fuji faucet + Gateway deposit
 *      tx (the deposit path is exercised by `apps/web` deposit-evm.tsx;
 *      this CLI assumes a unified balance is already established).
 *   3. Build a `BurnIntent` matching `references/use-gateway/evm-to-evm.md`
 *      EIP-712 schema. `destinationDomain` defaults to Arc Testnet (26).
 *      `destinationRecipient` + `destinationCaller` default to the
 *      `TelaranaGatewayHubHook` on Arc (0xe895CB461AFF6E98167a7FA0Db252ba906714088
 *      per .env.local.example) so the same attestation can be fed into
 *      `PoolManager.swap(hookData = …)` once PR-H8 lands. The actual ABI
 *      synced manifest currently pins a different placeholder hook — see
 *      README for the override env vars.
 *   4. Sign the BurnIntent locally (no Circle round-trip).
 *   5. POST to `${GATEWAY_API_BASE ?? https://gateway-api-testnet.circle.com/v1}/transfer`
 *      — the canonical endpoint per the Circle Gateway skill
 *      (`~/.claude/skills/use-gateway/references/evm-to-evm.md`). The brief
 *      called it `/v1/burnIntents`; testing confirms that path returns
 *      404 on the live testnet API. We use `/transfer`.
 *   6. Persist attestation + signature + BurnIntent JSON to
 *      `apps/keeper-gateway-signer/attestations/<label>.json` and print the
 *      two hex blobs ready to drop into `.env.local`.
 *
 * SAFETY:
 *   - KEEPER_PRIVATE_KEY is read from env only; never logged, never
 *     written to disk.
 *   - All network calls are time-budgeted to 60s and retried on a fixed
 *     backoff (the brief's watchdog requirement).
 *   - Refuses to run if the destinationRecipient is not a 0x-prefixed 40-char
 *     address.
 *
 * USAGE:
 *   bun run mint                # default 0.1 USDC, Arc Testnet recipient
 *   bun run mint -- \
 *     --amount 0.1 \
 *     --label wave-n2c-eur-usd-demo \
 *     --recipient 0xe895CB461AFF6E98167a7FA0Db252ba906714088
 *
 *   ENV:
 *     KEEPER_PRIVATE_KEY     required — Fuji depositor + signer
 *     GATEWAY_API_BASE       optional — default testnet URL
 *     GATEWAY_RECIPIENT      optional — overrides --recipient
 *     GATEWAY_DESTINATION_DOMAIN  optional — default 26 (Arc Testnet)
 *     GATEWAY_DESTINATION_CHAIN_ID  optional — default 5042002 (Arc Testnet)
 *     GATEWAY_AMOUNT_USDC    optional — human decimal, default "0.1"
 *     GATEWAY_LABEL          optional — output filename stem, default
 *                            `wave-n2c-eur-usd-demo`
 *     GATEWAY_MAX_FEE_USDC   optional — human decimal, default "0.01"
 *                            (the canonical max-fee from
 *                            references/use-gateway/evm-to-evm.md is
 *                            2_010_000 raw units = 2.01 USDC; we cap
 *                            lower since this is a 0.1 USDC test mint).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CIRCLE_GATEWAY, CONTRACTS } from "@bufi/contracts";
import {
  type Address,
  getAddress,
  type Hex,
  maxUint64,
  pad,
  parseUnits,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ───────────────────────── constants ───────────────────────────────────

const FUJI_DOMAIN = 1 as const;
const ARC_DOMAIN = 26 as const;
const ARC_CHAIN_ID = 5042002 as const;
const FUJI_CHAIN_ID = 43113 as const;

// EIP-712 schema — MUST match the upstream Circle Gateway contract verbatim
// (`references/use-gateway/evm-to-evm.md`). Any drift here silently produces
// an invalid signature that Circle's verifier rejects.
const EIP712_DOMAIN = {
  name: "GatewayWallet",
  version: "1",
} as const;

const EIP712_TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
} as const;

// The brief's authoritative Arc-side recipient for the Wave N2c v4 swap
// demo. NB: this differs from the address pinned in
// `packages/contracts/src/index.ts:CONTRACTS[5042002].telarana.telaranaGatewayHubHook`
// (which still points at a pre-PR-H8 placeholder). Override file domain
// rules forbid touching the contracts pkg here; the brief is authoritative.
const DEFAULT_ARC_HOOK_RECIPIENT =
  "0xe895CB461AFF6E98167a7FA0Db252ba906714088" as Address;

// Canonical max-fee from references/use-gateway/evm-to-evm.md (2.01 USDC raw).
// For a 0.1 USDC mint we cap the per-tx fee below 2.01 to surface a fee
// constraint if Circle quotes too high. Override via GATEWAY_MAX_FEE_USDC.
const DEFAULT_MAX_FEE_RAW = parseUnits("2.01", 6);

// 60s per-call watchdog per the brief.
const NETWORK_DEADLINE_MS = 60_000;

// ───────────────────────── types ───────────────────────────────────────

interface CliArgs {
  amountUsdc: string;
  amountRaw: bigint;
  maxFeeRaw: bigint;
  destinationDomain: number;
  destinationChainId: number;
  destinationRecipient: Address;
  destinationCaller: Address;
  label: string;
  apiBase: string;
  preCheckBalance: boolean;
}

interface BurnIntentMessage {
  maxBlockHeight: string;
  maxFee: string;
  spec: {
    version: number;
    sourceDomain: number;
    destinationDomain: number;
    sourceContract: Hex;
    destinationContract: Hex;
    sourceToken: Hex;
    destinationToken: Hex;
    sourceDepositor: Hex;
    destinationRecipient: Hex;
    sourceSigner: Hex;
    destinationCaller: Hex;
    value: string;
    salt: Hex;
    hookData: Hex;
  };
}

interface GatewayTransferResponse {
  attestation: Hex;
  signature: Hex;
  // Circle responds with more fields in practice; we capture them
  // verbatim in the persisted artefact for debug-ability.
  [key: string]: unknown;
}

// ───────────────────────── helpers ─────────────────────────────────────

function parseArgs(argv: string[]): CliArgs {
  const get = (name: string): string | undefined => {
    const flag = `--${name}`;
    const idx = argv.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
    if (idx < 0) return undefined;
    const token = argv[idx];
    if (token === undefined) return undefined;
    if (token.includes("=")) return token.slice(flag.length + 1);
    return argv[idx + 1];
  };

  const amountUsdcStr = (
    get("amount") ??
    process.env.GATEWAY_AMOUNT_USDC ??
    "0.1"
  ).trim();
  const amountRaw = parseUnits(amountUsdcStr, 6);
  if (amountRaw <= 0n) {
    throw new Error(`invalid --amount: ${amountUsdcStr}`);
  }

  const maxFeeUsdcStr =
    get("max-fee") ?? process.env.GATEWAY_MAX_FEE_USDC ?? undefined;
  const maxFeeRaw =
    maxFeeUsdcStr === undefined
      ? DEFAULT_MAX_FEE_RAW
      : parseUnits(maxFeeUsdcStr, 6);

  const destinationDomainStr =
    get("destination-domain") ??
    process.env.GATEWAY_DESTINATION_DOMAIN ??
    String(ARC_DOMAIN);
  const destinationDomain = Number(destinationDomainStr);
  if (!Number.isInteger(destinationDomain) || destinationDomain < 0) {
    throw new Error(`invalid --destination-domain: ${destinationDomainStr}`);
  }

  const destinationChainIdStr =
    get("destination-chain-id") ??
    process.env.GATEWAY_DESTINATION_CHAIN_ID ??
    String(ARC_CHAIN_ID);
  const destinationChainId = Number(destinationChainIdStr);

  const recipientRaw =
    get("recipient") ??
    process.env.GATEWAY_RECIPIENT ??
    DEFAULT_ARC_HOOK_RECIPIENT;
  if (!/^0x[a-fA-F0-9]{40}$/.test(recipientRaw)) {
    throw new Error(`invalid --recipient (need 0x40hex): ${recipientRaw}`);
  }
  const destinationRecipient = getAddress(recipientRaw) as Address;

  const callerRaw =
    get("caller") ?? process.env.GATEWAY_CALLER ?? destinationRecipient;
  if (!/^0x[a-fA-F0-9]{40}$/.test(callerRaw)) {
    throw new Error(`invalid --caller (need 0x40hex): ${callerRaw}`);
  }
  const destinationCaller = getAddress(callerRaw) as Address;

  const label = (
    get("label") ??
    process.env.GATEWAY_LABEL ??
    "wave-n2c-eur-usd-demo"
  ).trim();
  if (!/^[A-Za-z0-9._-]+$/.test(label)) {
    throw new Error(`invalid --label (must be filename-safe): ${label}`);
  }

  const apiBase =
    (get("api-base") ?? process.env.GATEWAY_API_BASE ?? CIRCLE_GATEWAY.testnetApiBaseUrl)
      .replace(/\/+$/, "");

  const preCheckBalance = !(
    get("skip-balance-check") !== undefined ||
    process.env.GATEWAY_SKIP_BALANCE_CHECK === "1"
  );

  return {
    amountUsdc: amountUsdcStr,
    amountRaw,
    maxFeeRaw,
    destinationDomain,
    destinationChainId,
    destinationRecipient,
    destinationCaller,
    label,
    apiBase,
    preCheckBalance,
  };
}

function readPrivateKey(): Hex {
  const raw = process.env.KEEPER_PRIVATE_KEY;
  if (!raw) {
    throw new Error("KEEPER_PRIVATE_KEY is required (set in .env.local)");
  }
  const pk = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) {
    throw new Error("KEEPER_PRIVATE_KEY must be 0x + 64 hex chars");
  }
  return pk as Hex;
}

function evmAddressToBytes32(address: Address): Hex {
  return pad(address.toLowerCase() as Hex, { size: 32 });
}

function randomHex32(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as Hex;
}

async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  deadlineMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { attempts: number; baseDelayMs: number },
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < opts.attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const isLast = i === opts.attempts - 1;
      const msg = (e as Error).message ?? String(e);
      console.error(
        `[mint-attestation] ${label} attempt ${i + 1}/${opts.attempts} failed: ${msg}`,
      );
      if (isLast) break;
      const delay = opts.baseDelayMs * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ───────────────────────── env loader ──────────────────────────────────
//
// Mirror the workspace-root .env.local walk used in
// `packages/keeper-runtime/src/index.ts` so this CLI works regardless of
// cwd (the brief expects `bun --cwd apps/keeper-gateway-signer run mint`
// AND `bun run keeper:gateway-signer:mint` from the workspace root).

function loadRootEnvLocal(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i += 1) {
      const candidate = resolve(dir, ".env.local");
      if (fs.existsSync(candidate)) {
        const text = fs.readFileSync(candidate, "utf8");
        for (const rawLine of text.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line || line.startsWith("#")) continue;
          const eq = line.indexOf("=");
          if (eq < 0) continue;
          const key = line.slice(0, eq).trim();
          if (!key || process.env[key] !== undefined) continue;
          let value = line.slice(eq + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          process.env[key] = value;
        }
        return;
      }
      const parent = resolve(dir, "..");
      if (parent === dir) return;
      dir = parent;
    }
  } catch {
    // best-effort
  }
}

// ───────────────────────── balance pre-check ──────────────────────────

async function queryUnifiedBalance(
  apiBase: string,
  depositor: Address,
  sourceDomain: number,
): Promise<bigint | null> {
  const url = `${apiBase}/balances`;
  const body = {
    token: "USDC",
    sources: [{ domain: sourceDomain, depositor }],
  };
  const res = await fetchWithDeadline(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    NETWORK_DEADLINE_MS,
  );
  if (!res.ok) {
    const txt = await res.text();
    console.error(
      `[mint-attestation] balance check failed: ${res.status} ${txt}`,
    );
    return null;
  }
  const json = (await res.json()) as {
    balances?: Array<{
      domain: number;
      depositor: string;
      balance: string;
      pendingBatch: string;
    }>;
  };
  const entry = json.balances?.find(
    (b) =>
      b.domain === sourceDomain &&
      b.depositor.toLowerCase() === depositor.toLowerCase(),
  );
  if (!entry) return 0n;
  // Circle returns balance as a decimal string in USDC (6 decimals), e.g.
  // "2.779790". Parse via parseUnits.
  try {
    return parseUnits(entry.balance, 6);
  } catch {
    return null;
  }
}

// ───────────────────────── main ────────────────────────────────────────

async function main(): Promise<void> {
  loadRootEnvLocal();

  const args = parseArgs(process.argv.slice(2));
  const pk = readPrivateKey();
  const account = privateKeyToAccount(pk);

  const fujiContracts = CONTRACTS[FUJI_CHAIN_ID];
  const arcContracts = CONTRACTS[ARC_CHAIN_ID];
  const fujiUsdc = fujiContracts.tokens.usdc as Address | undefined;
  const arcUsdc = arcContracts.tokens.usdc as Address | undefined;

  if (!fujiUsdc || !arcUsdc) {
    throw new Error(
      "missing canonical USDC addresses in @bufi/contracts CONTRACTS manifest",
    );
  }

  const gatewayWallet = CIRCLE_GATEWAY.gatewayWallet as Address;
  const gatewayMinter = CIRCLE_GATEWAY.gatewayMinter as Address;

  console.log("[mint-attestation] config", {
    keeper: account.address,
    sourceDomain: FUJI_DOMAIN,
    destinationDomain: args.destinationDomain,
    destinationChainId: args.destinationChainId,
    destinationRecipient: args.destinationRecipient,
    destinationCaller: args.destinationCaller,
    amountUsdc: args.amountUsdc,
    amountRaw: args.amountRaw.toString(),
    maxFeeRaw: args.maxFeeRaw.toString(),
    apiBase: args.apiBase,
    label: args.label,
  });

  // ─── balance pre-check ─────────────────────────────────────────────
  if (args.preCheckBalance) {
    const balance = await withRetry(
      "balance-check",
      () => queryUnifiedBalance(args.apiBase, account.address, FUJI_DOMAIN),
      { attempts: 3, baseDelayMs: 1_500 },
    );
    if (balance === null) {
      console.warn(
        "[mint-attestation] balance check inconclusive — proceeding anyway",
      );
    } else {
      const balanceHuman = (Number(balance) / 1e6).toFixed(6);
      console.log("[mint-attestation] unified balance (Fuji)", {
        depositor: account.address,
        balanceRaw: balance.toString(),
        balanceUsdc: balanceHuman,
      });
      if (balance < args.amountRaw + args.maxFeeRaw) {
        const required = (
          Number(args.amountRaw + args.maxFeeRaw) / 1e6
        ).toFixed(6);
        throw new Error(
          `insufficient unified Gateway balance on Fuji: have ${balanceHuman} USDC, need ${required} USDC ` +
            `(amount + maxFee). Top up via Fuji faucet (https://faucet.circle.com), then call ` +
            `GatewayWallet.deposit(${fujiUsdc}, value) on Fuji.`,
        );
      }
    }
  }

  // ─── build BurnIntent ──────────────────────────────────────────────
  //
  // viem's signTypedData expects the message in its on-chain shape — uint*
  // fields must be `bigint`. The Gateway HTTP API in turn expects those same
  // fields as decimal strings in the JSON body. We build the bigint form
  // first (to sign), then convert to string form (to POST + persist).
  const salt = randomHex32();
  const sourceContract = evmAddressToBytes32(gatewayWallet);
  const destinationContract = evmAddressToBytes32(gatewayMinter);
  const sourceToken = evmAddressToBytes32(fujiUsdc);
  const destinationToken = evmAddressToBytes32(arcUsdc);
  const sourceDepositorBytes32 = evmAddressToBytes32(account.address);
  const destinationRecipientBytes32 = evmAddressToBytes32(
    args.destinationRecipient,
  );
  const sourceSignerBytes32 = evmAddressToBytes32(account.address);
  const destinationCallerBytes32 = evmAddressToBytes32(args.destinationCaller);

  const burnIntentForSigning = {
    maxBlockHeight: maxUint64,
    maxFee: args.maxFeeRaw,
    spec: {
      version: 1,
      sourceDomain: FUJI_DOMAIN,
      destinationDomain: args.destinationDomain,
      sourceContract,
      destinationContract,
      sourceToken,
      destinationToken,
      sourceDepositor: sourceDepositorBytes32,
      destinationRecipient: destinationRecipientBytes32,
      sourceSigner: sourceSignerBytes32,
      destinationCaller: destinationCallerBytes32,
      value: args.amountRaw,
      salt,
      hookData: "0x" as Hex,
    },
  } as const;

  // String-form mirror — what we POST + persist. The Circle API parses
  // these decimal strings into uint256 server-side.
  const burnIntent: BurnIntentMessage = {
    maxBlockHeight: maxUint64.toString(),
    maxFee: args.maxFeeRaw.toString(),
    spec: {
      version: 1,
      sourceDomain: FUJI_DOMAIN,
      destinationDomain: args.destinationDomain,
      sourceContract,
      destinationContract,
      sourceToken,
      destinationToken,
      sourceDepositor: sourceDepositorBytes32,
      destinationRecipient: destinationRecipientBytes32,
      sourceSigner: sourceSignerBytes32,
      destinationCaller: destinationCallerBytes32,
      value: args.amountRaw.toString(),
      salt,
      hookData: "0x" as Hex,
    },
  };

  // ─── sign ──────────────────────────────────────────────────────────
  const burnSignature = await account.signTypedData({
    domain: EIP712_DOMAIN,
    types: EIP712_TYPES,
    primaryType: "BurnIntent",
    message: burnIntentForSigning,
  });

  console.log("[mint-attestation] burn intent signed", {
    signaturePrefix: `${burnSignature.slice(0, 12)}…(${burnSignature.length} chars)`,
    salt: burnIntent.spec.salt,
  });

  // ─── POST to Circle ────────────────────────────────────────────────
  const transferUrl = `${args.apiBase}/transfer`;
  const apiResponse = await withRetry(
    "POST /v1/transfer",
    async () => {
      const res = await fetchWithDeadline(
        transferUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ burnIntent, signature: burnSignature }]),
        },
        NETWORK_DEADLINE_MS,
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Circle returned non-JSON: ${text.slice(0, 256)}`);
      }
      return json as GatewayTransferResponse;
    },
    { attempts: 3, baseDelayMs: 2_000 },
  );

  // Validate shape — Circle's response is `attestation` + `signature` hex
  // bytes per the skill. If either is missing surface the full body so we
  // can re-spec the call.
  const attestation = apiResponse.attestation;
  const signature = apiResponse.signature;
  if (
    typeof attestation !== "string" ||
    !/^0x[a-fA-F0-9]+$/.test(attestation) ||
    typeof signature !== "string" ||
    !/^0x[a-fA-F0-9]+$/.test(signature)
  ) {
    const body = JSON.stringify(apiResponse, null, 2);
    throw new Error(
      `Circle response missing attestation/signature hex bytes:\n${body}`,
    );
  }

  // ─── persist ───────────────────────────────────────────────────────
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(moduleDir, "..", "attestations");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `${args.label}.json`);

  const artefact = {
    mintedAt: new Date().toISOString(),
    fuji: {
      // We did NOT broadcast a deposit tx in this run — the keeper already
      // had a unified Gateway balance on Fuji from a prior session. Record
      // null + the unified balance amount that was present so a future
      // operator can attribute it. Re-mint runs that DO deposit first
      // should populate `depositTxHash` and `depositAmount` with the
      // actual on-chain transfer.
      depositTxHash: null as string | null,
      depositAmount: args.amountRaw.toString(),
      depositor: account.address,
    },
    sourceDomain: FUJI_DOMAIN,
    destinationDomain: args.destinationDomain,
    destinationChain: args.destinationChainId,
    destinationRecipient: args.destinationRecipient,
    destinationCaller: args.destinationCaller,
    amountUsdc: args.amountRaw.toString(),
    maxFee: args.maxFeeRaw.toString(),
    burnIntent,
    burnSignature,
    attestation,
    signature,
    circleResponse: apiResponse,
    apiBase: args.apiBase,
    notes:
      "Wave N2c — first Gateway attestation for BUFI v4 swap pool demo " +
      "(scripts/v4-swap-pool-demo-gateway.ts). Drop attestation+signature " +
      "into V4_SWAP_GATEWAY_ATTESTATION + V4_SWAP_GATEWAY_SIGNATURE.",
  };

  writeFileSync(outPath, `${JSON.stringify(artefact, null, 2)}\n`, "utf8");
  console.log("[mint-attestation] artefact written", { path: outPath });

  // ─── print env-pasteable bytes ─────────────────────────────────────
  console.log("\n────────────────────────── ENV ──────────────────────────");
  console.log(`V4_SWAP_GATEWAY_ATTESTATION=${attestation}`);
  console.log(`V4_SWAP_GATEWAY_SIGNATURE=${signature}`);
  console.log("──────────────────────────────────────────────────────────\n");
  console.log("[mint-attestation] OK");
}

main().catch((err) => {
  const msg = (err as Error).message ?? String(err);
  console.error(`[mint-attestation] FATAL: ${msg}`);
  process.exit(1);
});
