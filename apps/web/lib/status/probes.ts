/**
 * Status-page probes.
 *
 * One async function per service. Every probe:
 *   - Has a hard timeout (default 5s) — a hung backend never blocks
 *     the page render
 *   - Returns a typed `ProbeResult` (never throws) — so the parallel
 *     aggregator can `Promise.all` without `.allSettled` wrapping
 *   - Maps unexpected errors to `status: "down"` with a short
 *     diagnostic message
 *
 * The probes intentionally avoid the shared `resilientFetch` wrapper
 * (apps/web/lib/api-client.ts). The status page wants the *first*
 * answer the service gives — retries would mask transient failures
 * and inflate latency numbers.
 */

import type {
  OverallStatus,
  ProbeResult,
  ServiceMeta,
  StatusPageSnapshot,
} from "./types";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_API_URL = "http://localhost:3002";
const HERMES_DEFAULT_BASE_URL = "https://hermes.pyth.network";
const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network";
const FUJI_DEFAULT_RPC = "https://avalanche-fuji-c-chain-rpc.publicnode.com";

/** Latency tiers — degrade once a service crosses these budgets. */
const LATENCY_DEGRADED_MS = 1_500;
const LATENCY_DEGRADED_MS_HEAVY = 3_000;

/** RPC tip-block freshness — chain is "degraded" if tip > 60s old. */
const RPC_TIP_DEGRADED_S = 60;
const RPC_TIP_DOWN_S = 300;

function apiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_BUFI_API_URL ??
    DEFAULT_API_URL
  );
}

function ponderGraphqlUrl(): string | null {
  // Server-side first (the page is RSC), then a public fallback.
  return (
    process.env.PONDER_GRAPHQL_URL ??
    process.env.PONDER_URL ??
    process.env.NEXT_PUBLIC_PONDER_URL ??
    null
  );
}

function pythHermesUrl(): string {
  return process.env.PYTH_HERMES_URL ?? HERMES_DEFAULT_BASE_URL;
}

function fujiRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL ??
    process.env.FUJI_RPC_URL ??
    FUJI_DEFAULT_RPC
  );
}

function arcRpcUrl(): string {
  return process.env.ARC_TESTNET_RPC_URL ?? ARC_TESTNET_RPC;
}

/** Service catalogue — order drives card render order. */
export const SERVICES: readonly ServiceMeta[] = [
  {
    id: "api",
    name: "BUFI API",
    description: "Hono RPC backend at apps/api — /health, /perps, /fx-*.",
    kind: "api-health",
  },
  {
    id: "ponder",
    name: "Ponder GraphQL",
    description: "Onchain event indexer — perps, telarana, bento.",
    kind: "ponder-graphql",
  },
  {
    id: "pyth-hermes",
    name: "Pyth Hermes",
    description: "Oracle price stream — feeds the mark price + Bento HUD.",
    kind: "pyth-hermes",
  },
  {
    id: "rpc-arc",
    name: "Arc Testnet RPC",
    description: "USDC-as-gas L1 — clearinghouse, settlement, gateway-signer.",
    kind: "rpc-arc",
  },
  {
    id: "rpc-fuji",
    name: "Avalanche Fuji RPC",
    description: "Telarana hub + cross-chain testnet leg.",
    kind: "rpc-fuji",
  },
  {
    id: "keepers",
    name: "Keeper fleet",
    description:
      "perps-matcher, perps-funding, perps-liquidator, telarana-liquidator, gateway-signer, spot, arcade-settler, pyth.",
    kind: "keeper-liveness",
    indirect: true,
  },
] as const;

/**
 * Wrap a fetch in `AbortController` so a hung TCP/TLS handshake can't
 * stall the page render past the timeout budget.
 */
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function buildResult(
  service: ServiceMeta,
  status: ProbeResult["status"],
  message: string,
  startedAt: number,
  details?: ProbeResult["details"],
): ProbeResult {
  const latency = Math.max(0, Math.round(nowMs() - startedAt));
  return {
    service,
    status,
    latencyMs: latency,
    checkedAt: new Date().toISOString(),
    message,
    details,
  };
}

