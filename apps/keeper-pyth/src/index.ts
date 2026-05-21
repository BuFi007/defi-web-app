// Pyth EUR/USD keep-warm keeper for Arc Testnet (Wave N2b).
//
// The problem: `FxOracle.getMid(USDC, EURC)` reverts `StalePrice()`
// (0x19abf40e) when no fresh Pyth price has been pushed within
// `maxOracleAge`. `FxSwapHook.beforeSwap` calls `ORACLE.getMid` directly,
// so live swaps revert before consuming reserves.
//
// The fix has two flavours: (a) wrap each demo swap with a same-tx Pyth
// update, or (b) a keep-warm cron. This is (b) -- the production-grade
// story. The demo runs alongside; if the demo deadline slips by 5 minutes,
// prices stay fresh.
//
// Architecture
// ------------
// 1. Subscribe to `wss://hermes.pyth.network/ws` for the configured feed
//    ids (default: EUR/USD + USDC/USD on Arc -- FxOracle.getMid computes
//    USDC↔EURC as a cross-rate, so BOTH feeds must stay fresh).
// 2. On every fresh tick OR every `PYTH_KEEP_WARM_INTERVAL_MS` (default
//    30s, whichever fires first), pull the latest binary VAA via
//    `https://hermes.pyth.network/v2/updates/price/latest?ids[]=...`.
// 3. Quote `Pyth.getUpdateFee([vaa])` then broadcast
//    `Pyth.updatePriceFeeds([vaa])` with `msg.value = fee` from the
//    keeper EOA on Arc.
// 4. Expose `:9100/health` returning `{ ok, lastUpdate, lastTxHash,
//    eurUsdPrice }` so external monitors can probe.
//
// Cost on Arc Testnet
// -------------------
// Pyth charges 1 wei native per feed (see
// https://docs.pyth.network/price-feeds/fee). On Arc Testnet, native gas
// IS USDC -- the keeper logs the actual `gasUsed * effectiveGasPrice`
// per push so the burn rate can be tracked over time. Boot log includes
// the per-day projection.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Re-load workspace .env.local before any other env-touching imports.
// runKeeper does this too, but our process.env reads for the
// keeper-specific vars (PYTH_KEEPER_PRIVATE_KEY, PYTH_HERMES_WS_URL, ...)
// happen at module-top before runKeeper runs, so we have to bootstrap
// ourselves.
(function loadRootEnvLocal(): void {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i += 1) {
      const candidate = join(dir, ".env.local");
      if (existsSync(candidate)) {
        const text = readFileSync(candidate, "utf8");
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
    // Best-effort; downstream `serverEnv()` will surface any real misconfig.
  }
})();

import {
  getRpcUrl,
  PYTH_FEED_IDS,
} from "@bufi/contracts";
import { createHermesClient, HERMES_DEFAULT_WS_URL } from "@bufi/market-data";
import {
  createKeeperWalletClient,
  keeperAccount,
  requireKeeperSigner,
  runKeeper,
  type KeeperContext,
} from "@bufi/keeper-runtime";
import type { Hex } from "viem";
import { createPublicClient, http } from "viem";

// ---------- config ----------

const PYTH_HERMES_WS_URL = process.env.PYTH_HERMES_WS_URL ?? HERMES_DEFAULT_WS_URL;
const PYTH_ARC_CONTRACT = (process.env.PYTH_ARC_CONTRACT ??
  "0x2880aB155794e7179c9eE2e38200202908C17B43") as `0x${string}`;
const PYTH_KEEP_WARM_INTERVAL_MS = Number(
  process.env.PYTH_KEEP_WARM_INTERVAL_MS ?? 30_000,
);
const PYTH_HEALTH_PORT = Number(process.env.PYTH_KEEPER_HEALTH_PORT ?? 9100);

