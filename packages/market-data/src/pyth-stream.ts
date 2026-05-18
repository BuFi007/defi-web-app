/**
 * Typed Pyth Hermes streaming client.
 *
 * Subscribes to a single feed via Hermes' SSE endpoint
 * `${baseUrl}/v2/updates/price/stream?ids[]=${feedId}` and emits parsed,
 * E18-scaled price ticks. On any stream error (network, parse, non-2xx) the
 * client falls back to polling `/v2/updates/price/latest` every 1s.
 *
 * Reconnect uses exponential backoff: 1s, 2s, 5s, 10s, 30s (capped).
 *
 * Designed for the live-market WebSocket route — see
 * `apps/api/src/routes/ws.ts`. No new runtime deps: uses the native global
 * `fetch` + `ReadableStream` available in Bun and Node 18+.
 */
import type { Hex } from "viem";
import { z } from "zod";

import { HERMES_DEFAULT_BASE_URL } from "./index";

// ---------- wire schema (mirrors the SSE event payload) ----------
// Hermes emits the same shape as /v2/updates/price/latest, one JSON blob per
// SSE event. The `parsed` array contains one entry per requested feed id.

const pythParsedPriceSchema = z.object({
  id: z.string(),
  price: z.object({
    price: z.string(),
    conf: z.string(),
    expo: z.number(),
    publish_time: z.number(),
  }),
});

const streamPayloadSchema = z.object({
  parsed: z.array(pythParsedPriceSchema).default([]),
});

// ---------- public types ----------

export interface PythStreamTick {
  /** Mark price, scaled to 1e18. */
  priceE18: bigint;
  /** Confidence interval, scaled to 1e18. Same scale as `priceE18`. */
  confE18: bigint;
  /** Pyth publish_time in unix seconds. */
  ts: number;
}

export interface StreamPythPriceOptions {
  /** Hex feed id (with or without `0x` prefix). */
  feedId: Hex;
  /** Override Hermes base URL — defaults to `HERMES_DEFAULT_BASE_URL`. */
  baseUrl?: string;
  onPrice: (tick: PythStreamTick) => void;
  onError?: (err: unknown) => void;
  /** Test injection. */
  fetchImpl?: typeof fetch;
  /** Override backoff sequence (ms). */
  reconnectDelaysMs?: number[];
}

export type UnsubscribePythStream = () => void;

// ---------- internals ----------

const DEFAULT_BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000];
const POLL_INTERVAL_MS = 1000;
const E18 = 10n ** 18n;

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function buildStreamUrl(baseUrl: string, feedId: Hex): string {
  const url = new URL("/v2/updates/price/stream", baseUrl);
  url.searchParams.append("ids[]", strip0x(feedId));
  return url.toString();
}

function buildLatestUrl(baseUrl: string, feedId: Hex): string {
  const url = new URL("/v2/updates/price/latest", baseUrl);
  url.searchParams.append("ids[]", strip0x(feedId));
  return url.toString();
}

/**
 * Convert Pyth's `(price, expo)` pair to a 1e18-scaled bigint.
 * `expo` is typically negative (e.g. -8 ⇒ price * 10^-8). We rescale to E18
 * without any float intermediate.
 */
function toE18(raw: string, expo: number): bigint {
  const value = BigInt(raw);
  // Effective decimals: priceScaled * 10^(18 + expo) when expo is the Pyth exponent.
  const shift = 18 + expo;
  if (shift >= 0) {
    return value * 10n ** BigInt(shift);
  }
  return value / 10n ** BigInt(-shift);
}

function parseTickFromPayload(payload: unknown, feedId: Hex): PythStreamTick | null {
  const parsed = streamPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const target = strip0x(feedId).toLowerCase();
  const entry = parsed.data.parsed.find((p) => strip0x(p.id).toLowerCase() === target) ?? parsed.data.parsed[0];
  if (!entry) return null;
  return {
    priceE18: toE18(entry.price.price, entry.price.expo),
    confE18: toE18(entry.price.conf, entry.price.expo),
    ts: entry.price.publish_time,
  };
}

