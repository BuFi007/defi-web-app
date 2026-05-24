/**
 * Wave K2 / PR-H2 — Real-Time FX Swap Pool demo (CCTP V2 attestation routed
 * under the hood). Mirrors the shape of `scripts/perps-demo-trade.ts` and
 * `scripts/cctp-onramp.ts`.
 *
 * What it does
 * ────────────
 * 1. Drives a real cross-chain USDC inflow Fuji → Arc via the canonical
 *    CCTP V2 path:
 *      - TokenMessengerV2.depositForBurn  on Fuji
 *      - Circle Iris attestation poll
 *      - MessageTransmitterV2.receiveMessage on Arc
 *    (Same primitives as `scripts/cctp-onramp.ts`; this is the
 *    "CCTP attestation routed under the hood" leg.)
 *
 * 2. On Arc Testnet, attempts to drive a v4 FX swap through the Uniswap
 *    v4 PoolManager (0x3FA22b…3B34) with `FxSwapHook` attached (the
 *    FX-Telaraña v4 hook). The shape this targets is:
 *
 *      taker (Arc-side, holds USDC just minted by CCTP)
 *        → calls Bufx Telarana Request Router (Arc) `submitTelaranaRequest`
 *        → which writes a GatewayMintContext for the v4 hook to consume
 *        → which the hook's `beforeSwap` reads to route liquidity
 *        → and the FxSpotExecutor settles into EURC on Arc
 *
 * 3. Stub-clearly the steps that aren't deployed yet:
 *    - The hub repo (`fx-telarana`) ships `FxSwapHook.sol` and
 *      `TelaranaGatewayHubHook.sol`, BUT the canonical `FxSwapHook` ABI
 *      isn't synced into `packages/contracts/src/abis/` yet — that's
 *      Wave K1's deliverable. We define a minimal `parseAbi` inline
 *      here with a TODO referencing K1, OR fall back to a direct
 *      executor settlement path (`FxSpotExecutor.executeSpotFx`).
 *
 * Required env (load order: MAKER_PRIVATE_KEY → DEMO_MAKER_PRIVATE_KEY,
 *               same for TAKER, KEEPER):
 *   - KEEPER_PRIVATE_KEY   (pays gas Fuji + Arc; receives CCTP attestation
 *                           and submits the receiveMessage mint on Arc)
 *   - MAKER_PRIVATE_KEY    (FX liquidity provider on Arc; in this demo
 *                           the maker is the FxSpotExecutor reserve
 *                           operator — for the v0.1 wire he's just a
 *                           balance probe)
 *   - TAKER_PRIVATE_KEY    (the FX swap requester — USDC on Fuji,
 *                           receives EURC on Arc)
 *
 * Tunable env:
 *   - V4_SWAP_AMOUNT_USDC       per-swap burn amount (human USDC). Default "1".
 *   - V4_SWAP_TARGET_TOKEN      "EURC" | "JPYC" | "MXNB" | "CHFC". Default EURC.
 *   - V4_SWAP_DRY_RUN           "true" → exit cleanly after dry-run probe.
 *                                Default "true" so the script is build-safe
 *                                in CI with no funded wallets. Set
 *                                "false" to actually broadcast.
 *   - V4_SWAP_SKIP_CCTP         "true" → skip the Fuji→Arc CCTP leg and
 *                                use whatever USDC the taker already has
 *                                on Arc. Default "false".
 *   - V4_SWAP_TIMEOUT_MS        attestation poll budget. Default 600_000.
 *   - V4_SWAP_POLL_MS           attestation poll cadence. Default 5_000.
 *   - V4_SWAP_MAX_FEE           CCTP V2 maxFee in raw USDC. Default 500.
 *   - V4_SWAP_DEADLINE_SEC      Telarana request deadline horizon. Default 600.
 *
 * Output:
 *   scripts/v4-swap-pool-demo-cctp.output.json — full artefact incl. tx
 *   hashes, dry-run summary, and "stubbed" markers for any step that
 *   currently can't be driven end-to-end on chain.
 *
 * Run:
 *   bun run demo:v4-swap-pool-cctp
 *     # dry-run by default — safe with no funded wallets
 *   V4_SWAP_DRY_RUN=false bun run demo:v4-swap-pool-cctp
 *     # actually broadcasts (Fuji burn → Iris → Arc mint → Arc swap intent)
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buFxTelaranaRequestRouterAbi,
  CIRCLE_GATEWAY,
  CONTRACTS,
  DEFAULT_RPC_URLS,
  LIVE_ROUTE_IDS,
  SPOT_FX_ROUTES,
  type SpotFxSymbol,
  TelaranaGatewayHubHookAbi,
} from "@bufi/contracts";
import { BENTO_DEPLOYMENTS } from "@bufi/contracts/bento";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  formatUnits,
  type Hex,
  http,
  pad,
  parseAbi,
  parseUnits,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";

// ─────────────────────────── constants ──────────────────────────────────

const FUJI_CHAIN_ID = 43113 as const;
const ARC_CHAIN_ID = 5042002 as const;
const ARC_CCTP_DOMAIN = 26 as const;
const FUJI_CCTP_DOMAIN = 1 as const;

// CCTP V2 contracts on Fuji + Arc — canonical addresses, mirrored from
// scripts/cctp-onramp.ts. Pinned here (instead of imported) so this script
// remains self-contained against telarana deployment manifest drift.
const FUJI_TOKEN_MESSENGER_V2 =
  "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as const;
const ARC_MESSAGE_TRANSMITTER_V2 =
  "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as const;

const FINALITY_FAST = 1000 as const;
const IRIS_SANDBOX_BASE = "https://iris-api-sandbox.circle.com";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(SCRIPT_DIR, "v4-swap-pool-demo-cctp.output.json");
const ARC_EXPLORER_BASE = "https://testnet.arcscan.app/tx/";
const FUJI_EXPLORER_BASE = "https://testnet.snowtrace.io/tx/";

// Telarana HubAction enum values — derived from
// `BuFxRequestTypes.HubAction` in fx-telarana. Position 1 = SPOT_FX.
const HUB_ACTION_SPOT_FX = 1 as const;

// ─────────────────────────── env knobs ──────────────────────────────────

const AMOUNT_USDC_STR = process.env.V4_SWAP_AMOUNT_USDC ?? "1";
const AMOUNT_RAW = parseUnits(AMOUNT_USDC_STR, 6);
const TARGET_TOKEN = (process.env.V4_SWAP_TARGET_TOKEN ??
  "EURC") as SpotFxSymbol;
const DRY_RUN = (process.env.V4_SWAP_DRY_RUN ?? "true").toLowerCase() === "true";
const SKIP_CCTP =
  (process.env.V4_SWAP_SKIP_CCTP ?? "false").toLowerCase() === "true";
const ATTESTATION_TIMEOUT_MS = Number(
  process.env.V4_SWAP_TIMEOUT_MS ?? 600_000,
);
const ATTESTATION_POLL_MS = Number(process.env.V4_SWAP_POLL_MS ?? 5_000);
const MAX_FEE_RAW = BigInt(process.env.V4_SWAP_MAX_FEE ?? "500");
const DEADLINE_HORIZON_SEC = Number(process.env.V4_SWAP_DEADLINE_SEC ?? 600);

// ─────────────────────────── ABIs (inline) ──────────────────────────────

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

// TODO (Wave K1 — sync-abis.mjs): the canonical `FxSwapHook` ABI from
// `fx-telarana/contracts/src/hub/FxSwapHook.sol` is not in
// `packages/contracts/src/abis/` yet. Until K1 lands, we hold a minimal
// signature shape inline. The function-name / shape below is provisional
// and the script will print "stub: waiting on FxSwapHook ABI sync (K1)"
// if it can't drive a real beforeSwap-routed swap.
//
// What we expect K1 to produce:
//   function fxSwap(
//     PoolKey calldata key,
//     SwapParams calldata params,
//     bytes calldata hookData
//   ) external returns (BalanceDelta delta);
// — driven through `IPoolManager.unlock` + `swap`, with the hook reading
// the GatewayMintContext from `hookData`.
const FX_SWAP_HOOK_ABI_STUB = parseAbi([
  // intentionally narrow surface; we never *call* this in the current
  // script — it's a marker for what K1 needs to land.
  "function isFxSwapHook() view returns (bool)",
]);

// Uniswap v4 PoolManager — minimal probe surface (we only readContract
// `extsload` to confirm the contract is alive; the real `swap` path goes
// through `unlock` and would be wired by K1's ABI sync.)
const POOL_MANAGER_PROBE_ABI = parseAbi([
  "function extsload(bytes32 slot) view returns (bytes32)",
]);

// ─────────────────────────── types ──────────────────────────────────────

interface DemoOutput {
  ranAt: string;
  status:
    | "ok"
    | "ok-stubbed"
    | "blocked"
    | "dry-run"
    | "error";
  reason?: string;
  dryRun: boolean;
  network: {
    sourceChainId: typeof FUJI_CHAIN_ID;
    destinationChainId: typeof ARC_CHAIN_ID;
    cctp: {
      sourceDomain: typeof FUJI_CCTP_DOMAIN;
      destinationDomain: typeof ARC_CCTP_DOMAIN;
      tokenMessengerV2: Address;
      messageTransmitterV2: Address;
      iris: string;
    };
    arc: {
      poolManager: Address | null;
      telaranaGatewayHubHook: Address | null;
      bufxTelaranaRequestRouter: Address | null;
      fxSpotExecutor: Address | null;
      usdc: Address | null;
      targetTokenSymbol: SpotFxSymbol;
      targetTokenAddress: Address | null;
      spotRouteId: Hex;
    };
    fuji: {
      usdc: Address | null;
    };
  };
  actors: {
    keeper: { address: Address };
    maker: { address: Address };
    taker: { address: Address };
  };
  amountUsdc: string;
  amountRaw: string;
  steps: Array<DemoStep>;
  balances: {
    takerArcUsdcBefore: string | null;
    takerArcUsdcAfter: string | null;
    takerArcTargetBefore: string | null;
    takerArcTargetAfter: string | null;
  };
}

interface DemoStep {
  step: string;
  status: "ok" | "stub" | "skipped" | "blocked" | "error" | "dry-run";
  detail?: string;
  txHash?: Hex;
  explorer?: string;
  durationMs?: number;
  stubReason?: string;
}

// ─────────────────────────── main ───────────────────────────────────────

main().catch((err) => {
  console.error("v4-swap-pool-demo-cctp fatal:", err);
  writeOutput({
    ranAt: new Date().toISOString(),
    status: "error",
    reason: (err as Error).message ?? String(err),
    dryRun: DRY_RUN,
    network: networkSnapshot(),
    actors: {
      keeper: { address: zeroAddress() },
      maker: { address: zeroAddress() },
      taker: { address: zeroAddress() },
    },
    amountUsdc: AMOUNT_USDC_STR,
    amountRaw: AMOUNT_RAW.toString(),
    steps: [],
    balances: emptyBalances(),
  });
  process.exit(1);
});

async function main(): Promise<void> {
  loadDotEnvLocal();

  const ranAt = new Date().toISOString();
  const steps: DemoStep[] = [];

  // ── env gates ────────────────────────────────────────────────────────
  const keeperPk = readPk(["KEEPER_PRIVATE_KEY"]);
  const makerPk = readPk(["MAKER_PRIVATE_KEY", "DEMO_MAKER_PRIVATE_KEY"]);
  const takerPk = readPk(["TAKER_PRIVATE_KEY", "DEMO_TAKER_PRIVATE_KEY"]);

  const missing: string[] = [];
  if (!keeperPk) missing.push("KEEPER_PRIVATE_KEY");
  if (!makerPk) missing.push("MAKER_PRIVATE_KEY (or DEMO_MAKER_PRIVATE_KEY)");
  if (!takerPk) missing.push("TAKER_PRIVATE_KEY (or DEMO_TAKER_PRIVATE_KEY)");

  if (missing.length > 0) {
    const reason = `missing required env vars in .env.local: ${missing.join(", ")}`;
    console.error(`[v4-swap-demo] ${reason}`);
    writeOutput({
      ranAt,
      status: "blocked",
      reason,
      dryRun: DRY_RUN,
      network: networkSnapshot(),
      actors: {
        keeper: { address: zeroAddress() },
        maker: { address: zeroAddress() },
        taker: { address: zeroAddress() },
      },
      amountUsdc: AMOUNT_USDC_STR,
      amountRaw: AMOUNT_RAW.toString(),
      steps: [
        {
          step: "env-gate",
          status: "blocked",
          detail: reason,
        },
      ],
      balances: emptyBalances(),
    });
    process.exit(2);
  }

  // ── accounts ─────────────────────────────────────────────────────────
  const keeperAccount = privateKeyToAccount(keeperPk! as Hex);
  const makerAccount = privateKeyToAccount(makerPk! as Hex);
  const takerAccount = privateKeyToAccount(takerPk! as Hex);

  console.log("[v4-swap-demo] addresses", {
    keeper: keeperAccount.address,
    maker: makerAccount.address,
    taker: takerAccount.address,
    dryRun: DRY_RUN,
    targetToken: TARGET_TOKEN,
    amountUsdc: AMOUNT_USDC_STR,
  });

  // ── network context ──────────────────────────────────────────────────
  const arcContracts = CONTRACTS[ARC_CHAIN_ID];
  const fujiContracts = CONTRACTS[FUJI_CHAIN_ID];
  const fujiUsdc = fujiContracts.tokens.usdc;
  const arcUsdc = arcContracts.tokens.usdc;
  const arcTelaranaHook = arcContracts.telarana.telaranaGatewayHubHook ?? null;
  const arcBufxRouter = arcContracts.bufx.telaranaRequestRouter ?? null;
  const arcSpotExecutor = arcContracts.telarana.fxSpotExecutor ?? null;
  const arcPoolManager =
    BENTO_DEPLOYMENTS[ARC_CHAIN_ID]?.addresses.PoolManager ?? null;

  const spotRoute = SPOT_FX_ROUTES[TARGET_TOKEN];
  if (!spotRoute) {
    const reason = `unknown V4_SWAP_TARGET_TOKEN=${TARGET_TOKEN}; must be one of EURC | JPYC | MXNB | CHFC`;
    console.error(`[v4-swap-demo] ${reason}`);
    writeOutput({
      ranAt,
      status: "blocked",
      reason,
      dryRun: DRY_RUN,
      network: networkSnapshot(),
      actors: {
        keeper: { address: keeperAccount.address },
        maker: { address: makerAccount.address },
        taker: { address: takerAccount.address },
      },
      amountUsdc: AMOUNT_USDC_STR,
      amountRaw: AMOUNT_RAW.toString(),
      steps: [{ step: "config-target-token", status: "blocked", detail: reason }],
      balances: emptyBalances(),
    });
    process.exit(2);
  }

  // ── clients ──────────────────────────────────────────────────────────
  const arcTestnet = defineChain({
    id: ARC_CHAIN_ID,
    name: "Arc Testnet",
    nativeCurrency: { decimals: 6, name: "USDC", symbol: "USDC" },
    rpcUrls: { default: { http: [DEFAULT_RPC_URLS[ARC_CHAIN_ID]] } },
  });
  const fujiRpc = DEFAULT_RPC_URLS[FUJI_CHAIN_ID];
  const arcRpc = DEFAULT_RPC_URLS[ARC_CHAIN_ID];

  const fujiPublic = createPublicClient({
    chain: avalancheFuji,
    transport: http(fujiRpc),
  });
  const arcPublic = createPublicClient({
    chain: arcTestnet,
    transport: http(arcRpc),
  });

  const fujiWalletKeeper = createWalletClient({
    account: keeperAccount,
    chain: avalancheFuji,
    transport: http(fujiRpc),
  });
  const arcWalletKeeper = createWalletClient({
    account: keeperAccount,
    chain: arcTestnet,
    transport: http(arcRpc),
  });
  const arcWalletTaker = createWalletClient({
    account: takerAccount,
    chain: arcTestnet,
    transport: http(arcRpc),
  });
  // Maker isn't currently load-bearing in v0.1 wire (FxSpotExecutor pulls
  // from its own reserve), but we keep the wallet ref so future steps can
  // wire LP add/remove without restructuring this file.
  void makerAccount;

  // ── balances (pre) ───────────────────────────────────────────────────
  const balances: DemoOutput["balances"] = emptyBalances();
  if (arcUsdc) {
    balances.takerArcUsdcBefore = formatUnits(
      await getErc20Balance(arcPublic, arcUsdc, takerAccount.address),
      6,
    );
  }
  if (spotRoute.tokenOut) {
    balances.takerArcTargetBefore = formatUnits(
      await getErc20Balance(arcPublic, spotRoute.tokenOut, takerAccount.address),
      6,
    );
  }

  // ── step 1: probe arc v4 PoolManager (verify deployment) ────────────
  const probeStart = Date.now();
  let arcPoolManagerAlive = false;
  if (arcPoolManager) {
    try {
      // extsload(0) is always safe; PoolManager deployments respond non-zero
      // for some slots and zero for others. We only need a non-throw to
      // confirm the address has code.
      await arcPublic.readContract({
        address: arcPoolManager,
        abi: POOL_MANAGER_PROBE_ABI,
        functionName: "extsload",
        args: [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
        ],
      });
      arcPoolManagerAlive = true;
      steps.push({
        step: "probe-arc-v4-pool-manager",
        status: "ok",
        detail: `PoolManager at ${arcPoolManager} responded to extsload`,
        durationMs: Date.now() - probeStart,
      });
    } catch (e) {
      steps.push({
        step: "probe-arc-v4-pool-manager",
        status: "blocked",
        detail: `extsload reverted: ${(e as Error).message}`,
        durationMs: Date.now() - probeStart,
      });
    }
  } else {
    steps.push({
      step: "probe-arc-v4-pool-manager",
      status: "blocked",
      detail: "BENTO_DEPLOYMENTS[Arc].PoolManager is missing",
    });
  }

  // ── step 2: probe arc TelaranaGatewayHubHook ─────────────────────────
  const hookProbeStart = Date.now();
  let arcHookHasGatewayMinter = false;
  if (arcTelaranaHook) {
    try {
      const minter = (await arcPublic.readContract({
        address: arcTelaranaHook,
        abi: TelaranaGatewayHubHookAbi,
        functionName: "GATEWAY_MINTER",
      })) as Address;
      arcHookHasGatewayMinter =
        minter.toLowerCase() === CIRCLE_GATEWAY.gatewayMinter.toLowerCase();
      steps.push({
        step: "probe-arc-telarana-gateway-hub-hook",
        status: "ok",
        detail: `GATEWAY_MINTER() = ${minter}${
          arcHookHasGatewayMinter ? " (matches canonical Circle Gateway minter)" : ""
        }`,
        durationMs: Date.now() - hookProbeStart,
      });
    } catch (e) {
      steps.push({
        step: "probe-arc-telarana-gateway-hub-hook",
        status: "blocked",
        detail: `GATEWAY_MINTER() read failed: ${(e as Error).message}`,
        durationMs: Date.now() - hookProbeStart,
      });
    }
  } else {
    steps.push({
      step: "probe-arc-telarana-gateway-hub-hook",
      status: "blocked",
      detail:
        "CONTRACTS[Arc].telarana.telaranaGatewayHubHook is missing — Wave K1 ABI sync may not be live",
    });
  }

  // ── step 3 (annotation): FxSwapHook ABI status ───────────────────────
  // This is the load-bearing differentiator we WANT to drive but can't
  // until K1 lands the ABI. Surface it as `stub` rather than silently
  // skipping.
  steps.push({
    step: "fx-swap-hook-abi-presence",
    status: "stub",
    detail:
      "FxSwapHook (fx-telarana/contracts/src/hub/FxSwapHook.sol) is shipped on the contract side " +
      "but its ABI is not synced into packages/contracts/src/abis/ yet. The minimal `parseAbi` stub " +
      "in this script is a marker; the real beforeSwap-routed swap goes through PoolManager.unlock + " +
      "PoolManager.swap with hookData carrying the GatewayMintContext.",
    stubReason:
      "waiting on Wave K1 — `scripts/sync-abis.mjs` must publish FxSwapHookAbi to packages/contracts/src/abis/",
  });
  void FX_SWAP_HOOK_ABI_STUB; // satisfy lint — kept as a marker.

  // ── dry-run gate ─────────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log("[v4-swap-demo] DRY_RUN=true — exiting after probes");
    steps.push({
      step: "dry-run-exit",
      status: "dry-run",
      detail:
        "V4_SWAP_DRY_RUN=true (default). Pass V4_SWAP_DRY_RUN=false to actually broadcast.",
    });
    writeOutput({
      ranAt,
      status: "dry-run",
      dryRun: true,
      network: networkSnapshot({
        arcUsdc,
        fujiUsdc,
        arcPoolManager,
        arcTelaranaHook,
        arcBufxRouter,
        arcSpotExecutor,
        spotRouteId: spotRoute.routeId,
        targetTokenAddress: spotRoute.tokenOut,
      }),
      actors: {
        keeper: { address: keeperAccount.address },
        maker: { address: makerAccount.address },
        taker: { address: takerAccount.address },
      },
      amountUsdc: AMOUNT_USDC_STR,
      amountRaw: AMOUNT_RAW.toString(),
      steps,
      balances,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "dry-run",
          arcPoolManagerAlive,
          arcHookHasGatewayMinter,
          steps: steps.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  // ── BROADCAST PATH ───────────────────────────────────────────────────
  if (!fujiUsdc || !arcUsdc) {
    failBlocked(
      "missing USDC token address on Fuji or Arc — check @bufi/contracts CONTRACTS[].tokens.usdc",
      steps,
      {
        ranAt,
        dryRun: DRY_RUN,
        keeperAccount,
        makerAccount,
        takerAccount,
        arcPoolManager,
        arcTelaranaHook,
        arcBufxRouter,
        arcSpotExecutor,
        spotRoute,
        balances,
        fujiUsdc: fujiUsdc ?? null,
        arcUsdc: arcUsdc ?? null,
      },
    );
    return;
  }

  // ── step 4: capacity check on taker (Fuji USDC ERC-20) ───────────────
  const takerFujiUsdc = await getErc20Balance(
    fujiPublic,
    fujiUsdc,
    takerAccount.address,
  );
  console.log("[v4-swap-demo] taker fuji USDC", takerFujiUsdc.toString());

  if (!SKIP_CCTP) {
    const need = AMOUNT_RAW + MAX_FEE_RAW;
    if (takerFujiUsdc < need) {
      const reason = `taker ${takerAccount.address} has ${formatUnits(takerFujiUsdc, 6)} USDC on Fuji; needs ≥${formatUnits(need, 6)} (amount + maxFee). Fund via https://faucet.circle.com (select Avalanche Fuji).`;
      failBlocked(reason, steps, {
        ranAt,
        dryRun: DRY_RUN,
        keeperAccount,
        makerAccount,
        takerAccount,
        arcPoolManager,
        arcTelaranaHook,
        arcBufxRouter,
        arcSpotExecutor,
        spotRoute,
        balances,
        fujiUsdc,
        arcUsdc,
      });
      return;
    }
  }

  // ── step 5: CCTP V2 burn on Fuji (taker signs) ───────────────────────
  let burnTxHash: Hex | undefined;
  let mintTxHash: Hex | undefined;

  if (!SKIP_CCTP) {
    const fujiWalletTaker = createWalletClient({
      account: takerAccount,
      chain: avalancheFuji,
      transport: http(fujiRpc),
    });

    const burnStart = Date.now();
    try {
      // approve TokenMessengerV2 → USDC
      const currentAllowance = (await fujiPublic.readContract({
        address: fujiUsdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [takerAccount.address, FUJI_TOKEN_MESSENGER_V2],
      })) as bigint;
      if (currentAllowance < AMOUNT_RAW + MAX_FEE_RAW) {
        const approveTx = await fujiWalletTaker.writeContract({
          address: fujiUsdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [FUJI_TOKEN_MESSENGER_V2, AMOUNT_RAW + MAX_FEE_RAW],
          account: takerAccount,
          chain: avalancheFuji,
        });
        await fujiPublic.waitForTransactionReceipt({ hash: approveTx });
        steps.push({
          step: "cctp-approve-fuji-usdc",
          status: "ok",
          txHash: approveTx,
          explorer: FUJI_EXPLORER_BASE + approveTx,
        });
      } else {
        steps.push({
          step: "cctp-approve-fuji-usdc",
          status: "skipped",
          detail: `allowance ${currentAllowance} already covers ${AMOUNT_RAW + MAX_FEE_RAW}`,
        });
      }

      // depositForBurn → ARC domain 26, mintRecipient = TelaranaGatewayHubHook
      // OR the taker (we use taker so the mint credits the taker's ERC-20
      // ledger directly — the v4 hook's beforeSwap path requires the swap
      // input to be in the swapper's balance pre-swap).
      const mintRecipient = pad(takerAccount.address, { size: 32 });
      const destinationCaller = ("0x" + "00".repeat(32)) as Hex;

      burnTxHash = await fujiWalletTaker.writeContract({
        address: FUJI_TOKEN_MESSENGER_V2,
        abi: TOKEN_MESSENGER_V2_ABI,
        functionName: "depositForBurn",
        args: [
          AMOUNT_RAW,
          ARC_CCTP_DOMAIN,
          mintRecipient,
          fujiUsdc,
          destinationCaller,
          MAX_FEE_RAW,
          FINALITY_FAST,
        ],
        account: takerAccount,
        chain: avalancheFuji,
      });
      const burnReceipt = await fujiPublic.waitForTransactionReceipt({
        hash: burnTxHash,
      });
      steps.push({
        step: "cctp-burn-fuji",
        status: "ok",
        txHash: burnTxHash,
        explorer: FUJI_EXPLORER_BASE + burnTxHash,
        detail: `gasUsed=${burnReceipt.gasUsed.toString()} block=${burnReceipt.blockNumber.toString()}`,
        durationMs: Date.now() - burnStart,
      });

      // ── step 6: attest via Iris ────────────────────────────────────
      const attestStart = Date.now();
      const att = await pollAttestation(burnTxHash);
      if (att.status !== "complete" || !att.message || !att.attestation) {
        steps.push({
          step: "cctp-attest-iris",
          status: "blocked",
          detail: `attestation ${att.status}: ${att.reason ?? "no detail"}`,
          durationMs: Date.now() - attestStart,
        });
        failBlocked(`iris attestation ${att.status}`, steps, {
          ranAt,
          dryRun: DRY_RUN,
          keeperAccount,
          makerAccount,
          takerAccount,
          arcPoolManager,
          arcTelaranaHook,
          arcBufxRouter,
          arcSpotExecutor,
          spotRoute,
          balances,
          fujiUsdc,
          arcUsdc,
        });
        return;
      }
      steps.push({
        step: "cctp-attest-iris",
        status: "ok",
        detail: `attestation complete in ${Date.now() - attestStart}ms`,
        durationMs: Date.now() - attestStart,
      });

      // ── step 7: receiveMessage on Arc (keeper relays) ──────────────
      const mintStart = Date.now();
      mintTxHash = await arcWalletKeeper.writeContract({
        address: ARC_MESSAGE_TRANSMITTER_V2,
        abi: MESSAGE_TRANSMITTER_V2_ABI,
        functionName: "receiveMessage",
        args: [att.message, att.attestation],
        account: keeperAccount,
        chain: arcTestnet,
      });
      const mintReceipt = await arcPublic.waitForTransactionReceipt({
        hash: mintTxHash,
      });
      steps.push({
        step: "cctp-mint-arc",
        status: "ok",
        txHash: mintTxHash,
        explorer: ARC_EXPLORER_BASE + mintTxHash,
        detail: `gasUsed=${mintReceipt.gasUsed.toString()} block=${mintReceipt.blockNumber.toString()}`,
        durationMs: Date.now() - mintStart,
      });
    } catch (e) {
      steps.push({
        step: "cctp-burn-mint",
        status: "error",
        detail: (e as Error).message,
      });
      failBlocked(
        `cctp burn/mint failed: ${(e as Error).message}`,
        steps,
        {
          ranAt,
          dryRun: DRY_RUN,
          keeperAccount,
          makerAccount,
          takerAccount,
          arcPoolManager,
          arcTelaranaHook,
          arcBufxRouter,
          arcSpotExecutor,
          spotRoute,
          balances,
          fujiUsdc,
          arcUsdc,
        },
      );
      return;
    }
  } else {
    steps.push({
      step: "cctp-burn-mint",
      status: "skipped",
      detail: "V4_SWAP_SKIP_CCTP=true — using existing Arc USDC balance",
    });
  }

  // ── step 8: submit telarana spot-FX request on Arc ───────────────────
  // This is the "v4 swap pool" intent: the request carries the spotRouteId
  // and tokenOut (EURC by default). On the contract side, this should
  // flow through TelaranaGatewayHubHook → FxSwapHook.beforeSwap →
  // PoolManager. Today, the BuFxTelaranaRequestRouter `submitTelaranaRequest`
  // is the canonical user-facing entrypoint and emits
  // TelaranaRequestSubmitted + (eventually) GatewayAtomicFxSwapRequested.
  //
  // The "stub" caveat: the keeper-spot service that ferries this request
  // through `receiveGatewayMint` → `executeSpotFx` is NOT running in this
  // demo (see apps/keeper-spot/src/index.ts — it boot-logs and returns).
  // So the EURC delivery side will not settle in real time. The on-chain
  // request submission IS real.
  if (!arcBufxRouter) {
    steps.push({
      step: "submit-telarana-request",
      status: "stub",
      detail:
        "CONTRACTS[Arc].bufx.telaranaRequestRouter is null — Wave K1 ABI sync may not yet expose Arc-side router.",
      stubReason: "waiting on Wave K1",
    });
  } else {
    const requestStart = Date.now();
    try {
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      const requestId = computeRequestId(takerAccount.address, nowSec);
      const deadline = nowSec + BigInt(DEADLINE_HORIZON_SEC);

      const request = {
        requestId,
        // We re-use the canonical Fuji→Arc mint-to-hub route — same as
        // LIVE_ROUTE_IDS — for the gateway leg. The on-chain router maps
        // routeId → telarana receiver.
        routeId: LIVE_ROUTE_IDS.fujiToArcMintToHubUsdc,
        action: HUB_ACTION_SPOT_FX,
        trader: takerAccount.address,
        sourceSigner: takerAccount.address,
        recipient: takerAccount.address,
        amount: AMOUNT_RAW,
        maxExecutionFee: 0n,
        deadline,
        spot: {
          spotRouteId: spotRoute.routeId,
          // marketId is informational at submission; the registry
          // resolves it on settlement.
          marketId:
            "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
          tokenOut: spotRoute.tokenOut,
          // minAmountOut = 0 for the demo (no slippage protection — this
          // is a testnet smoke). A production caller would supply a real
          // bound based on Pyth mid + max spread.
          minAmountOut: 0n,
          referrer:
            "0x0000000000000000000000000000000000000000" as Address,
          campaignId:
            "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
          metadata: "0x" as Hex,
        },
      } as const;

      const submitTx = await arcWalletTaker.writeContract({
        address: arcBufxRouter,
        abi: buFxTelaranaRequestRouterAbi,
        functionName: "submitTelaranaRequest",
        args: [request],
        account: takerAccount,
        chain: arcTestnet,
      });
      const submitReceipt = await arcPublic.waitForTransactionReceipt({
        hash: submitTx,
      });
      const submitted = decodeTelaranaSubmitted(submitReceipt);
      steps.push({
        step: "submit-telarana-spot-fx-request",
        status: "ok",
        txHash: submitTx,
        explorer: ARC_EXPLORER_BASE + submitTx,
        detail:
          submitted != null
            ? `requestId=${submitted.requestId} routeId=${submitted.routeId} spotRouteId=${submitted.spotRouteId}`
            : `submitted but TelaranaRequestSubmitted not decoded — see receipt logs (gasUsed=${submitReceipt.gasUsed.toString()})`,
        durationMs: Date.now() - requestStart,
      });
    } catch (e) {
      steps.push({
        step: "submit-telarana-spot-fx-request",
        status: "error",
        detail: (e as Error).message,
        durationMs: Date.now() - requestStart,
      });
    }
  }

  // ── step 9: stub markers for the parts that don't yet settle ────────
  steps.push({
    step: "settle-via-fx-swap-hook",
    status: "stub",
    detail:
      "v4 swap settlement happens when keeper-spot consumes GatewayAtomicFxSwapRequested " +
      "→ calls TelaranaGatewayHubHook.receiveGatewayMint(attestation, signature, context) " +
      "→ then FxSpotExecutor.executeSpotFx(requestId). The current keeper-spot is a stub " +
      "(see apps/keeper-spot/src/index.ts). On-chain side ships, off-chain relay does not.",
    stubReason:
      "waiting on keeper-spot real-loop wiring (rolls under HP1 → PR-H8 / Gateway demo)",
  });

  // ── step 10: balances (post) — taker target token delta ─────────────
  if (arcUsdc) {
    balances.takerArcUsdcAfter = formatUnits(
      await getErc20Balance(arcPublic, arcUsdc, takerAccount.address),
      6,
    );
  }
  if (spotRoute.tokenOut) {
    balances.takerArcTargetAfter = formatUnits(
      await getErc20Balance(arcPublic, spotRoute.tokenOut, takerAccount.address),
      6,
    );
  }

  const usdcDeltaStr =
    balances.takerArcUsdcBefore != null && balances.takerArcUsdcAfter != null
      ? `${balances.takerArcUsdcBefore} → ${balances.takerArcUsdcAfter}`
      : "n/a";
  const targetDeltaStr =
    balances.takerArcTargetBefore != null &&
    balances.takerArcTargetAfter != null
      ? `${balances.takerArcTargetBefore} → ${balances.takerArcTargetAfter}`
      : "n/a";
  steps.push({
    step: "verify-balances",
    status: "ok",
    detail: `taker Arc USDC: ${usdcDeltaStr} ; ${TARGET_TOKEN}: ${targetDeltaStr}`,
  });

  // ── final rollup ────────────────────────────────────────────────────
  const anyStub = steps.some((s) => s.status === "stub");
  const anyError = steps.some((s) => s.status === "error");
  const status: DemoOutput["status"] = anyError
    ? "error"
    : anyStub
      ? "ok-stubbed"
      : "ok";
  writeOutput({
    ranAt,
    status,
    dryRun: DRY_RUN,
    network: networkSnapshot({
      arcUsdc,
      fujiUsdc,
      arcPoolManager,
      arcTelaranaHook,
      arcBufxRouter,
      arcSpotExecutor,
      spotRouteId: spotRoute.routeId,
      targetTokenAddress: spotRoute.tokenOut,
    }),
    actors: {
      keeper: { address: keeperAccount.address },
      maker: { address: makerAccount.address },
      taker: { address: takerAccount.address },
    },
    amountUsdc: AMOUNT_USDC_STR,
    amountRaw: AMOUNT_RAW.toString(),
    steps,
    balances,
  });
  console.log(
    JSON.stringify(
      {
        ok: status === "ok" || status === "ok-stubbed",
        status,
        burnTx: burnTxHash,
        mintTx: mintTxHash,
        steps: steps.map((s) => ({ step: s.step, status: s.status })),
      },
      null,
      2,
    ),
  );
  if (status === "error") process.exit(1);
}

// ─────────────────────────── helpers ────────────────────────────────────

function readPk(envNames: string[]): Hex | undefined {
  for (const name of envNames) {
    const v = process.env[name];
    if (v && /^0x[a-fA-F0-9]{64}$/.test(v)) return v as Hex;
  }
  return undefined;
}

function zeroAddress(): Address {
  return "0x0000000000000000000000000000000000000000" as Address;
}

function emptyBalances(): DemoOutput["balances"] {
  return {
    takerArcUsdcBefore: null,
    takerArcUsdcAfter: null,
    takerArcTargetBefore: null,
    takerArcTargetAfter: null,
  };
}

function networkSnapshot(extra?: {
  arcUsdc?: Address | null;
  fujiUsdc?: Address | null;
  arcPoolManager?: Address | null;
  arcTelaranaHook?: Address | null;
  arcBufxRouter?: Address | null;
  arcSpotExecutor?: Address | null;
  spotRouteId?: Hex;
  targetTokenAddress?: Address | null;
}): DemoOutput["network"] {
  return {
    sourceChainId: FUJI_CHAIN_ID,
    destinationChainId: ARC_CHAIN_ID,
    cctp: {
      sourceDomain: FUJI_CCTP_DOMAIN,
      destinationDomain: ARC_CCTP_DOMAIN,
      tokenMessengerV2: FUJI_TOKEN_MESSENGER_V2,
      messageTransmitterV2: ARC_MESSAGE_TRANSMITTER_V2,
      iris: IRIS_SANDBOX_BASE,
    },
    arc: {
      poolManager: extra?.arcPoolManager ?? null,
      telaranaGatewayHubHook: extra?.arcTelaranaHook ?? null,
      bufxTelaranaRequestRouter: extra?.arcBufxRouter ?? null,
      fxSpotExecutor: extra?.arcSpotExecutor ?? null,
      usdc: extra?.arcUsdc ?? null,
      targetTokenSymbol: TARGET_TOKEN,
      targetTokenAddress: extra?.targetTokenAddress ?? null,
      spotRouteId:
        extra?.spotRouteId ??
        ("0x0000000000000000000000000000000000000000000000000000000000000000" as Hex),
    },
    fuji: { usdc: extra?.fujiUsdc ?? null },
  };
}

async function getErc20Balance(
  client: PublicClient,
  token: Address,
  owner: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  })) as bigint;
}

interface IrisMessage {
  message: Hex;
  attestation: Hex;
  status: string;
}
interface IrisResponse {
  messages?: IrisMessage[];
}

async function pollAttestation(burnTxHash: Hex): Promise<{
  status: "complete" | "timeout" | "error";
  message?: Hex;
  attestation?: Hex;
  reason?: string;
}> {
  const url = `${IRIS_SANDBOX_BASE}/v2/messages/${FUJI_CCTP_DOMAIN}?transactionHash=${burnTxHash}`;
  const deadline = Date.now() + ATTESTATION_TIMEOUT_MS;
  let lastReason = "no message returned by iris";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) {
        lastReason = `iris HTTP ${res.status}`;
      } else {
        const body = (await res.json()) as IrisResponse;
        const m = body.messages?.[0];
        if (
          m &&
          m.status === "complete" &&
          m.message &&
          m.message !== "0x" &&
          m.attestation &&
          m.attestation !== "0x"
        ) {
          return {
            status: "complete",
            message: m.message,
            attestation: m.attestation,
          };
        }
        if (m) lastReason = `iris status=${m.status}`;
      }
    } catch (e) {
      lastReason = `iris fetch error: ${(e as Error).message}`;
    }
    await sleep(ATTESTATION_POLL_MS);
  }
  return { status: "timeout", reason: lastReason };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function computeRequestId(trader: Address, nonceSec: bigint): Hex {
  // requestId only needs to be unique per submission. The contract
  // rejects duplicates on storage. We deterministically derive from
  // trader || ts; production callers would use a UUID or signed nonce.
  const lower = trader.toLowerCase().replace(/^0x/, "");
  const tsHex = nonceSec.toString(16).padStart(24, "0");
  return ("0x" + lower + tsHex) as Hex;
}

function decodeTelaranaSubmitted(receipt: TransactionReceipt): {
  requestId: Hex;
  routeId: Hex;
  spotRouteId: Hex;
} | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: buFxTelaranaRequestRouterAbi,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
        strict: false,
      });
      if (decoded.eventName === "TelaranaRequestSubmitted") {
        const args = decoded.args as unknown as {
          requestId: Hex;
          routeId: Hex;
          spotRouteId: Hex;
        };
        return {
          requestId: args.requestId,
          routeId: args.routeId,
          spotRouteId: args.spotRouteId,
        };
      }
    } catch {
      // not our log
    }
  }
  return null;
}

function failBlocked(
  reason: string,
  steps: DemoStep[],
  ctx: {
    ranAt: string;
    dryRun: boolean;
    keeperAccount: PrivateKeyAccount;
    makerAccount: PrivateKeyAccount;
    takerAccount: PrivateKeyAccount;
    arcPoolManager: Address | null;
    arcTelaranaHook: Address | null;
    arcBufxRouter: Address | null;
    arcSpotExecutor: Address | null;
    spotRoute: { routeId: Hex; tokenOut: Address };
    balances: DemoOutput["balances"];
    fujiUsdc: Address | null;
    arcUsdc: Address | null;
  },
): void {
  writeOutput({
    ranAt: ctx.ranAt,
    status: "blocked",
    reason,
    dryRun: ctx.dryRun,
    network: networkSnapshot({
      arcUsdc: ctx.arcUsdc,
      fujiUsdc: ctx.fujiUsdc,
      arcPoolManager: ctx.arcPoolManager,
      arcTelaranaHook: ctx.arcTelaranaHook,
      arcBufxRouter: ctx.arcBufxRouter,
      arcSpotExecutor: ctx.arcSpotExecutor,
      spotRouteId: ctx.spotRoute.routeId,
      targetTokenAddress: ctx.spotRoute.tokenOut,
    }),
    actors: {
      keeper: { address: ctx.keeperAccount.address },
      maker: { address: ctx.makerAccount.address },
      taker: { address: ctx.takerAccount.address },
    },
    amountUsdc: AMOUNT_USDC_STR,
    amountRaw: AMOUNT_RAW.toString(),
    steps,
    balances: ctx.balances,
  });
  process.exit(2);
}

function writeOutput(out: DemoOutput): void {
  writeFileSync(OUTPUT_PATH, JSON.stringify(out, bigintReplacer, 2) + "\n", "utf8");
}

function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

// Walk up from this script's dir to find the workspace-root `.env.local`
// and hand it to process.env. Mirrors `scripts/perps-demo-trade.ts`.
function loadDotEnvLocal(): void {
  try {
    const { existsSync, readFileSync } =
      require("node:fs") as typeof import("node:fs");
    let dir = SCRIPT_DIR;
    for (let i = 0; i < 6; i++) {
      const candidate = resolve(dir, ".env.local");
      if (existsSync(candidate)) {
        const txt = readFileSync(candidate, "utf8");
        for (const rawLine of txt.split(/\r?\n/)) {
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
    // best-effort; missing envs get caught by the gate above with a clear message
  }
}