function classifyLatency(
  latencyMs: number,
  heavy = false,
): "operational" | "degraded" {
  const threshold = heavy ? LATENCY_DEGRADED_MS_HEAVY : LATENCY_DEGRADED_MS;
  return latencyMs > threshold ? "degraded" : "operational";
}

/* ──────────────────────────────────────────────────────────────────────
 * Probe: apps/api /health
 * ────────────────────────────────────────────────────────────────────── */
async function probeApiHealth(service: ServiceMeta): Promise<ProbeResult> {
  const startedAt = nowMs();
  const url = `${apiBaseUrl().replace(/\/$/, "")}/health`;
  try {
    const res = await withTimeout((signal) =>
      fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal,
        cache: "no-store",
      }),
    );
    if (!res.ok) {
      return buildResult(
        service,
        "down",
        `HTTP ${res.status} from ${url}`,
        startedAt,
      );
    }
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; ts?: number; status?: string; uptime?: number; version?: string }
      | null;
    // apps/api currently returns `{ok: true, ts}`; the OpenAPIHono variant
    // returns `{status: "ok", uptime, version}`. Accept either shape.
    const healthy = body?.ok === true || body?.status === "ok";
    if (!healthy) {
      return buildResult(
        service,
        "down",
        "Unexpected /health payload shape",
        startedAt,
        { url, body: JSON.stringify(body).slice(0, 200) },
      );
    }
    const latency = Math.round(nowMs() - startedAt);
    return buildResult(
      service,
      classifyLatency(latency),
      "API is responding",
      startedAt,
      {
        url,
        ts: body.ts ?? null,
        uptimeSec: body.uptime ?? null,
        version: body.version ?? null,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildResult(
      service,
      "down",
      message.includes("aborted") ? "Probe timed out" : message,
      startedAt,
      { url },
    );
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * Probe: Ponder GraphQL
 * ────────────────────────────────────────────────────────────────────── */
async function probePonderGraphql(service: ServiceMeta): Promise<ProbeResult> {
  const startedAt = nowMs();
  const url = ponderGraphqlUrl();
  if (!url) {
    return buildResult(
      service,
      "unknown",
      "PONDER_GRAPHQL_URL not configured",
      startedAt,
    );
  }
  try {
    const res = await withTimeout((signal) =>
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ query: "{ __typename }" }),
        signal,
        cache: "no-store",
      }),
    );
    if (!res.ok) {
      return buildResult(
        service,
        "down",
        `HTTP ${res.status} from Ponder`,
        startedAt,
        { url },
      );
    }
    const body = (await res.json().catch(() => null)) as
      | { data?: { __typename?: string }; errors?: unknown[] }
      | null;
    if (!body || body.errors || body.data?.__typename !== "Query") {
      return buildResult(
        service,
        "degraded",
        body?.errors ? "GraphQL returned errors" : "Unexpected GraphQL payload",
        startedAt,
        { url },
      );
    }
    const latency = Math.round(nowMs() - startedAt);
    return buildResult(
      service,
      classifyLatency(latency),
      "GraphQL is responding",
      startedAt,
      { url },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildResult(
      service,
      "down",
      message.includes("aborted") ? "Probe timed out" : message,
      startedAt,
      { url },
    );
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * Probe: Pyth Hermes
 *
 * Hermes has no `/healthz` — we hit `/v2/price_feeds?ids[]=<small>` and
 * accept the latency. A 200 + JSON array is "operational". The full
 * WebSocket subscription path is heavier than we want for a 30s probe
 * cadence; HTTP is enough to know the upstream is alive.
 * ────────────────────────────────────────────────────────────────────── */
const HERMES_BTC_USD_FEED_ID =
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

async function probePythHermes(service: ServiceMeta): Promise<ProbeResult> {
  const startedAt = nowMs();
  const base = pythHermesUrl().replace(/\/$/, "");
  const url = `${base}/v2/updates/price/latest?ids%5B%5D=${HERMES_BTC_USD_FEED_ID}`;
  try {
    const res = await withTimeout(
      (signal) =>
        fetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
          signal,
          cache: "no-store",
        }),
      10_000, // Hermes can be chunky — give it a longer budget
    );
    if (!res.ok) {
      return buildResult(
        service,
        "down",
        `HTTP ${res.status} from Hermes`,
        startedAt,
        { url },
      );
    }
    const body = (await res.json().catch(() => null)) as
      | { parsed?: Array<{ price?: { publish_time?: number } }> }
      | null;
    const publishTime = body?.parsed?.[0]?.price?.publish_time ?? null;
    const ageSec =
      publishTime !== null ? Math.max(0, Math.floor(Date.now() / 1000) - publishTime) : null;
    // Pyth normally publishes every <1s. A stale-by-60s feed is degraded.
    const latency = Math.round(nowMs() - startedAt);
    const latencyStatus = classifyLatency(latency, true);
    let status: ProbeResult["status"] = latencyStatus;
    let message = "Hermes is publishing";
    if (ageSec !== null && ageSec > 60) {
      status = "degraded";
      message = `BTC/USD feed is ${ageSec}s stale`;
    }
    return buildResult(service, status, message, startedAt, {
      url,
      publishTime: publishTime ?? null,
      ageSec,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildResult(
      service,
      "down",
      message.includes("aborted") ? "Probe timed out" : message,
      startedAt,
      { url },
    );
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * Probe: JSON-RPC eth_blockNumber + eth_getBlockByNumber("latest")
 *
 * We make a single batch request, then compare the tip block's
 * `timestamp` against `Date.now() / 1000`. A chain whose tip is more
 * than `RPC_TIP_DOWN_S` seconds old is "down" regardless of latency —
 * the RPC is technically responding but it's serving stale state.
 * ────────────────────────────────────────────────────────────────────── */
async function probeRpc(
  service: ServiceMeta,
  url: string,
): Promise<ProbeResult> {
  const startedAt = nowMs();
  try {
    const res = await withTimeout((signal) =>
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
          {
            jsonrpc: "2.0",
            id: 2,
            method: "eth_getBlockByNumber",
            params: ["latest", false],
          },
        ]),
        signal,
        cache: "no-store",
      }),
    );
    if (!res.ok) {
      return buildResult(
        service,
        "down",
        `HTTP ${res.status} from RPC`,
        startedAt,
        { url },
      );
    }
    type RpcResponse =
      | { id: 1; result?: string; error?: unknown }
      | { id: 2; result?: { number?: string; timestamp?: string }; error?: unknown };
    const raw = (await res.json().catch(() => null)) as
      | RpcResponse[]
      | { result?: string; error?: unknown }
      | null;
    if (!raw) {
      return buildResult(service, "down", "RPC returned invalid JSON", startedAt, {
        url,
      });
    }
    // Some RPCs (e.g. quirky providers) don't support batched JSON-RPC and
    // collapse to a single envelope. Re-probe sequentially as a fallback so
    // the status page never spuriously marks a healthy chain as "down".
    const batch = Array.isArray(raw) ? raw : null;
    let blockNumberHex: string | undefined;
    let block: { number?: string; timestamp?: string } | undefined;
    if (batch) {
      const r1 = batch.find((b) => b.id === 1) as { result?: string } | undefined;
      const r2 = batch.find((b) => b.id === 2) as
        | { result?: { number?: string; timestamp?: string } }
        | undefined;
      blockNumberHex = r1?.result;
      block = r2?.result;
    } else {
      // single-envelope fallback — re-fetch via two requests
      const r1 = await withTimeout((signal) =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_blockNumber",
            params: [],
          }),
          signal,
          cache: "no-store",
        }),
      );
      const r1json = (await r1.json().catch(() => null)) as
        | { result?: string }
        | null;
      blockNumberHex = r1json?.result;
      const r2 = await withTimeout((signal) =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "eth_getBlockByNumber",
            params: ["latest", false],
          }),
          signal,
          cache: "no-store",
        }),
      );
      const r2json = (await r2.json().catch(() => null)) as
        | { result?: { number?: string; timestamp?: string } }
        | null;
      block = r2json?.result ?? undefined;
    }
    if (!blockNumberHex || !block?.timestamp) {
      return buildResult(
        service,
        "down",
        "RPC missing eth_blockNumber/eth_getBlockByNumber result",
        startedAt,
        { url },
      );
    }
    const blockNumber = Number.parseInt(blockNumberHex, 16);
    const blockTs = Number.parseInt(block.timestamp, 16);
    const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - blockTs);
    let status: ProbeResult["status"] = "operational";
    let message = `tip block ${blockNumber} • ${ageSec}s ago`;
    if (ageSec > RPC_TIP_DOWN_S) {
      status = "down";
      message = `Tip block is ${ageSec}s stale`;
    } else if (ageSec > RPC_TIP_DEGRADED_S) {
      status = "degraded";
      message = `Tip block is ${ageSec}s stale`;
    }
    return buildResult(service, status, message, startedAt, {
      url,
      blockNumber,
      blockTimestamp: blockTs,
      ageSec,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildResult(
      service,
      "down",
      message.includes("aborted") ? "Probe timed out" : message,
      startedAt,
      { url },
    );
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * Probe: keeper liveness (INDIRECT placeholder)
 *
 * Wave-F: each keeper exposes `/health`. Until then, this probe queries
 * Ponder for "did any keeper write in the last 5 minutes" — but the
 * required schema fields (last_write_block_by_keeper) don't exist yet.
 * Per the wave-spec stop conditions, we ship v1 with a documented
 * "unknown" status so the operator can tell "TODO" apart from "down".
 * The card surfaces a TODO link to the wave-F item.
 * ────────────────────────────────────────────────────────────────────── */
async function probeKeepers(service: ServiceMeta): Promise<ProbeResult> {
  const startedAt = nowMs();
  return buildResult(
    service,
    "unknown",
    "Indirect probe — wired in Wave F (last-write-block via Ponder)",
    startedAt,
    {
      todo: "apps/keeper-*/health + Ponder lastWriteBlock query",
      indirect: true,
    },
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Aggregator
 * ────────────────────────────────────────────────────────────────────── */
function runProbeFor(service: ServiceMeta): Promise<ProbeResult> {
  switch (service.kind) {
    case "api-health":
      return probeApiHealth(service);
    case "ponder-graphql":
      return probePonderGraphql(service);
    case "pyth-hermes":
      return probePythHermes(service);
    case "rpc-arc":
      return probeRpc(service, arcRpcUrl());
    case "rpc-fuji":
      return probeRpc(service, fujiRpcUrl());
    case "keeper-liveness":
      return probeKeepers(service);
  }
}

/**
 * Run every probe in parallel via `Promise.allSettled`.
 *
 * The probes themselves are total — they always resolve, never reject —
 * but `allSettled` is the belt-and-braces wrap so a future probe that
 * accidentally throws can't take the page down.
 */
export async function runAllProbes(): Promise<StatusPageSnapshot> {
  const settled = await Promise.allSettled(SERVICES.map((s) => runProbeFor(s)));
  const results: ProbeResult[] = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    const service = SERVICES[i]!;
    return {
      service,
      status: "down" as const,
      latencyMs: null,
      checkedAt: new Date().toISOString(),
      message:
        s.reason instanceof Error ? s.reason.message : `Probe crashed: ${String(s.reason)}`,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    overall: resolveOverallStatus(results),
    results,
  };
}

/**
 * Aggregate overall status. "down" wins over "degraded" wins over "operational".
 * "unknown" probes are excluded from the aggregate (they're TODOs, not
 * incidents).
 */
export function resolveOverallStatus(results: ProbeResult[]): OverallStatus {
  let worst: OverallStatus = "operational";
  for (const r of results) {
    if (r.status === "down") return "down";
    if (r.status === "degraded") worst = "degraded";
  }
  return worst;
}
