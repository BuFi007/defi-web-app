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
  FxSwapHookAbi,
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
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  getAddress,
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
// Argv override: `--dry-run` flag matches the convention in the task brief
// and the wider scripts/ folder. Either source flips DRY_RUN on; the env
// var still wins when explicitly set to "false".
const ARGV_DRY_RUN_FLAG = process.argv.slice(2).includes("--dry-run");
const DRY_RUN =
  ARGV_DRY_RUN_FLAG ||
  (process.env.V4_SWAP_DRY_RUN ?? "true").toLowerCase() === "true";
const SKIP_CCTP =
  (process.env.V4_SWAP_SKIP_CCTP ?? "false").toLowerCase() === "true";
const ATTESTATION_TIMEOUT_MS = Number(
  process.env.V4_SWAP_TIMEOUT_MS ?? 600_000,
);
const ATTESTATION_POLL_MS = Number(process.env.V4_SWAP_POLL_MS ?? 5_000);
const MAX_FEE_RAW = BigInt(process.env.V4_SWAP_MAX_FEE ?? "500");
const DEADLINE_HORIZON_SEC = Number(process.env.V4_SWAP_DEADLINE_SEC ?? 600);

// Wave L4 — FxSwapHook v4 wiring knobs.
//
// `FX_SWAP_HOOK_ADDRESS` is required to attempt a real v4 swap. The hook
// ABI ships in @bufi/contracts (K1), but the on-chain hook itself isn't in
// the canonical Arc Testnet telarana manifest yet (see deployments/
// telarana-arc-testnet.json). Until it's deployed, we keep the dry-run
// probe alive but mark the broadcast leg blocked.
//
// `V4_SWAP_FEE` + `V4_SWAP_TICK_SPACING` mirror the FxSwapHook pool
// constructor convention (Uniswap v4 default: 100 / 1 for a tight stable
// pair; FxSwapHook docs target fee=100 = 0.01%, tickSpacing=1). Override
// via env if a different pool gets initialized.
//
// `V4_SWAP_TEST_ROUTER` is the address of a contract implementing
// `IUnlockCallback` (i.e. an EOA-callable router that re-enters
// PoolManager.swap inside its `unlockCallback`). Required for actual
// broadcast because EOAs cannot satisfy the v4 unlock callback shape
// directly — PoolManager.unlock(...) reverts when the caller has no code.
const FX_SWAP_HOOK_ADDRESS =
  parseAddressEnv(process.env.FX_SWAP_HOOK_ADDRESS);
const V4_SWAP_FEE = Number(process.env.V4_SWAP_FEE ?? 100);
const V4_SWAP_TICK_SPACING = Number(process.env.V4_SWAP_TICK_SPACING ?? 1);
const V4_SWAP_TEST_ROUTER =
  parseAddressEnv(process.env.V4_SWAP_TEST_ROUTER);
// Disable slippage protection by default for testnet smoke (mirrors the
// telarana submit-request step). Production callers should set a real bound.
const V4_SQRT_PRICE_LIMIT_X96_UPPER =
  // 1461446703485210103287273052203988822378723970341n is MAX_SQRT_PRICE - 1
  // (TickMath.MAX_SQRT_PRICE_RATIO - 1) — used for zeroForOne=false.
  1461446703485210103287273052203988822378723970341n;
const V4_SQRT_PRICE_LIMIT_X96_LOWER =
  // 4295128740n is MIN_SQRT_PRICE + 1 (TickMath.MIN_SQRT_PRICE_RATIO + 1)
  // — used for zeroForOne=true.
  4295128740n;

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

// Wave L4 — FxSwapHook ABI now lives in @bufi/contracts (synced by K1 /
// scripts/sync-contracts.mjs from fx-telarana/contracts/src/hub/
// FxSwapHook.sol). The hook does NOT expose a direct `fxSwap` entrypoint;
// the canonical Uniswap v4 path is:
//   1. Build PoolKey = { currency0, currency1, fee, tickSpacing,
//                        hooks: FxSwapHook }
//   2. Call IPoolManager.unlock(callbackData) — only callable from a
//      contract implementing IUnlockCallback. The PoolManager re-enters
//      that contract's unlockCallback, which calls
//      IPoolManager.swap(poolKey, params, hookData). The hook's
//      `beforeSwap(sender, key, params, hookData)` runs inside that swap.
//
// We use `FxSwapHookAbi` to *probe* a deployed instance (TOKEN0 / TOKEN1
// / POOL_MANAGER reads) so we can validate the env-provided address
// before broadcasting.