// SSE line parser: yields each `data:` payload as it arrives. Hermes uses the
// standard "event-stream" framing: events separated by `\n\n`, fields by `\n`.
async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      // Events are separated by blank lines (`\n\n` or `\r\n\r\n`).
      while ((sep = findEventBoundary(buffer)) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^(?:\r?\n){1,2}/, "");
        const dataLines: string[] = [];
        for (const line of rawEvent.split(/\r?\n/)) {
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).replace(/^ /, ""));
          }
        }
        if (dataLines.length > 0) yield dataLines.join("\n");
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function findEventBoundary(buf: string): number {
  const idxNn = buf.indexOf("\n\n");
  const idxRn = buf.indexOf("\r\n\r\n");
  if (idxNn === -1) return idxRn;
  if (idxRn === -1) return idxNn;
  return Math.min(idxNn, idxRn);
}

// ---------- public API ----------

/**
 * Subscribe to live Pyth price updates for a single feed.
 *
 * The returned function tears down the SSE stream (or polling fallback) and
 * prevents any further reconnect attempts.
 */
export function streamPythPrice(opts: StreamPythPriceOptions): UnsubscribePythStream {
  const baseUrl = opts.baseUrl ?? process.env.HERMES_BASE_URL ?? HERMES_DEFAULT_BASE_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const delays = opts.reconnectDelaysMs ?? DEFAULT_BACKOFF_MS;

  let stopped = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let abortCtrl: AbortController | null = null;

  const emitTick = (tick: PythStreamTick | null) => {
    if (stopped || !tick) return;
    try {
      opts.onPrice(tick);
    } catch (err) {
      // User callback shouldn't kill the stream — surface and continue.
      opts.onError?.(err);
    }
  };

  const reportError = (err: unknown) => {
    if (stopped) return;
    try {
      opts.onError?.(err);
    } catch {
      // swallow — error handlers must not throw recursively.
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    const delay = delays[Math.min(attempt, delays.length - 1)] ?? 30_000;
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectSse();
    }, delay);
  };

  const startPollingFallback = () => {
    if (stopped || pollTimer) return;
    const pollOnce = async () => {
      if (stopped) return;
      try {
        const res = await fetchImpl(buildLatestUrl(baseUrl, opts.feedId));
        if (!res.ok) {
          reportError(new Error(`hermes poll ${res.status}`));
          return;
        }
        const json = (await res.json()) as unknown;
        emitTick(parseTickFromPayload(json, opts.feedId));
      } catch (err) {
        reportError(err);
      }
    };
    void pollOnce();
    pollTimer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  };

  const stopPollingFallback = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const connectSse = async () => {
    if (stopped) return;
    abortCtrl = new AbortController();
    const ctrl = abortCtrl;
    let opened = false;
    try {
      const res = await fetchImpl(buildStreamUrl(baseUrl, opts.feedId), {
        headers: { Accept: "text/event-stream" },
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`hermes stream ${res.status}`);
      }
      opened = true;
      // Successful open — reset backoff and tear down any prior polling.
      attempt = 0;
      stopPollingFallback();
      for await (const data of readSseEvents(res.body, ctrl.signal)) {
        if (stopped) break;
        try {
          const payload = JSON.parse(data) as unknown;
          emitTick(parseTickFromPayload(payload, opts.feedId));
        } catch (err) {
          reportError(err);
        }
      }
    } catch (err) {
      if (stopped) return;
      reportError(err);
      if (!opened) {
        // Connection never established — engage polling fallback so we keep
        // serving data while attempting SSE reconnects in the background.
        startPollingFallback();
      }
    } finally {
      if (!stopped) scheduleReconnect();
    }
  };

  void connectSse();

  return () => {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    stopPollingFallback();
    if (abortCtrl) {
      try {
        abortCtrl.abort();
      } catch {
        // ignore
      }
      abortCtrl = null;
    }
  };
}

export { E18 as PYTH_STREAM_E18_SCALE };
