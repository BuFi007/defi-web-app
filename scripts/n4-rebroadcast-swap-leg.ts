/**
 * Wave N4 Phase C — Re-broadcast the v4 swap leg of Demo A using
 * FxV4RouterHarness instead of PoolSwapTest.
 *
 * Why this script exists
 * ----------------------
 * N3 broadcast Demo A end-to-end. 3 of 4 legs landed (CCTP burn + Iris +
 * CCTP mint + Pyth refresh). The fourth leg — the v4 swap — reverted
 * because Wave N2a pinned `PoolSwapTest` (the canonical v4-LP-shape
 * router). FxSwapHook is a PMM: during `beforeSwap` it pulls the
 * specified input out of PoolManager via
 * `inputCurrency.take(POOL_MANAGER, hook, amountIn)` at FxSwapHook.sol L731.
 * PoolSwapTest settles input AFTER `manager.swap` returns → PoolManager
 * has 0 USDC when the hook tries to take it → `ERC20: transfer amount
 * exceeds balance`. Verified on-chain by N3's reverted swap artefact
 * 0xde83acb726a6e33c670b1a17f9ce54f22ab72616c063c076bc769458647a62f6.
 *
 * Wave N4 deployed `FxV4RouterHarness` on Arc Testnet at
 * 0x7cfc449B9A6777F740b2F8F7BA87351B15A4B3b6 — it settles input
 * BEFORE `manager.swap`, which is what FxSwapHook needs.
 *
 * This script re-runs just the swap leg with that router pinned. The
 * keeper already has ~20.18 USDC ERC-20 on Arc (post-N3 + N4 router
 * deploy) — no fresh CCTP burn needed.
 *
 * Flow
 * ----
 *   1. Read pre-balances (keeper USDC + EURC on Arc, hook reserves)
 *   2. Refresh Pyth via FxOracle.getMidWithUpdatePyth (FxSwapHook
 *      reads ORACLE.getMid in beforeSwap; if stale, beforeSwap reverts
 *      with StalePrice 0x19abf40e — we need a fresh price within
 *      ~60s of the swap)
 *   3. Approve FxV4RouterHarness to spend AMOUNT USDC from keeper
 *   4. Call FxV4RouterHarness.swapExactInputSingle(poolKey, true,
 *      AMOUNT, 0, recipient=keeper)
 *   5. Read post-balances, compute EURC delta on keeper
 *   6. Write artefact to scripts/n4-cctp-demo-broadcast.json AND
 *      patch scripts/n3-cctp-demo-broadcast.json with a `n4ReBroadcast`
 *      block.
 *
 * Required env (from .env.local)
 * ------------------------------
 *   KEEPER_PRIVATE_KEY — pays gas + signs the swap
 *
 * Tunable env
 * -----------
 *   N4_SWAP_AMOUNT_USDC — exact-input USDC, default "0.01"
 *   N4_SWAP_PYTH_REFRESH — "true" (default) to refresh Pyth pre-swap.
 *                          Set to "false" if a keep-warm daemon is
 *                          already refreshing.
 *
 * Run
 * ---
 *   bun scripts/n4-rebroadcast-swap-leg.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ─────────────────────────── constants ─────────────────────────────────────

const ARC_CHAIN_ID = 5042002 as const;
const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_EXPLORER = "https://testnet.arcscan.app/tx/";

// Canonical Arc Testnet contracts — sourced from
// fx-telarana/deployments/arc-testnet.json (FxV4RouterHarness, FxSwapHook)
// + packages/contracts/src/bento.ts (PoolManager) + memory
// reference_arc_addresses.md (FxOracle, Pyth).
const POOL_MANAGER = "0x3FA22b7Aeda9ebBe34732ea394f1711887363B34" as const;
const FX_SWAP_HOOK = "0xC6F894f30d0D28972C876B4af58C02A4E88A0aC8" as const;
const FX_ORACLE = "0x77b3A3B420dB98B01085b8C46a753Ed9879e2865" as const;
const FX_V4_ROUTER_HARNESS =
  "0x7cfc449B9A6777F740b2F8F7BA87351B15A4B3b6" as const;
const USDC = "0x3600000000000000000000000000000000000000" as const;
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as const;

// PoolKey (M4 init): currency0=USDC, currency1=EURC, fee=100, tickSpacing=1.
const POOL_FEE = 100;
const POOL_TICK_SPACING = 1;

// Pyth feed IDs — sourced from packages/contracts/src/index.ts PYTH_FEED_IDS.
const PYTH_FEED_USDC_USD =
  "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a" as const;
const PYTH_FEED_EUR_USD =
  "0x76fa85158bf14ede77087fe3ae472f66213f6ea2f5b411cb2de472794990fa5c" as const;
const HERMES_BASE = "https://hermes.pyth.network";

const AMOUNT_USDC_STR = process.env.N4_SWAP_AMOUNT_USDC ?? "0.01";
const PYTH_REFRESH = (process.env.N4_SWAP_PYTH_REFRESH ?? "true") === "true";
const AMOUNT_RAW = parseUnits(AMOUNT_USDC_STR, 6);

const OUTPUT_PATH = resolve(import.meta.dir, "n4-cctp-demo-broadcast.json");
const N3_ARTEFACT_PATH = resolve(
  import.meta.dir,
  "n3-cctp-demo-broadcast.json",
);

// ─────────────────────────── ABIs ──────────────────────────────────────────

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const FX_ORACLE_ABI = parseAbi([
  "function getMid(address base, address quote) view returns (int256 midE18, uint256 publishedAt)",
  "function getMidWithUpdatePyth(address base, address quote, bytes[] pythUpdate) payable returns (uint256 midE18, uint256 publishedAt)",
]);

const FX_V4_ROUTER_HARNESS_ABI = parseAbi([
  "function swapExactInputSingle((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, bool zeroForOne, uint256 amountIn, uint256 amountOutMinimum, address recipient) returns (uint256 amountOut)",
  "function manager() view returns (address)",
]);

// ─────────────────────────── chain ────────────────────────────────────────

const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { decimals: 6, name: "USDC", symbol: "USDC" },
  rpcUrls: { default: { http: [ARC_RPC] } },
});

// ─────────────────────────── main ─────────────────────────────────────────

interface Step {
  step: string;
  status: "ok" | "skipped" | "error";
  txHash?: Hex;
  explorer?: string;
  detail?: string;
  gasUsed?: string;
  blockNumber?: string;
  durationMs?: number;
}

interface Artefact {
  wave: "N4-PhaseC";
  broadcastAt: string;
  agent: string;
  preReq: { fxV4RouterHarness: Address; fxV4RouterHarnessDeployTx: Hex };
  network: { chainId: number; name: string; rpc: string };
  actor: { keeper: Address };
  contracts: {
    poolManager: Address;
    fxSwapHook: Address;
    fxOracle: Address;
    fxV4RouterHarness: Address;
    usdc: Address;
    eurc: Address;
  };
  poolKey: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  };
  amount: {
    raw: string;
    human: string;
    direction: "USDC→EURC (zeroForOne=true)";
  };
  balances: {
    before: Record<string, string>;
    after: Record<string, string>;
    deltas: Record<string, string>;
  };
  steps: Step[];
  outcome: {
    swapLeg: "PROVED LIVE" | "STILL BLOCKED" | "ERROR";
    realTimeFxSwapPoolUsingCctp: "PROVED LIVE" | "PARTIALLY PROVED" | "BLOCKED";
    evidence: string;
  };
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const broadcastAt = new Date().toISOString();
  const steps: Step[] = [];

  const pk = requirePk("KEEPER_PRIVATE_KEY");
  const keeper = privateKeyToAccount(pk);

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(ARC_RPC),
  });
  const walletClient = createWalletClient({
    chain: arcTestnet,
    transport: http(ARC_RPC),
    account: keeper,
  });

  console.log(`▶ Wave N4 Phase C — re-broadcast swap leg`);
  console.log(`  keeper: ${keeper.address}`);
  console.log(`  amount: ${AMOUNT_USDC_STR} USDC (raw ${AMOUNT_RAW})`);
  console.log(`  router: ${FX_V4_ROUTER_HARNESS}`);

  // Sanity check: confirm the router has manager() == PoolManager.
  const routerManager = await publicClient.readContract({
    address: FX_V4_ROUTER_HARNESS,
    abi: FX_V4_ROUTER_HARNESS_ABI,
    functionName: "manager",
  });
  if (routerManager.toLowerCase() !== POOL_MANAGER.toLowerCase()) {
    throw new Error(
      `FxV4RouterHarness.manager() = ${routerManager}, expected ${POOL_MANAGER}`,
    );
  }
  steps.push({
    step: "router-manager-sanity",
    status: "ok",
    detail: `manager() = ${routerManager}`,
  });

  // ── pre-balances ───────────────────────────────────────────────────────
  const [usdcBefore, eurcBefore, hookUsdcBefore, hookEurcBefore] =
    await Promise.all([
      publicClient.readContract({
        address: USDC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [keeper.address],
      }),
      publicClient.readContract({
        address: EURC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [keeper.address],
      }),
      publicClient.readContract({
        address: USDC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [FX_SWAP_HOOK],
      }),
      publicClient.readContract({
        address: EURC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [FX_SWAP_HOOK],
      }),
    ]);

  const before: Record<string, string> = {
    "keeper.usdc": formatUnits(usdcBefore, 6),
    "keeper.eurc": formatUnits(eurcBefore, 6),
    "hook.usdc": formatUnits(hookUsdcBefore, 6),
    "hook.eurc": formatUnits(hookEurcBefore, 6),
  };

  if (usdcBefore < AMOUNT_RAW) {
    throw new Error(
      `Keeper USDC ${formatUnits(usdcBefore, 6)} < required ${AMOUNT_USDC_STR}`,
    );
  }

  // ── Pyth refresh ───────────────────────────────────────────────────────
  if (PYTH_REFRESH) {
    const t0 = Date.now();
    try {
      const url = `${HERMES_BASE}/v2/updates/price/latest?ids[]=${PYTH_FEED_USDC_USD}&ids[]=${PYTH_FEED_EUR_USD}`;
      const res = await fetch(url);
      if (!res.ok)
        throw new Error(`Hermes ${res.status} ${res.statusText}`);
      const json: { binary: { data: string[] } } = await res.json();
      const pythBlobs: Hex[] = json.binary.data.map((d) =>
        (d.startsWith("0x") ? d : `0x${d}`) as Hex,
      );

      // Get exact Pyth fee from the on-chain getUpdateFee, then pad x2
      // for safety. Excess is refunded by FxOracle._updatePyth.
      const pythGetUpdateFeeAbi = parseAbi([
        "function getUpdateFee(bytes[] updateData) view returns (uint256)",
      ]);
      const PYTH = "0x2880aB155794e7179c9eE2e38200202908C17B43" as const;
      const fee = await publicClient.readContract({
        address: PYTH,
        abi: pythGetUpdateFeeAbi,
        functionName: "getUpdateFee",
        args: [pythBlobs],
      });
      const value = fee * 2n;

      const txHash = await walletClient.writeContract({
        address: FX_ORACLE,
        abi: FX_ORACLE_ABI,
        functionName: "getMidWithUpdatePyth",
        args: [USDC, EURC, pythBlobs],
        value,
      });
      const r = await publicClient.waitForTransactionReceipt({ hash: txHash });
      steps.push({
        step: "pyth-refresh-pre-swap",
        status: "ok",
        txHash,
        explorer: ARC_EXPLORER + txHash,
        gasUsed: r.gasUsed.toString(),
        blockNumber: r.blockNumber.toString(),
        detail: `Fed ${pythBlobs.length} Pyth blob(s) to FxOracle.getMidWithUpdatePyth(USDC, EURC, ...)`,
        durationMs: Date.now() - t0,
      });
    } catch (e) {
      steps.push({
        step: "pyth-refresh-pre-swap",
        status: "error",
        detail: `${(e as Error).message}`,
        durationMs: Date.now() - t0,
      });
      throw e;
    }
  } else {
    steps.push({
      step: "pyth-refresh-pre-swap",
      status: "skipped",
      detail: "N4_SWAP_PYTH_REFRESH=false",
    });
  }

  // ── approve router ─────────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const allowance = await publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [keeper.address, FX_V4_ROUTER_HARNESS],
    });
    if (allowance >= AMOUNT_RAW) {
      steps.push({
        step: "approve-router",
        status: "skipped",
        detail: `allowance ${formatUnits(allowance, 6)} already ≥ ${AMOUNT_USDC_STR}`,
      });
    } else {
      const txHash = await walletClient.writeContract({
        address: USDC,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [FX_V4_ROUTER_HARNESS, AMOUNT_RAW],
      });
      const r = await publicClient.waitForTransactionReceipt({ hash: txHash });
      steps.push({
        step: "approve-router",
        status: "ok",
        txHash,
        explorer: ARC_EXPLORER + txHash,
        gasUsed: r.gasUsed.toString(),
        blockNumber: r.blockNumber.toString(),
        detail: `approve(${FX_V4_ROUTER_HARNESS}, ${AMOUNT_RAW})`,
        durationMs: Date.now() - t0,
      });
    }
  }

  // ── swap ───────────────────────────────────────────────────────────────
  const t0 = Date.now();
  // currency0 = lower(USDC, EURC) — USDC = 0x3600..0000, EURC = 0x89B5..
  // USDC < EURC lexicographically, so currency0=USDC.
  const poolKey = {
    currency0: USDC,
    currency1: EURC,
    fee: POOL_FEE,
    tickSpacing: POOL_TICK_SPACING,
    hooks: FX_SWAP_HOOK,
  } as const;
  // zeroForOne=true means USDC → EURC (input is currency0).
  // amountOutMinimum=0 for testnet smoke.

  let swapTxHash: Hex | undefined;
  let swapStatus: "ok" | "error" = "ok";
  let swapError: string | undefined;
  let swapReceipt:
    | { gasUsed: bigint; blockNumber: bigint; status: "success" | "reverted" }
    | undefined;
  try {
    swapTxHash = await walletClient.writeContract({
      address: FX_V4_ROUTER_HARNESS,
      abi: FX_V4_ROUTER_HARNESS_ABI,
      functionName: "swapExactInputSingle",
      args: [poolKey, true, AMOUNT_RAW, 0n, keeper.address],
    });
    swapReceipt = await publicClient.waitForTransactionReceipt({
      hash: swapTxHash,
    });
    if (swapReceipt.status !== "success") {
      swapStatus = "error";
      swapError = `tx status=${swapReceipt.status} (reverted on-chain)`;
    }
  } catch (e) {
    swapStatus = "error";
    swapError = (e as Error).message;
  }

  steps.push({
    step: "v4-router-swap-exact-input-single",
    status: swapStatus,
    txHash: swapTxHash,
    explorer: swapTxHash ? ARC_EXPLORER + swapTxHash : undefined,
    detail: swapError
      ? `${swapError}`
      : `router=${FX_V4_ROUTER_HARNESS} zeroForOne=true amountIn=${AMOUNT_RAW.toString()} amountOutMinimum=0`,
    gasUsed: swapReceipt?.gasUsed.toString(),
    blockNumber: swapReceipt?.blockNumber.toString(),
    durationMs: Date.now() - t0,
  });

  // ── post-balances ──────────────────────────────────────────────────────
  const [usdcAfter, eurcAfter, hookUsdcAfter, hookEurcAfter] =
    await Promise.all([
      publicClient.readContract({
        address: USDC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [keeper.address],
      }),
      publicClient.readContract({
        address: EURC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [keeper.address],
      }),
      publicClient.readContract({
        address: USDC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [FX_SWAP_HOOK],
      }),
      publicClient.readContract({
        address: EURC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [FX_SWAP_HOOK],
      }),
    ]);

  const after: Record<string, string> = {
    "keeper.usdc": formatUnits(usdcAfter, 6),
    "keeper.eurc": formatUnits(eurcAfter, 6),
    "hook.usdc": formatUnits(hookUsdcAfter, 6),
    "hook.eurc": formatUnits(hookEurcAfter, 6),
  };

  const deltas: Record<string, string> = {
    "keeper.usdc": deltaStr(usdcBefore, usdcAfter, 6),
    "keeper.eurc": deltaStr(eurcBefore, eurcAfter, 6),
    "hook.usdc": deltaStr(hookUsdcBefore, hookUsdcAfter, 6),
    "hook.eurc": deltaStr(hookEurcBefore, hookEurcAfter, 6),
  };

  const eurcDeltaRaw = eurcAfter - eurcBefore;
  const swapProvedLive = swapStatus === "ok" && eurcDeltaRaw > 0n;

  // ── artefact ───────────────────────────────────────────────────────────
  const artefact: Artefact = {
    wave: "N4-PhaseC",
    broadcastAt,
    agent: "Wave N4 Phase C — re-broadcast swap leg with FxV4RouterHarness",
    preReq: {
      fxV4RouterHarness: FX_V4_ROUTER_HARNESS,
      fxV4RouterHarnessDeployTx:
        "0xedf26e793f8117482f01df92273204864b6bf0fa86e37b9e02dc177df3e417c4" as Hex,
    },
    network: { chainId: ARC_CHAIN_ID, name: "Arc Testnet", rpc: ARC_RPC },
    actor: { keeper: keeper.address },
    contracts: {
      poolManager: POOL_MANAGER,
      fxSwapHook: FX_SWAP_HOOK,
      fxOracle: FX_ORACLE,
      fxV4RouterHarness: FX_V4_ROUTER_HARNESS,
      usdc: USDC,
      eurc: EURC,
    },
    poolKey: { ...poolKey },
    amount: {
      raw: AMOUNT_RAW.toString(),
      human: AMOUNT_USDC_STR,
      direction: "USDC→EURC (zeroForOne=true)",
    },
    balances: { before, after, deltas },
    steps,
    outcome: {
      swapLeg: swapProvedLive
        ? "PROVED LIVE"
        : swapStatus === "error"
          ? "STILL BLOCKED"
          : "ERROR",
      realTimeFxSwapPoolUsingCctp: swapProvedLive
        ? "PROVED LIVE"
        : "PARTIALLY PROVED",
      evidence: swapProvedLive
        ? `Keeper EURC ${before["keeper.eurc"]} → ${after["keeper.eurc"]} (Δ ${deltas["keeper.eurc"]} EURC). FxV4RouterHarness swap tx ${swapTxHash}. Combined with N3's CCTP + Pyth artefacts, all four legs of "Real-Time FX Swap Pools Using CCTP" are now live.`
        : `Swap leg did not deliver EURC. status=${swapStatus} error=${swapError ?? "n/a"}`,
    },
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(artefact, null, 2) + "\n");
  console.log(`\n  ✓ artefact: ${OUTPUT_PATH}`);

  // Patch n3 artefact with the n4ReBroadcast block.
  if (existsSync(N3_ARTEFACT_PATH)) {
    const n3 = JSON.parse(readFileSync(N3_ARTEFACT_PATH, "utf8"));
    n3.n4ReBroadcast = {
      broadcastAt,
      router: FX_V4_ROUTER_HARNESS,
      routerDeployTx:
        "0xedf26e793f8117482f01df92273204864b6bf0fa86e37b9e02dc177df3e417c4",
      pythRefreshTxHash: steps.find(
        (s) => s.step === "pyth-refresh-pre-swap" && s.status === "ok",
      )?.txHash,
      approveRouterTxHash: steps.find(
        (s) => s.step === "approve-router" && s.status === "ok",
      )?.txHash,
      swapTxHash,
      swapStatus,
      swapBlockNumber: swapReceipt?.blockNumber.toString(),
      swapGasUsed: swapReceipt?.gasUsed.toString(),
      eurcDelta: deltas["keeper.eurc"],
      usdcDelta: deltas["keeper.usdc"],
      outcome: artefact.outcome.realTimeFxSwapPoolUsingCctp,
      evidence: artefact.outcome.evidence,
    };
    writeFileSync(N3_ARTEFACT_PATH, JSON.stringify(n3, null, 2) + "\n");
    console.log(`  ✓ patched n3 artefact: ${N3_ARTEFACT_PATH}`);
  }

  console.log(`\n  outcome: ${artefact.outcome.swapLeg}`);
  console.log(`  EURC delta: ${deltas["keeper.eurc"]}`);
  console.log(`  USDC delta: ${deltas["keeper.usdc"]}`);
  if (swapTxHash) console.log(`  swap tx:    ${swapTxHash}`);
  if (swapStatus === "error") process.exit(1);
}

// ─────────────────────────── helpers ─────────────────────────────────────

function requirePk(envName: string): Hex {
  const v = process.env[envName];
  if (!v || !/^0x[a-fA-F0-9]{64}$/.test(v)) {
    throw new Error(`${envName} must be set in .env.local`);
  }
  return v as Hex;
}

function deltaStr(beforeBI: bigint, afterBI: bigint, decimals: number): string {
  const d = afterBI - beforeBI;
  const sign = d > 0n ? "+" : d < 0n ? "-" : "";
  const abs = d < 0n ? -d : d;
  return `${sign}${formatUnits(abs, decimals)}`;
}

function loadDotEnvLocal(): void {
  const envPath = resolve(import.meta.dir, "..", ".env.local");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

main().catch((err) => {
  console.error("n4-rebroadcast-swap-leg fatal:", err);
  process.exit(1);
});
