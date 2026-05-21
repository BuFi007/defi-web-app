/**
 * Wave L2 / PR-H8 — Real-Time FX Swap Pool demo using **Circle Gateway**
 * for intra-hook USDC liquidity. Sibling of `scripts/v4-swap-pool-demo-cctp.ts`
 * (K2). The structural difference between the two scripts IS the hookathon
 * differentiator:
 *
 *                CCTP path (K2)                  Gateway path (L2 / THIS)
 *                ──────────────                  ────────────────────────
 *   1. Fuji burn (depositForBurn)                1. Bind PoolId↔routeId once
 *   2. Iris attestation poll (~30-60s)             (admin one-time)
 *   3. Arc mint (receiveMessage)                 2. Single PoolManager.swap()
 *   4. Arc spot-FX intent                          (Gateway mints USDC
 *                                                  inside beforeSwap atomically)
 *
 * Multiple cross-chain hops + minutes of polling → ONE local tx + zero polling.
 * That's what the submission's new clause means by "Real-Time FX Swap Pools
 * Using Gateway, rather than relying only on CCTP with shared Hub liquidity
 * across chains."
 *
 * What this script does
 * ────────────────────
 * 1. Probes Arc PoolManager (v4) + the TelaranaGatewayHubHook on Arc, the same
 *    way K2 does — so the demo is verifiable in dry-run mode against live
 *    deployments without any funded wallets.
 * 2. In broadcast mode (V4_SWAP_DRY_RUN=false), drives the L2 differentiator:
 *      a. (one-time, idempotent) Admin calls `setPoolGatewayRoute(poolId, routeId)`
 *         on the deployed TelaranaGatewayHubHook to bind a v4 pool to an
 *         existing Gateway route.
 *      b. Taker calls `PoolManager.swap(key, params, hookData)` where
 *         `hookData = abi.encode(attestationPayload, signature, GatewayMintContext)`.
 *         Inside `beforeSwap`, the hook calls `gatewayMint(...)` — USDC is
 *         materialized in the same tx, no off-chain attestation poll.
 *      c. The script prints the SINGLE swap tx hash + a note that there is
 *         intentionally no attestation-poll loop.
 *
 * Stubbed steps (clearly marked in the output JSON)
 * ────────────────────────────────────────────────
 * - The L1-phase-1 of PR-H8 lands the Solidity changes (`setPoolGatewayRoute`,
 *   `beforeSwap`, `GatewayRoutedSwap`, salt-mined hook address). Until that PR
 *   lands on the deployed Arc TelaranaGatewayHubHook *and* the hook address
 *   is mined to encode `BEFORE_SWAP_FLAG | BEFORE_SWAP_RETURNS_DELTA_FLAG`,
 *   PoolManager.swap will revert (the on-chain bits won't match). This script
 *   recognises that state and reports it as `ok-stubbed` rather than `error`.
 * - Off-chain Circle Gateway attestation production for an arbitrary
 *   route + amount is NOT included — broadcasters who want a real tx must
 *   pass `V4_SWAP_GATEWAY_ATTESTATION` + `V4_SWAP_GATEWAY_SIGNATURE` env vars
 *   pre-fetched from Circle's BurnIntent flow. Without them, the script
 *   stops at the binding step and writes a stub marker.
 *
 * Required env (broadcast mode):
 *   - KEEPER_PRIVATE_KEY        Arc gas + (if admin-rooted) the
 *                                setPoolGatewayRoute call.
 *   - TAKER_PRIVATE_KEY         The end-user calling PoolManager.swap.
 *                                Falls back to DEMO_TAKER_PRIVATE_KEY.
 *   - V4_SWAP_GATEWAY_ATTESTATION   Hex bytes — Circle attestation payload.
 *   - V4_SWAP_GATEWAY_SIGNATURE     Hex bytes — Circle attestation signature.
 *
 * Tunable env:
 *   - V4_SWAP_AMOUNT_USDC            per-swap human USDC. Default "1".
 *   - V4_SWAP_TARGET_TOKEN           "EURC" | "JPYC" | "MXNB" | "CHFC". Default EURC.
 *   - V4_SWAP_DRY_RUN                "true" (default) → probe-only exit 0.
 *   - V4_SWAP_GATEWAY_ROUTE_ID       optional override; defaults to LIVE_ROUTE_IDS[*].
 *   - V4_SWAP_GATEWAY_REQUEST_ID     deterministic request id; defaults to a
 *                                     keccak256 of run-timestamp + taker.
 *
 * Output:
 *   scripts/v4-swap-pool-demo-gateway.output.json
 *
 * Run:
 *   bun run demo:v4-swap-pool-gateway
 *     # dry-run by default — safe with no funded wallets
 *   V4_SWAP_DRY_RUN=false bun run demo:v4-swap-pool-gateway
 *     # actually broadcasts (single Arc tx, no Iris polling)
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
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
  defineChain,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  http,
  keccak256,
  parseAbi,
  parseAbiParameters,
  parseUnits,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ─────────────────────────── constants ──────────────────────────────────

const ARC_CHAIN_ID = 5042002 as const;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(SCRIPT_DIR, "v4-swap-pool-demo-gateway.output.json");
const ARC_EXPLORER_BASE = "https://testnet.arcscan.app/tx/";

// HubAction enum positions — match `ITelaranaGatewayHubHook.GatewayHubAction`.
const HUB_ACTION_MINT_TO_HUB = 0 as const;
// const HUB_ACTION_MINT_AND_REQUEST_SPOT_FX = 1 as const;

// ─────────────────────────── env knobs ──────────────────────────────────

const AMOUNT_USDC_STR = process.env.V4_SWAP_AMOUNT_USDC ?? "1";
const AMOUNT_RAW = parseUnits(AMOUNT_USDC_STR, 6);
const TARGET_TOKEN = (process.env.V4_SWAP_TARGET_TOKEN ??
  "EURC") as SpotFxSymbol;
const DRY_RUN = (process.env.V4_SWAP_DRY_RUN ?? "true").toLowerCase() === "true";

const ROUTE_ID_OVERRIDE = process.env.V4_SWAP_GATEWAY_ROUTE_ID as
  | Hex
  | undefined;
const REQUEST_ID_OVERRIDE = process.env.V4_SWAP_GATEWAY_REQUEST_ID as
  | Hex
  | undefined;
const ATTESTATION = process.env.V4_SWAP_GATEWAY_ATTESTATION as Hex | undefined;
const ATTESTATION_SIGNATURE = process.env.V4_SWAP_GATEWAY_SIGNATURE as
  | Hex
  | undefined;

// ─────────────────────────── ABIs (inline) ──────────────────────────────

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

// Uniswap v4 PoolManager — minimal probe + swap surface.
//
// NB: The "swap-style" entrypoint on v4 PoolManager is `unlock(callbackData)`
//   which calls back into the caller with `unlockCallback`. End users do NOT
//   call `swap` directly. For this demo we encode the SWAP via the standard
//   periphery pattern (e.g. UniversalRouter or PositionManager) — but since
//   the periphery contract pinning for Arc isn't synced into @bufi/contracts
//   yet, we surface the call shape inline as a *stub marker* and probe the
//   PoolManager via `extsload` (same shape as K2 / scripts/v4-swap-pool-demo-cctp.ts).
const POOL_MANAGER_PROBE_ABI = parseAbi([
  "function extsload(bytes32 slot) view returns (bytes32)",
]);

// Inline mirror of the PR-H8 IHooks surface we added in fx-telarana#33. The
// canonical ABI sync (packages/contracts/src/abis/TelaranaGatewayHubHook.ts)
// hasn't picked these up yet — that's a tiny follow-on PR. Until then we
// hold the new selectors here so the dry-run probe can verify whether the
// deployed contract on Arc has the new entrypoints.
const TGH_GATEWAY_IHOOKS_STUB_ABI = parseAbi([
  "function setPoolGatewayRoute(bytes32 poolId, bytes32 routeId)",
  "function poolGatewayRouteBinding(bytes32 poolId) view returns (bytes32)",
  "function getHookPermissions() view returns ((bool beforeInitialize, bool afterInitialize, bool beforeAddLiquidity, bool afterAddLiquidity, bool beforeRemoveLiquidity, bool afterRemoveLiquidity, bool beforeSwap, bool afterSwap, bool beforeDonate, bool afterDonate, bool beforeSwapReturnDelta, bool afterSwapReturnDelta, bool afterAddLiquidityReturnDelta, bool afterRemoveLiquidityReturnDelta))",
]);

// ─────────────────────────── types ──────────────────────────────────────

interface DemoOutput {
  ranAt: string;
  status: "ok" | "ok-stubbed" | "blocked" | "dry-run" | "error";
  reason?: string;
  dryRun: boolean;
  differentiatorNote: string;
  network: {
    chainId: typeof ARC_CHAIN_ID;
    poolManager: Address | null;
    telaranaGatewayHubHook: Address | null;
    usdc: Address | null;
    targetTokenSymbol: SpotFxSymbol;
    targetTokenAddress: Address | null;
    spotRouteId: Hex;
    routeId: Hex;
    requestId: Hex;
    gatewayMinter: Address;
  };
  actors: {
    keeper: { address: Address };
    taker: { address: Address };
  };
  amountUsdc: string;
  amountRaw: string;
  steps: DemoStep[];
  swapTxHash: Hex | null;
  noAttestationPolling: true; // declarative — the whole point of L2 vs K2
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

// ─────────────────────────── differentiator note ───────────────────────

const DIFFERENTIATOR_NOTE =
  "Real-Time FX Swap Pools Using Gateway: single PoolManager.swap() tx, Gateway " +
  "mints USDC inside beforeSwap, ZERO Iris attestation polling. This is the " +
  "PR-H8 differentiator over CCTP-only flows.";

// ─────────────────────────── main ───────────────────────────────────────

main().catch((err) => {
  console.error("v4-swap-pool-demo-gateway fatal:", err);
  writeOutput({
    ranAt: new Date().toISOString(),
    status: "error",
    reason: (err as Error).message ?? String(err),
    dryRun: DRY_RUN,
    differentiatorNote: DIFFERENTIATOR_NOTE,
    network: networkSnapshot(),
    actors: {
      keeper: { address: zeroAddress() },
      taker: { address: zeroAddress() },
    },
    amountUsdc: AMOUNT_USDC_STR,
    amountRaw: AMOUNT_RAW.toString(),
    steps: [],
    swapTxHash: null,
    noAttestationPolling: true,
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
  const takerPk = readPk(["TAKER_PRIVATE_KEY", "DEMO_TAKER_PRIVATE_KEY"]);

  const missing: string[] = [];
  if (!keeperPk) missing.push("KEEPER_PRIVATE_KEY");
  if (!takerPk) missing.push("TAKER_PRIVATE_KEY (or DEMO_TAKER_PRIVATE_KEY)");

  if (missing.length > 0) {
    const reason = `missing required env vars in .env.local: ${missing.join(", ")}`;
    console.error(`[v4-swap-demo-gateway] ${reason}`);
    writeOutput({
      ranAt,
      status: "blocked",
      reason,
      dryRun: DRY_RUN,
      differentiatorNote: DIFFERENTIATOR_NOTE,
      network: networkSnapshot(),
      actors: {
        keeper: { address: zeroAddress() },
        taker: { address: zeroAddress() },
      },
      amountUsdc: AMOUNT_USDC_STR,
      amountRaw: AMOUNT_RAW.toString(),
      steps: [{ step: "env-gate", status: "blocked", detail: reason }],
      swapTxHash: null,
      noAttestationPolling: true,
      balances: emptyBalances(),
    });
    process.exit(2);
  }

  const keeperAccount = privateKeyToAccount(keeperPk! as Hex);
  const takerAccount = privateKeyToAccount(takerPk! as Hex);

  console.log("[v4-swap-demo-gateway] addresses", {
    keeper: keeperAccount.address,
    taker: takerAccount.address,
    dryRun: DRY_RUN,
    targetToken: TARGET_TOKEN,
    amountUsdc: AMOUNT_USDC_STR,
  });

  // ── network context ──────────────────────────────────────────────────
  const arcContracts = CONTRACTS[ARC_CHAIN_ID];
  const arcUsdc = arcContracts.tokens.usdc;
  const arcTelaranaHook = arcContracts.telarana.telaranaGatewayHubHook ?? null;
  const arcPoolManager =
    BENTO_DEPLOYMENTS[ARC_CHAIN_ID]?.addresses.PoolManager ?? null;

  const spotRoute = SPOT_FX_ROUTES[TARGET_TOKEN];
  if (!spotRoute) {
    const reason = `unknown V4_SWAP_TARGET_TOKEN=${TARGET_TOKEN}; must be one of EURC | JPYC | MXNB | CHFC`;
    console.error(`[v4-swap-demo-gateway] ${reason}`);
    writeOutput({
      ranAt,
      status: "blocked",
      reason,
      dryRun: DRY_RUN,
      differentiatorNote: DIFFERENTIATOR_NOTE,
      network: networkSnapshot(),
      actors: {
        keeper: { address: keeperAccount.address },
        taker: { address: takerAccount.address },
      },
      amountUsdc: AMOUNT_USDC_STR,
      amountRaw: AMOUNT_RAW.toString(),
      steps: [{ step: "config-target-token", status: "blocked", detail: reason }],
      swapTxHash: null,
      noAttestationPolling: true,
      balances: emptyBalances(),
    });
    process.exit(2);
  }

  const routeId = (ROUTE_ID_OVERRIDE ??
    LIVE_ROUTE_IDS?.[TARGET_TOKEN] ??
    keccak256(encodePacked(["string"], [`gateway-route-${TARGET_TOKEN}`]))) as Hex;
  const requestId =
    REQUEST_ID_OVERRIDE ??
    (keccak256(
      encodePacked(
        ["address", "uint256", "string"],
        [takerAccount.address, BigInt(Date.now()), "pr-h8-l2-demo"],
      ),
    ) as Hex);

  // ── clients ──────────────────────────────────────────────────────────
  const arcTestnet = defineChain({
    id: ARC_CHAIN_ID,
    name: "Arc Testnet",
    nativeCurrency: { decimals: 6, name: "USDC", symbol: "USDC" },
    rpcUrls: { default: { http: [DEFAULT_RPC_URLS[ARC_CHAIN_ID]] } },
  });
  const arcRpc = DEFAULT_RPC_URLS[ARC_CHAIN_ID];

  const arcPublic = createPublicClient({
    chain: arcTestnet,
    transport: http(arcRpc),
  });
  const arcWalletKeeper = createWalletClient({
    account: keeperAccount,
    chain: arcTestnet,
    transport: http(arcRpc),
  });
  // Taker wallet is materialised once the periphery router is pinned for Arc
  // (see broadcast-pool-manager-swap stub below). For now, the keeper drives
  // the bind step; the swap step is the deferred bit.
  void createWalletClient({
    account: takerAccount,
    chain: arcTestnet,
    transport: http(arcRpc),
  });

  // ── balances (pre) ───────────────────────────────────────────────────
  const balances: DemoOutput["balances"] = emptyBalances();
  if (arcUsdc) {
    balances.takerArcUsdcBefore = (
      await getErc20Balance(arcPublic, arcUsdc, takerAccount.address)
    ).toString();
  }
  if (spotRoute.tokenOut) {
    balances.takerArcTargetBefore = (
      await getErc20Balance(arcPublic, spotRoute.tokenOut, takerAccount.address)
    ).toString();
  }

  // ── step 1: probe Arc v4 PoolManager (verify deployment) ─────────────
  const probeStart = Date.now();
  let arcPoolManagerAlive = false;
  if (arcPoolManager) {
    try {
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

  // ── step 2: probe Arc TelaranaGatewayHubHook ─────────────────────────
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
          arcHookHasGatewayMinter
            ? " (matches canonical Circle Gateway minter)"
            : ""
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
        "CONTRACTS[Arc].telarana.telaranaGatewayHubHook is missing — telarana deploy manifest may not be live",
    });
  }

  // ── step 3: probe the PR-H8 IHooks surface on the deployed hook ──────
  // The PR-H8 fx-telarana diff lands `setPoolGatewayRoute` / `beforeSwap` /
  // `poolGatewayRouteBinding` / `getHookPermissions`. If the deployed hook
  // on Arc still has the pre-PR-H8 bytecode, those reads will revert — we
  // surface that as a `stub` so the demo doesn't lie about end-to-end live
  // execution.
  const ihooksProbeStart = Date.now();
  let arcHookHasPrH8Surface = false;
  if (arcTelaranaHook) {
    try {
      const perms = (await arcPublic.readContract({
        address: arcTelaranaHook,
        abi: TGH_GATEWAY_IHOOKS_STUB_ABI,
        functionName: "getHookPermissions",
      })) as {
        beforeSwap: boolean;
        beforeSwapReturnDelta: boolean;
      };
      arcHookHasPrH8Surface = perms.beforeSwap && perms.beforeSwapReturnDelta;
      steps.push({
        step: "probe-pr-h8-ihooks-surface",
        status: arcHookHasPrH8Surface ? "ok" : "stub",
        detail: arcHookHasPrH8Surface
          ? "getHookPermissions().beforeSwap && beforeSwapReturnDelta — PR-H8 surface is live"
          : `getHookPermissions().beforeSwap=${perms.beforeSwap} beforeSwapReturnDelta=${perms.beforeSwapReturnDelta} — deployed bytecode pre-PR-H8`,
        stubReason: arcHookHasPrH8Surface
          ? undefined
          : "fx-telarana#33 (PR-H8 phase 1) not yet deployed to Arc with mined salt",
        durationMs: Date.now() - ihooksProbeStart,
      });
    } catch (e) {
      steps.push({
        step: "probe-pr-h8-ihooks-surface",
        status: "stub",
        detail: `getHookPermissions() reverted — deployed hook does not expose v4 IHooks surface yet`,
        stubReason: `fx-telarana#33 (PR-H8 phase 1) not yet deployed on Arc — see https://github.com/BuFi007/fx-telarana/pull/33. Error: ${(e as Error).message}`,
        durationMs: Date.now() - ihooksProbeStart,
      });
    }
  } else {
    steps.push({
      step: "probe-pr-h8-ihooks-surface",
      status: "blocked",
      detail: "no TelaranaGatewayHubHook address pinned for Arc",
    });
  }

  // ── step 4: probe poolGatewayRouteBinding for the target pool ────────
  // PoolId for the USDC↔EURC v4 pool on Arc isn't currently pinned in the
  // @bufi/contracts package. We derive a deterministic placeholder id from
  // the target route id so the dry-run probe is reproducible; the real
  // PoolId comes from `keccak256(abi.encode(PoolKey))` which we can't
  // produce here without the canonical PoolKey shape for the Arc pool —
  // that lives in the bento deploy manifest (B-wave deliverable).
  const placeholderPoolId = keccak256(
    encodePacked(["bytes32", "string"], [routeId, "placeholder-pool-id-L2-demo"]),
  ) as Hex;

  if (arcTelaranaHook && arcHookHasPrH8Surface) {
    try {
      const bound = (await arcPublic.readContract({
        address: arcTelaranaHook,
        abi: TGH_GATEWAY_IHOOKS_STUB_ABI,
        functionName: "poolGatewayRouteBinding",
        args: [placeholderPoolId],
      })) as Hex;
      const isBound =
        bound !==
        "0x0000000000000000000000000000000000000000000000000000000000000000";
      steps.push({
        step: "probe-pool-gateway-route-binding",
        status: isBound ? "ok" : "stub",
        detail: `poolGatewayRouteBinding(${placeholderPoolId}) = ${bound}`,
        stubReason: isBound
          ? undefined
          : "no pool binding for the placeholder PoolId; admin must call setPoolGatewayRoute(poolId, routeId) in broadcast mode",
      });
    } catch (e) {
      steps.push({
        step: "probe-pool-gateway-route-binding",
        status: "stub",
        detail: `poolGatewayRouteBinding read reverted: ${(e as Error).message}`,
        stubReason: "PR-H8 surface not on-chain yet",
      });
    }
  } else {
    steps.push({
      step: "probe-pool-gateway-route-binding",
      status: "stub",
      detail: "skipped — PR-H8 surface not present on deployed hook",
      stubReason:
        "Pending fx-telarana#33 deploy + setPoolGatewayRoute(poolId, routeId) call",
    });
  }

  // ── step 5 (annotation): the CCTP path THIS DEMO INTENTIONALLY SKIPS ─
  steps.push({
    step: "no-cctp-attestation-poll",
    status: "ok",
    detail:
      "By design, this demo skips the Fuji burn → Iris poll → Arc receiveMessage " +
      "leg entirely. The whole point of Gateway intra-hook liquidity is that the " +
      "USDC materialises atomically inside `beforeSwap`. K2 (scripts/v4-swap-pool-demo-cctp.ts) " +
      "shows the CCTP comparator.",
  });

  // ── dry-run gate ─────────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log("[v4-swap-demo-gateway] DRY_RUN=true — exiting after probes");
    steps.push({
      step: "dry-run-exit",
      status: "dry-run",
      detail:
        "V4_SWAP_DRY_RUN=true (default). Pass V4_SWAP_DRY_RUN=false plus " +
        "V4_SWAP_GATEWAY_ATTESTATION + V4_SWAP_GATEWAY_SIGNATURE to actually broadcast.",
    });
    writeOutput({
      ranAt,
      status: anyStub(steps) ? "ok-stubbed" : "dry-run",
      dryRun: true,
      differentiatorNote: DIFFERENTIATOR_NOTE,
      network: networkSnapshot({
        arcUsdc,
        arcPoolManager,
        arcTelaranaHook,
        spotRouteId: spotRoute.routeId,
        targetTokenAddress: spotRoute.tokenOut,
        routeId,
        requestId,
      }),
      actors: {
        keeper: { address: keeperAccount.address },
        taker: { address: takerAccount.address },
      },
      amountUsdc: AMOUNT_USDC_STR,
      amountRaw: AMOUNT_RAW.toString(),
      steps,
      swapTxHash: null,
      noAttestationPolling: true,
      balances,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "dry-run",
          arcPoolManagerAlive,
          arcHookHasGatewayMinter,
          arcHookHasPrH8Surface,
          steps: steps.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  // ── BROADCAST PATH ───────────────────────────────────────────────────

  if (!arcTelaranaHook) {
    failBlocked(
      "no Arc TelaranaGatewayHubHook pinned",
      steps,
      keeperAccount.address,
      takerAccount.address,
      arcPoolManager,
      arcUsdc,
      spotRoute,
      routeId,
      requestId,
      balances,
      ranAt,
    );
    return;
  }

  if (!ATTESTATION || !ATTESTATION_SIGNATURE) {
    steps.push({
      step: "gateway-attestation-fetch",
      status: "stub",
      detail:
        "V4_SWAP_GATEWAY_ATTESTATION and/or V4_SWAP_GATEWAY_SIGNATURE not set. " +
        "Off-chain Circle Gateway BurnIntent flow must run separately to mint " +
        "an attestation for this routeId+amount+recipient.",
      stubReason:
        "Live Circle Gateway attestation production is out of scope for this demo script; " +
        "supply env vars from the upstream Burn flow.",
    });
    writeOutput({
      ranAt,
      status: "ok-stubbed",
      dryRun: false,
      differentiatorNote: DIFFERENTIATOR_NOTE,
      network: networkSnapshot({
        arcUsdc,
        arcPoolManager,
        arcTelaranaHook,
        spotRouteId: spotRoute.routeId,
        targetTokenAddress: spotRoute.tokenOut,
        routeId,
        requestId,
      }),
      actors: {
        keeper: { address: keeperAccount.address },
        taker: { address: takerAccount.address },
      },
      amountUsdc: AMOUNT_USDC_STR,
      amountRaw: AMOUNT_RAW.toString(),
      steps,
      swapTxHash: null,
      noAttestationPolling: true,
      balances,
    });
    return;
  }

  if (!arcHookHasPrH8Surface) {
    steps.push({
      step: "broadcast-prerequisite",
      status: "stub",
      detail:
        "Deployed hook bytecode predates PR-H8 — broadcast aborted to avoid a guaranteed revert.",
      stubReason:
        "Wait for fx-telarana#33 to land on Arc with a mined hook address before retrying.",
    });
    writeOutput({
      ranAt,
      status: "ok-stubbed",
      dryRun: false,
      differentiatorNote: DIFFERENTIATOR_NOTE,
      network: networkSnapshot({
        arcUsdc,
        arcPoolManager,
        arcTelaranaHook,
        spotRouteId: spotRoute.routeId,
        targetTokenAddress: spotRoute.tokenOut,
        routeId,
        requestId,
      }),
      actors: {
        keeper: { address: keeperAccount.address },
        taker: { address: takerAccount.address },
      },
      amountUsdc: AMOUNT_USDC_STR,
      amountRaw: AMOUNT_RAW.toString(),
      steps,
      swapTxHash: null,
      noAttestationPolling: true,
      balances,
    });
    return;
  }

  // ── step 6: (admin) bind the pool to a Gateway route ──────────────────
  // We pose the keeper as admin here; if `keeperAccount` doesn't actually
  // hold DEFAULT_ADMIN_ROLE the call will revert — surface that as a stub
  // rather than catching only the happy path.
  const bindStart = Date.now();
  let bindTxHash: Hex | null = null;
  try {
    const existingBinding = (await arcPublic.readContract({
      address: arcTelaranaHook,
      abi: TGH_GATEWAY_IHOOKS_STUB_ABI,
      functionName: "poolGatewayRouteBinding",
      args: [placeholderPoolId],
    })) as Hex;
    if (
      existingBinding ===
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      bindTxHash = await arcWalletKeeper.writeContract({
        address: arcTelaranaHook,
        abi: TGH_GATEWAY_IHOOKS_STUB_ABI,
        functionName: "setPoolGatewayRoute",
        args: [placeholderPoolId, routeId],
      });
      steps.push({
        step: "bind-pool-to-gateway-route",
        status: "ok",
        detail: `setPoolGatewayRoute(${placeholderPoolId}, ${routeId})`,
        txHash: bindTxHash,
        explorer: `${ARC_EXPLORER_BASE}${bindTxHash}`,
        durationMs: Date.now() - bindStart,
      });
    } else {
      steps.push({
        step: "bind-pool-to-gateway-route",
        status: "skipped",
        detail: `poolGatewayRouteBinding already set: ${existingBinding}`,
      });
    }
  } catch (e) {
    steps.push({
      step: "bind-pool-to-gateway-route",
      status: "error",
      detail: `setPoolGatewayRoute reverted: ${(e as Error).message}`,
    });
    writeOutput({
      ranAt,
      status: "error",
      reason: "setPoolGatewayRoute reverted",
      dryRun: false,
      differentiatorNote: DIFFERENTIATOR_NOTE,
      network: networkSnapshot({
        arcUsdc,
        arcPoolManager,
        arcTelaranaHook,
        spotRouteId: spotRoute.routeId,
        targetTokenAddress: spotRoute.tokenOut,
        routeId,
        requestId,
      }),
      actors: {
        keeper: { address: keeperAccount.address },
        taker: { address: takerAccount.address },
      },
      amountUsdc: AMOUNT_USDC_STR,
      amountRaw: AMOUNT_RAW.toString(),
      steps,
      swapTxHash: null,
      noAttestationPolling: true,
      balances,
    });
    process.exit(1);
  }

  // ── step 7: encode hookData and drive a single PoolManager.swap() ────
  // The hookData carries (attestationPayload, signature, GatewayMintContext).
  // beforeSwap will call gatewayMint(...) atomically and credit USDC to the
  // PoolManager via the returned BeforeSwapDelta.
  const hookData = encodeAbiParameters(
    parseAbiParameters(
      "bytes attestation, bytes signature, (bytes32 routeId, bytes32 requestId, uint8 action, address sourceDepositor, address sourceSigner, address recipient, address tokenOut, uint256 amount, uint256 minAmountOut, bytes32 spotRouteId, bytes32 metadataRef, bytes hookData) context",
    ),
    [
      ATTESTATION,
      ATTESTATION_SIGNATURE,
      {
        routeId,
        requestId,
        action: HUB_ACTION_MINT_TO_HUB,
        sourceDepositor: takerAccount.address,
        sourceSigner: takerAccount.address,
        recipient: takerAccount.address,
        tokenOut: "0x0000000000000000000000000000000000000000" as Address,
        amount: AMOUNT_RAW,
        minAmountOut: 0n,
        spotRouteId:
          "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
        metadataRef:
          "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
        hookData: "0x" as Hex,
      },
    ],
  );

  // The PoolManager.swap call must go via `unlock` + the periphery
  // settlement pattern in production. For this demo the periphery
  // address isn't pinned for Arc yet, so we surface a stub for that step
  // rather than ship a half-rolled call that would revert.
  steps.push({
    step: "broadcast-pool-manager-swap",
    status: "stub",
    detail:
      "Encoded hookData (attestation + signature + GatewayMintContext) is ready. " +
      "PoolManager.swap requires the unlock + settle periphery pattern; the canonical " +
      "Arc periphery contract (V4Router / UniversalRouter / Permit2 forwarder) " +
      "address is not yet pinned in @bufi/contracts — see B-wave deploy manifests. " +
      `hookData length: ${(hookData.length - 2) / 2} bytes.`,
    stubReason:
      "Arc periphery deploy not synced; once `BENTO_DEPLOYMENTS[ARC].addresses.V4Router` " +
      "is pinned, this step swaps to a single `router.swap(...)` call carrying hookData.",
  });

  // ── balances (post) ──────────────────────────────────────────────────
  if (arcUsdc) {
    balances.takerArcUsdcAfter = (
      await getErc20Balance(arcPublic, arcUsdc, takerAccount.address)
    ).toString();
  }
  if (spotRoute.tokenOut) {
    balances.takerArcTargetAfter = (
      await getErc20Balance(arcPublic, spotRoute.tokenOut, takerAccount.address)
    ).toString();
  }

  // ── final rollup ────────────────────────────────────────────────────
  const status: DemoOutput["status"] = anyError(steps)
    ? "error"
    : anyStub(steps)
      ? "ok-stubbed"
      : "ok";
  writeOutput({
    ranAt,
    status,
    dryRun: false,
    differentiatorNote: DIFFERENTIATOR_NOTE,
    network: networkSnapshot({
      arcUsdc,
      arcPoolManager,
      arcTelaranaHook,
      spotRouteId: spotRoute.routeId,
      targetTokenAddress: spotRoute.tokenOut,
      routeId,
      requestId,
    }),
    actors: {
      keeper: { address: keeperAccount.address },
      taker: { address: takerAccount.address },
    },
    amountUsdc: AMOUNT_USDC_STR,
    amountRaw: AMOUNT_RAW.toString(),
    steps,
    swapTxHash: null, // see stub above; the SINGLE swap tx hash lands here
    // once the periphery router is pinned.
    noAttestationPolling: true,
    balances,
  });
  console.log(
    JSON.stringify(
      {
        ok: status === "ok" || status === "ok-stubbed",
        status,
        bindTx: bindTxHash,
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
  arcPoolManager?: Address | null;
  arcTelaranaHook?: Address | null;
  spotRouteId?: Hex;
  targetTokenAddress?: Address | null;
  routeId?: Hex;
  requestId?: Hex;
}): DemoOutput["network"] {
  return {
    chainId: ARC_CHAIN_ID,
    poolManager: extra?.arcPoolManager ?? null,
    telaranaGatewayHubHook: extra?.arcTelaranaHook ?? null,
    usdc: extra?.arcUsdc ?? null,
    targetTokenSymbol: TARGET_TOKEN,
    targetTokenAddress: extra?.targetTokenAddress ?? null,
    spotRouteId:
      extra?.spotRouteId ??
      ("0x0000000000000000000000000000000000000000000000000000000000000000" as Hex),
    routeId:
      extra?.routeId ??
      ("0x0000000000000000000000000000000000000000000000000000000000000000" as Hex),
    requestId:
      extra?.requestId ??
      ("0x0000000000000000000000000000000000000000000000000000000000000000" as Hex),
    gatewayMinter: CIRCLE_GATEWAY.gatewayMinter as Address,
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

function anyStub(steps: DemoStep[]): boolean {
  return steps.some((s) => s.status === "stub");
}
function anyError(steps: DemoStep[]): boolean {
  return steps.some((s) => s.status === "error");
}

function failBlocked(
  reason: string,
  steps: DemoStep[],
  keeper: Address,
  taker: Address,
  poolManager: Address | null,
  arcUsdc: Address | null,
  spotRoute: (typeof SPOT_FX_ROUTES)[SpotFxSymbol],
  routeId: Hex,
  requestId: Hex,
  balances: DemoOutput["balances"],
  ranAt: string,
): void {
  steps.push({ step: "broadcast-precondition", status: "blocked", detail: reason });
  writeOutput({
    ranAt,
    status: "blocked",
    reason,
    dryRun: false,
    differentiatorNote: DIFFERENTIATOR_NOTE,
    network: networkSnapshot({
      arcUsdc,
      arcPoolManager: poolManager,
      arcTelaranaHook: null,
      spotRouteId: spotRoute.routeId,
      targetTokenAddress: spotRoute.tokenOut,
      routeId,
      requestId,
    }),
    actors: {
      keeper: { address: keeper },
      taker: { address: taker },
    },
    amountUsdc: AMOUNT_USDC_STR,
    amountRaw: AMOUNT_RAW.toString(),
    steps,
    swapTxHash: null,
    noAttestationPolling: true,
    balances,
  });
}

function writeOutput(o: DemoOutput): void {
  writeFileSync(OUTPUT_PATH, JSON.stringify(o, null, 2) + "\n", "utf8");
  console.log(`[v4-swap-demo-gateway] output -> ${OUTPUT_PATH}`);
}

// Mirror of the env loader pattern used by scripts/perps-demo-trade.ts +
// scripts/v4-swap-pool-demo-cctp.ts — picks up .env.local at the workspace
// root so the script doesn't need an extra build step.
function loadDotEnvLocal(): void {
  try {
    const path = resolve(SCRIPT_DIR, "..", ".env.local");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    if (!fs.existsSync(path)) return;
    const content = fs.readFileSync(path, "utf8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // env loader is best-effort; downstream gates surface missing values.
  }
}