// Uniswap v4 PoolManager — calldata surface for `unlock` + `swap` (the
// real path FxSwapHook attaches to). `extsload` is kept so we can still
// confirm liveness with a single rpc read.
const POOL_MANAGER_ABI = parseAbi([
  "function extsload(bytes32 slot) view returns (bytes32)",
  "function unlock(bytes data) returns (bytes)",
  "function swap((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, (bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) params, bytes hookData) returns (int256 delta)",
]);

// Helper: re-export the IPoolManager.swap calldata shape so we can also
// hand a fully encoded swap call to an external IUnlockCallback router
// (the `V4_SWAP_TEST_ROUTER` env knob) without dragging in a router ABI.

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
        abi: POOL_MANAGER_ABI,
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

  // ── step 3: probe FxSwapHook deployment (Wave L4 unstub) ────────────
  // K1 landed the ABI. We now (a) read TOKEN0/TOKEN1/POOL_MANAGER from
  // the env-provided FX_SWAP_HOOK_ADDRESS to validate it's wired against
  // the same PoolManager + the expected USDC/EURC currencies, and
  // (b) build the canonical PoolKey we'll later hand to PoolManager.unlock.
  //
  // FxSwapHook is NOT in deployments/telarana-arc-testnet.json yet. If
  // FX_SWAP_HOOK_ADDRESS is missing or empty, this step is `blocked`
  // (not `stub`) and the broadcast path will refuse to attempt the v4
  // swap, with a clear reason.
  let fxSwapHookProbe:
    | {
        address: Address;
        token0: Address;
        token1: Address;
        poolManager: Address;
        consistent: boolean;
      }
    | null = null;
  let poolKey: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  } | null = null;
  let hookProbeStart2 = Date.now();
  if (!FX_SWAP_HOOK_ADDRESS) {
    steps.push({
      step: "probe-arc-fx-swap-hook",
      status: "blocked",
      detail:
        "FX_SWAP_HOOK_ADDRESS env is not set. FxSwapHook ABI ships via @bufi/contracts " +
        "(K1, packages/contracts/src/abis/FxSwapHook.ts), but the on-chain hook is not in " +
        "deployments/telarana-arc-testnet.json yet. Set FX_SWAP_HOOK_ADDRESS=<deployed address> " +
        "to enable the real PoolManager.unlock + swap path.",
      stubReason:
        "waiting on Wave L-or-later — FxSwapHook deploy on Arc Testnet (telarana hub manifest update)",
      durationMs: Date.now() - hookProbeStart2,
    });
  } else {
    try {
      const [hookToken0, hookToken1, hookPoolManager] = await Promise.all([
        arcPublic.readContract({
          address: FX_SWAP_HOOK_ADDRESS,
          abi: FxSwapHookAbi,
          functionName: "TOKEN0",
        }) as Promise<Address>,
        arcPublic.readContract({
          address: FX_SWAP_HOOK_ADDRESS,
          abi: FxSwapHookAbi,
          functionName: "TOKEN1",
        }) as Promise<Address>,
        arcPublic.readContract({
          address: FX_SWAP_HOOK_ADDRESS,
          abi: FxSwapHookAbi,
          functionName: "POOL_MANAGER",
        }) as Promise<Address>,
      ]);
      const consistent =
        !!arcPoolManager &&
        hookPoolManager.toLowerCase() === arcPoolManager.toLowerCase();
      fxSwapHookProbe = {
        address: FX_SWAP_HOOK_ADDRESS,
        token0: hookToken0,
        token1: hookToken1,
        poolManager: hookPoolManager,
        consistent,
      };
      // PoolKey currencies are *sorted ascending* by address — both the
      // hook's TOKEN0/TOKEN1 and the v4 PoolKey enforce this. We mirror
      // the hook's reading so the pool id matches.
      poolKey = {
        currency0: getAddress(hookToken0),
        currency1: getAddress(hookToken1),
        fee: V4_SWAP_FEE,
        tickSpacing: V4_SWAP_TICK_SPACING,
        hooks: getAddress(FX_SWAP_HOOK_ADDRESS),
      };
      steps.push({
        step: "probe-arc-fx-swap-hook",
        status: consistent ? "ok" : "blocked",
        detail:
          `FxSwapHook=${FX_SWAP_HOOK_ADDRESS}; TOKEN0=${hookToken0}; TOKEN1=${hookToken1}; ` +
          `POOL_MANAGER=${hookPoolManager}${
            consistent ? " (matches Bento PoolManager)" : " (DOES NOT match Bento PoolManager — pool key would mismatch)"
          }`,
        durationMs: Date.now() - hookProbeStart2,
      });
    } catch (e) {
      steps.push({
        step: "probe-arc-fx-swap-hook",
        status: "blocked",
        detail: `FxSwapHook read failed at ${FX_SWAP_HOOK_ADDRESS}: ${(e as Error).message}`,
        durationMs: Date.now() - hookProbeStart2,
      });
    }
  }

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
          fxSwapHookAddress: fxSwapHookProbe?.address ?? null,
          fxSwapHookConsistent: fxSwapHookProbe?.consistent ?? null,
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

  // ── step 9: PoolManager.unlock → swap with FxSwapHook attached ──────
  // Wave L4 unstub: replaces the previous "stub: FxSwapHook.beforeSwap"
  // marker. This is the load-bearing v4 path — PoolKey carries `hooks:
  // FxSwapHook`, PoolManager.unlock(callbackData) re-enters the unlock
  // callback which invokes PoolManager.swap(poolKey, params, hookData).
  // The hook's beforeSwap runs inside that swap.
  //
  // Constraints surfaced honestly:
  //   1. EOAs cannot satisfy IUnlockCallback — PoolManager.unlock
  //      re-enters `IUnlockCallback(msg.sender).unlockCallback(data)`.
  //      So an EOA-only broadcast reverts in the callback. The script
  //      requires a router contract (V4_SWAP_TEST_ROUTER env). Without
  //      it, we encode the calldata for inspection and stop.
  //   2. The FxSwapHook itself isn't in deployments/telarana-arc-
  //      testnet.json yet, so FX_SWAP_HOOK_ADDRESS must be supplied via
  //      env. Without it we can't construct a valid PoolKey.
  let unlockSwapTxHash: Hex | undefined;
  if (!poolKey) {
    steps.push({
      step: "v4-pool-manager-unlock-swap",
      status: "blocked",
      detail:
        "PoolKey could not be constructed because FxSwapHook probe failed (see " +
        "probe-arc-fx-swap-hook step). Set FX_SWAP_HOOK_ADDRESS to a deployed FxSwapHook " +
        "on Arc Testnet to enable this leg.",
    });
  } else if (!arcPoolManager) {
    steps.push({
      step: "v4-pool-manager-unlock-swap",
      status: "blocked",
      detail:
        "Bento PoolManager address is missing on Arc — cannot route the swap.",
    });
  } else {
    // Direction: we always swap USDC → spotRoute.tokenOut. zeroForOne is
    // true iff USDC (arcUsdc) == PoolKey.currency0.
    const usdcAddr = arcUsdc ?? CONTRACTS[ARC_CHAIN_ID].tokens.usdc;
    const zeroForOne =
      !!usdcAddr &&
      usdcAddr.toLowerCase() === poolKey.currency0.toLowerCase();
    // Negative `amountSpecified` = exact-input in v4. Positive = exact-
    // output. We use exact-input AMOUNT_RAW of USDC.
    const amountSpecified = -AMOUNT_RAW; // exact-input USDC → tokenOut
    const sqrtPriceLimitX96 = zeroForOne
      ? V4_SQRT_PRICE_LIMIT_X96_LOWER
      : V4_SQRT_PRICE_LIMIT_X96_UPPER;
    const swapParams = {
      zeroForOne,
      amountSpecified,
      sqrtPriceLimitX96,
    } as const;
    // hookData carries the GatewayMintContext the hook reads in
    // beforeSwap. For this demo we pass empty bytes — the hook's
    // `_decodeHookData` path treats empty as "no override" and uses its
    // own reserve. A production caller would encode the canonical
    // GatewayMintContext here (see TelaranaGatewayHubHook ABI for the
    // type shape).
    const hookData: Hex = "0x" as Hex;

    // Encode the inner PoolManager.swap call — this is the calldata an
    // IUnlockCallback router would re-enter the PoolManager with from
    // inside its unlockCallback.
    const innerSwapCalldata = encodeFunctionData({
      abi: POOL_MANAGER_ABI,
      functionName: "swap",
      args: [poolKey, swapParams, hookData],
    });
    // The unlock `data` parameter is router-defined; the canonical
    // pattern wraps (poolKey, params, hookData) abi-encoded. We use the
    // tuple shape so a router that simply forwards it can decode.
    const unlockCallbackData = encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
        },
        {
          type: "tuple",
          components: [
            { name: "zeroForOne", type: "bool" },
            { name: "amountSpecified", type: "int256" },
            { name: "sqrtPriceLimitX96", type: "uint160" },
          ],
        },
        { type: "bytes" },
      ],
      [poolKey, swapParams, hookData],
    );

    if (!V4_SWAP_TEST_ROUTER) {
      steps.push({
        step: "v4-pool-manager-unlock-swap",
        status: "blocked",
        detail:
          `Encoded calldata ready (poolKey.hooks=${poolKey.hooks}, zeroForOne=${zeroForOne}, ` +
          `amountSpecified=${amountSpecified.toString()}). NOT broadcasting: ` +
          "PoolManager.unlock re-enters IUnlockCallback on msg.sender, so the caller must be a " +
          "contract. Set V4_SWAP_TEST_ROUTER to a v4 router contract (e.g. PoolSwapTest or a " +
          "deployed FxSwapRouter) that implements unlockCallback(bytes) and re-enters " +
          `PoolManager.swap(...). innerSwapCalldata.length=${innerSwapCalldata.length}, ` +
          `unlockCallbackData.length=${unlockCallbackData.length}.`,
      });
    } else {
      // We assume V4_SWAP_TEST_ROUTER exposes the canonical IPoolManager
      // shape `unlock(bytes) returns (bytes)` — i.e. it's a thin
      // forwarding router that calls poolManager.unlock(data) inside
      // its own `unlock(bytes)` entrypoint. Both PoolSwapTest and the
      // expected FxSwapRouter satisfy this.
      const unlockStart = Date.now();
      try {
        unlockSwapTxHash = await arcWalletKeeper.writeContract({
          address: V4_SWAP_TEST_ROUTER,
          abi: POOL_MANAGER_ABI,
          functionName: "unlock",
          args: [unlockCallbackData],
          account: keeperAccount,
          chain: arcTestnet,
        });
        const unlockReceipt = await arcPublic.waitForTransactionReceipt({
          hash: unlockSwapTxHash,
        });
        steps.push({
          step: "v4-pool-manager-unlock-swap",
          status: "ok",
          txHash: unlockSwapTxHash,
          explorer: ARC_EXPLORER_BASE + unlockSwapTxHash,
          detail:
            `router=${V4_SWAP_TEST_ROUTER} poolKey.hooks=${poolKey.hooks} ` +
            `zeroForOne=${zeroForOne} amountSpecified=${amountSpecified.toString()} ` +
            `gasUsed=${unlockReceipt.gasUsed.toString()} block=${unlockReceipt.blockNumber.toString()}`,
          durationMs: Date.now() - unlockStart,
        });
      } catch (e) {
        steps.push({
          step: "v4-pool-manager-unlock-swap",
          status: "error",
          detail: `unlock(...) reverted: ${(e as Error).message}`,
          durationMs: Date.now() - unlockStart,
        });
      }
    }
  }

  // Settlement note — the off-chain relay path (keeper-spot consuming
  // GatewayAtomicFxSwapRequested → TelaranaGatewayHubHook.receiveGatewayMint
  // → FxSpotExecutor.executeSpotFx) is still a separate workstream.
  // Tracking marker only; not load-bearing for this script.
  steps.push({
    step: "settle-via-keeper-spot-loop",
    status: "stub",
    detail:
      "Off-chain keeper-spot relay isn't running in this demo (apps/keeper-spot " +
      "is currently a boot-log shell). The v4 swap leg above broadcasts on-chain " +
      "as soon as FX_SWAP_HOOK_ADDRESS + V4_SWAP_TEST_ROUTER are set; the spot-FX " +
      "request submission is already real.",
    stubReason:
      "keeper-spot real-loop wiring (HP1 → PR-H8 / Gateway demo)",
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
        unlockSwapTx: unlockSwapTxHash,
        fxSwapHook: fxSwapHookProbe?.address ?? null,
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

function parseAddressEnv(raw: string | undefined): Address | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null;
  // Reject the zero address — surfaces as "not set" upstream.
  if (trimmed.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  try {
    return getAddress(trimmed);
  } catch {
    return null;
  }
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