// EUR/USD is the load-bearing price for the M4 demo, but FxOracle
// computes USDC↔EURC as a cross-rate of (USDC/USD * USD/EUR), so the
// `getMid(USDC, EURC)` view needs BOTH feeds fresh. Keep-warm both by
// default; `PYTH_FEED_IDS` env override lets ops add more (e.g. JPY,
// MXN, CHF) once those markets go live without a code change.
const DEFAULT_FEED_IDS: Hex[] = [PYTH_FEED_IDS.eurUsd, PYTH_FEED_IDS.usdUsdc];

function parseFeedIdsEnv(): Hex[] {
  const raw = process.env.PYTH_FEED_IDS;
  if (!raw) return DEFAULT_FEED_IDS;
  const out: Hex[] = [];
  for (const piece of raw.split(",")) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    out.push((trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as Hex);
  }
  return out.length ? out : DEFAULT_FEED_IDS;
}

const FEED_IDS = parseFeedIdsEnv();

// ---------- ABI fragments ----------

// Minimal IPyth surface -- only the two functions we touch. Pulled from
// https://github.com/pyth-network/pyth-sdk-solidity/blob/main/IPyth.sol
const IPyth_ABI = [
  {
    type: "function",
    name: "updatePriceFeeds",
    stateMutability: "payable",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getUpdateFee",
    stateMutability: "view",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [{ name: "feeAmount", type: "uint256" }],
  },
] as const;

// ---------- health snapshot ----------

interface HealthSnapshot {
  ok: boolean;
  bootedAt: number;
  lastUpdate: number | null;
  lastTxHash: string | null;
  eurUsdPrice: number | null;
  lastError: string | null;
  feedIds: string[];
  pythContract: string;
  cadenceMs: number;
  totalUpdates: number;
  totalGasUsdcWei: string;
}

const health: HealthSnapshot = {
  ok: false,
  bootedAt: Date.now(),
  lastUpdate: null,
  lastTxHash: null,
  eurUsdPrice: null,
  lastError: null,
  feedIds: FEED_IDS,
  pythContract: PYTH_ARC_CONTRACT,
  cadenceMs: PYTH_KEEP_WARM_INTERVAL_MS,
  totalUpdates: 0,
  totalGasUsdcWei: "0",
};

let healthServer: ReturnType<typeof Bun.serve> | null = null;
function startHealthEndpoint() {
  if (healthServer) return;
  try {
    healthServer = Bun.serve({
      port: PYTH_HEALTH_PORT,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/health") {
          return new Response("not found", { status: 404 });
        }
        return Response.json(health, { status: health.ok ? 200 : 503 });
      },
    });
  } catch (e) {
    // Most common: EADDRINUSE when running alongside another keeper-pyth
    // instance (e.g. dev:complete restart). Log once and continue -- the
    // keeper itself is the load-bearing piece; /health is observability.
    console.warn(
      `keeper-pyth: health server failed to bind :${PYTH_HEALTH_PORT}`,
      (e as Error).message,
    );
  }
}

// ---------- WS subscription ----------
//
// Bun ships a global `WebSocket` so the @bufi/market-data hermes-ws-client
// (which keys on `globalThis.WebSocket`) works server-side. We use it for
// freshness signalling: when a tick arrives, debounce + trigger an
// immediate push instead of waiting for the next 30s interval. Pyth
// Hermes pushes ~1 tick/sec per feed; without debouncing we'd hammer the
// chain.

let lastWsTickAt = 0;
let pushArmed = false;

async function subscribePythWs(
  log: (event: string, payload?: Record<string, unknown>) => void,
): Promise<{ close(): void } | null> {
  if (typeof globalThis.WebSocket === "undefined") {
    log("pyth.ws_unavailable", { url: PYTH_HERMES_WS_URL });
    return null;
  }
  const { createPythHermesStream } = await import("@bufi/market-data");
  const stream = createPythHermesStream({ url: PYTH_HERMES_WS_URL });
  for (const feed of FEED_IDS) {
    stream.subscribe(feed, (tick) => {
      lastWsTickAt = Date.now();
      pushArmed = true;
      // EUR/USD is the load-bearing price for the demo; surface it on /health.
      if (feed.toLowerCase() === PYTH_FEED_IDS.eurUsd.toLowerCase()) {
        health.eurUsdPrice = tick.price;
      }
    });
  }
  log("pyth.ws_subscribed", { url: PYTH_HERMES_WS_URL, feeds: FEED_IDS.length });
  return stream;
}

// ---------- HTTP VAA fetch ----------

const hermesHttp = createHermesClient();

async function fetchLatestVaa(): Promise<Hex[]> {
  const res = await hermesHttp.latestPriceUpdates(FEED_IDS);
  // Also update health.eurUsdPrice from the parsed price if WS is silent
  for (const parsed of res.prices) {
    const normalized = parsed.id.startsWith("0x") ? parsed.id : `0x${parsed.id}`;
    if (normalized.toLowerCase() === PYTH_FEED_IDS.eurUsd.toLowerCase()) {
      const raw = Number(parsed.price.price);
      if (Number.isFinite(raw)) {
        health.eurUsdPrice = raw * Math.pow(10, parsed.price.expo);
      }
    }
  }
  return res.updateData;
}

// ---------- on-chain push ----------

let lastPushAt = 0;

async function pushPriceUpdate(
  ctx: KeeperContext,
  reason: "interval" | "ws_tick",
): Promise<void> {
  const log = ctx.log;
  const vaa = await fetchLatestVaa();
  if (vaa.length === 0) {
    log.warn("pyth.no_vaa", { reason });
    return;
  }

  // Public client for fee quote + receipt wait (the workspace wallet
  // client doesn't carry a transport-bound public read on every viem
  // version, so we use a dedicated read client).
  const reader = createPublicClient({ transport: http(getRpcUrl(5042002)) });
  const wallet = createKeeperWalletClient(ctx, "arc");
  const account = keeperAccount(ctx);

  let fee = 0n;
  try {
    fee = (await reader.readContract({
      address: PYTH_ARC_CONTRACT,
      abi: IPyth_ABI,
      functionName: "getUpdateFee",
      args: [vaa],
    })) as bigint;
  } catch (e) {
    log.error("pyth.fee_quote_failed", { error: (e as Error).message });
    health.lastError = `getUpdateFee: ${(e as Error).message}`;
    return;
  }

  // Arc has no Chain entry in our viem chain registry; pass `null` so
  // viem skips chain-id validation. The wallet client transport is
  // already pinned to Arc via getRpcUrl(5042002) inside
  // createKeeperWalletClient.
  let txHash: Hex;
  try {
    txHash = await wallet.writeContract({
      account,
      chain: null,
      address: PYTH_ARC_CONTRACT,
      abi: IPyth_ABI,
      functionName: "updatePriceFeeds",
      args: [vaa],
      value: fee,
    });
  } catch (e) {
    log.error("pyth.broadcast_failed", {
      error: (e as Error).message,
      fee: fee.toString(),
    });
    health.lastError = `updatePriceFeeds: ${(e as Error).message}`;
    return;
  }

  // Best-effort receipt wait so we can log gasUsed for honest burn-rate
  // accounting. Cap at 30s so a stuck receipt doesn't gum up the keeper.
  let gasUsed = 0n;
  let effectiveGasPrice = 0n;
  try {
    const receipt = await reader.waitForTransactionReceipt({
      hash: txHash,
      timeout: 30_000,
    });
    gasUsed = receipt.gasUsed;
    effectiveGasPrice = receipt.effectiveGasPrice ?? 0n;
  } catch {
    // Receipt timeout -- the tx may still land; report cost as 0 for now.
  }

  const gasCostWei = gasUsed * effectiveGasPrice;
  const totalCostWei = gasCostWei + fee;
  health.totalUpdates += 1;
  health.totalGasUsdcWei = (BigInt(health.totalGasUsdcWei) + totalCostWei).toString();
  health.lastUpdate = Date.now();
  health.lastTxHash = txHash;
  health.lastError = null;
  health.ok = true;
  lastPushAt = Date.now();

  log.info("pyth.update_pushed", {
    reason,
    txHash,
    fee: fee.toString(),
    gasUsed: gasUsed.toString(),
    gasCostWei: gasCostWei.toString(),
    totalCostWei: totalCostWei.toString(),
    eurUsdPrice: health.eurUsdPrice,
    feeds: FEED_IDS.length,
  });
}

// ---------- main loop ----------

let wsHandle: { close(): void } | null = null;

async function shutdown() {
  try {
    wsHandle?.close();
  } catch {
    // ignore
  }
  try {
    healthServer?.stop();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

// Dry-run check before we start the runtime. The runtime would catch
// the missing signer too via KeeperSignerMissingError, but in dry-run
// we want to STILL connect to Hermes (proves WS works) then exit
// cleanly, which the runtime's infinite loop can't do.
const hasSigner = Boolean(
  process.env.PYTH_KEEPER_PRIVATE_KEY ?? process.env.KEEPER_PRIVATE_KEY,
);

if (!hasSigner) {
  // Connect WS, wait briefly for a tick, log dry-run, exit. Useful for
  // CI smoke / first-run verification on a host without keeper keys.
  startHealthEndpoint();
  const stream = await subscribePythWs((event, payload) => {
    console.log(event, JSON.stringify(payload ?? {}));
  });
  console.log(
    "pyth.dry_run",
    JSON.stringify({
      note: "PYTH_KEEPER_PRIVATE_KEY not configured -- dry-run mode",
      feeds: FEED_IDS.length,
      ws: PYTH_HERMES_WS_URL,
    }),
  );
  // Wait up to 5s for one Hermes tick so we prove the subscription works.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && lastWsTickAt === 0) {
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(
    "pyth.dry_run_done",
    JSON.stringify({
      receivedTick: lastWsTickAt > 0,
      eurUsdPrice: health.eurUsdPrice,
    }),
  );
  stream?.close();
  process.exit(0);
}

// PYTH_KEEPER_PRIVATE_KEY (if set) overrides KEEPER_PRIVATE_KEY so the
// Pyth keeper can run with a dedicated funded EOA without disturbing
// other keepers. Setting both is fine: the override only applies inside
// this process before runKeeper inspects ctx.env.
if (process.env.PYTH_KEEPER_PRIVATE_KEY) {
  process.env.KEEPER_PRIVATE_KEY = process.env.PYTH_KEEPER_PRIVATE_KEY;
}

startHealthEndpoint();

await runKeeper({
  name: "@bufi/keeper-pyth",
  async tick(ctx) {
    requireKeeperSigner(ctx);

    if (!wsHandle) {
      wsHandle = await subscribePythWs((event, payload) =>
        ctx.log.info(event, payload),
      );
      ctx.log.info("pyth.boot", {
        feeds: FEED_IDS.length,
        cadenceMs: PYTH_KEEP_WARM_INTERVAL_MS,
        contract: PYTH_ARC_CONTRACT,
        healthPort: PYTH_HEALTH_PORT,
        signer: keeperAccount(ctx).address,
        // Honest burn projection: assume ~80k gas per update on Arc at
        // 1 nwei effective gas price + Pyth wormhole fee. Numbers refine
        // as we observe real receipts (see pyth.update_pushed logs).
        estimatedDailyUpdates: Math.floor(
          86_400_000 / Math.max(1, PYTH_KEEP_WARM_INTERVAL_MS),
        ),
      });
    }

    const now = Date.now();
    const stale = now - lastPushAt > PYTH_KEEP_WARM_INTERVAL_MS;
    if (pushArmed || stale) {
      pushArmed = false;
      await pushPriceUpdate(ctx, stale ? "interval" : "ws_tick");
    }
  },
});
