/**
 * Shared resilient fetch client used by every browser-side backend wrapper
 * (perps, telarana, bento). Centralizes:
 *
 *   - Exponential-backoff + jitter retry on network errors, 5xx, and 429
 *   - `Retry-After` honoring on 429 / 503
 *   - Idempotency-Key auto-generation on POST/PUT/PATCH (stable across retries
 *     of the same logical request — never regenerated)
 *   - 401 refresh hook: caller supplies a one-shot recovery callback
 *     (e.g. re-sign typed-data session) whose returned headers are merged
 *     into a single retry. Designed for READ endpoints — POSTs that carry
 *     user-signed intents must opt out (they require explicit user input
 *     and the caller must handle 401 themselves).
 *   - Upstream AbortSignal propagation: external aborts short-circuit
 *     immediately and re-throw `AbortError`.
 *
 * Returns the raw `Response`; per-client error unwrapping (typed `BentoApiError`,
 * `OracleStaleError`, etc.) stays at the call site.
 */

export interface RetryConfig {
  /** Total attempts including the first one. Default 3. */
  attempts?: number;
  /** Base delay in ms before jitter. Default 250. */
  baseMs?: number;
  /** Hard cap on a single delay in ms (post-exponential, pre-jitter). Default 5000. */
  maxMs?: number;
  /**
   * Decide whether to retry a given outcome. Default retries on:
   *   - network errors (`err` truthy)
   *   - HTTP 5xx
   *   - HTTP 429
   */
  retryOn?: (res: Response | null, err: Error | null) => boolean;
}

export interface ResilientInit extends RequestInit {
  /** Caller-supplied Idempotency-Key. Auto-generated for POST/PUT/PATCH if omitted. */
  idempotencyKey?: string;
  retry?: RetryConfig;
  /**
   * Called at most once when the response is 401. Return `{ headers }` to
   * merge fresh auth headers into a single retry (using the same idempotency
   * key). Return `void`/`undefined` (or throw) to treat the 401 as terminal
   * and bubble the response to the caller.
   */
  onUnauthorized?: () => Promise<{ headers?: HeadersInit } | void>;
}

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_BASE_MS = 250;
const DEFAULT_MAX_MS = 5_000;
const RETRYABLE_METHODS_FOR_DEFAULT = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

/**
 * Default `retryOn` — network failure, any 5xx, or 429.
 * POSTs are retried too because we attach an Idempotency-Key on every
 * write that lacks one. Callers can override via `retry.retryOn`.
 */
function defaultRetryOn(res: Response | null, err: Error | null): boolean {
  if (err) return true;
  if (!res) return false;
  if (res.status === 429) return true;
  if (res.status >= 500 && res.status <= 599) return true;
  return false;
}

function isWriteMethod(method: string | undefined): boolean {
  if (!method) return false;
  const upper = method.toUpperCase();
  return upper === "POST" || upper === "PUT" || upper === "PATCH";
}

/**
 * Parse a `Retry-After` header. Supports both delta-seconds and HTTP-date.
 * Returns `null` if unparseable.
 */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Delta-seconds (integer)
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  // HTTP-date
  const t = Date.parse(trimmed);
  if (Number.isFinite(t)) {
    const delta = t - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

function computeBackoff(attempt: number, baseMs: number, maxMs: number): number {
  // delay = min(maxMs, baseMs * 2^attempt) * (0.5 + Math.random() * 0.5)
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.max(0, Math.floor(exp * jitter));
}

/**
 * Promise-based sleep that rejects with `AbortError` if the signal fires.
 * Avoids leaking listeners; safe to await many times against one signal.
 */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  // DOMException is widely available in modern Node + the browser. Fall back
  // to a plain Error with the right `name` so callers can `err.name === "AbortError"`.
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const e = new Error("The operation was aborted.");
  e.name = "AbortError";
  return e;
}

/**
 * Generate a UUID using `crypto.randomUUID()` when available. Falls back to
 * a random hex string sourced from `crypto.getRandomValues` so we don't break
 * in restricted environments. Idempotency-Key just needs to be opaque and
 * unique per logical request — not cryptographic strength.
 */
function generateIdempotencyKey(): string {
  const g = globalThis as { crypto?: Crypto };
  if (g.crypto && typeof g.crypto.randomUUID === "function") {
    return g.crypto.randomUUID();
  }
  if (g.crypto && typeof g.crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    g.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Last-resort, non-cryptographic. Adequate for retry de-dup, not for auth.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Normalise any HeadersInit shape into a plain mutable record so we can
 * inject Idempotency-Key + refresh headers without mutating the caller's
 * object.
 */
function toHeaderRecord(input: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input) return out;
  if (input instanceof Headers) {
    input.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(input)) {
    for (const [key, value] of input) {
      if (typeof key === "string" && typeof value === "string") out[key] = value;
    }
    return out;
  }
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** Case-insensitive lookup over a header record we control. */
function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) if (k.toLowerCase() === lower) return true;
  return false;
}

export async function resilientFetch(
  input: RequestInfo | URL,
  init: ResilientInit = {},
): Promise<Response> {
  const { retry, idempotencyKey, onUnauthorized, ...rest } = init;
  const attempts = retry?.attempts ?? DEFAULT_RETRY_ATTEMPTS;
  const baseMs = retry?.baseMs ?? DEFAULT_BASE_MS;
  const maxMs = retry?.maxMs ?? DEFAULT_MAX_MS;
  const retryOn = retry?.retryOn ?? defaultRetryOn;

  const method = (rest.method ?? "GET").toUpperCase();
  const signal = rest.signal ?? null;

  // Stable Idempotency-Key — generated once per logical request and reused
  // across every retry. Honors caller-supplied value, otherwise auto-fills on
  // POST/PUT/PATCH. We don't add one for GET/HEAD/DELETE — those are
  // already safe to retry.
  const headers = toHeaderRecord(rest.headers);
  if (isWriteMethod(method) && !hasHeader(headers, "Idempotency-Key")) {
    headers["Idempotency-Key"] = idempotencyKey ?? generateIdempotencyKey();
  } else if (idempotencyKey && !hasHeader(headers, "Idempotency-Key")) {
    // Caller wants idempotency even for non-write methods (rare but supported).
    headers["Idempotency-Key"] = idempotencyKey;
  }

  let refreshAttempted = false;
  let lastResponse: Response | null = null;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) throw abortError();
    lastResponse = null;
    lastError = null;

    try {
      const res = await fetch(input as RequestInfo, { ...rest, headers, signal });

      // 401 — single, opt-in refresh round-trip.
      if (res.status === 401 && onUnauthorized && !refreshAttempted) {
        refreshAttempted = true;
        let recovery: { headers?: HeadersInit } | void;
        try {
          recovery = await onUnauthorized();
        } catch {
          // Treat refresh failure as terminal — bubble the original 401.
          return res;
        }
        if (!recovery || !recovery.headers) {
          // Refresh hook signalled "can't recover" — return the 401 as-is.
          return res;
        }
        // Merge fresh headers (overwriting stale auth) and retry once.
        // We deliberately drain the body of the discarded 401 response so
        // the underlying connection can be reused (no-op in browsers but
        // friendly to node/undici).
        try {
          await res.body?.cancel();
        } catch {
          // ignore
        }
        const merged = toHeaderRecord(recovery.headers);
        for (const [k, v] of Object.entries(merged)) headers[k] = v;
        // Do NOT advance the attempt counter — the refresh consumed a slot
        // but the next iteration is a fresh first-try with new credentials.
        attempt = -1; // will be incremented to 0 by the for-loop
        continue;
      }

      // Success / non-retryable status.
      if (!retryOn(res, null)) return res;

      lastResponse = res;
    } catch (err) {
      // Upstream abort wins.
      if (err instanceof Error && err.name === "AbortError") throw err;
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;
      if (!retryOn(null, error)) throw error;
    }

    const nextAttempt = attempt + 1;
    if (nextAttempt >= attempts) break;

    // Honour Retry-After on 429 / 503 when present; else exponential backoff.
    let delay = computeBackoff(attempt, baseMs, maxMs);
    if (lastResponse && (lastResponse.status === 429 || lastResponse.status === 503)) {
      const retryAfterMs = parseRetryAfter(lastResponse.headers.get("retry-after"));
      if (retryAfterMs !== null) delay = Math.min(retryAfterMs, maxMs);
    }
    await sleep(delay, signal);
  }

  if (lastResponse) return lastResponse;
  // We only get here if every attempt threw and the last threw was retryable —
  // surface the original error so the caller sees the real failure.
  throw lastError ?? new Error("resilientFetch: exhausted retries with no response");
}

/**
 * Convenience wrapper for JSON requests — sets `Content-Type` + `Accept`
 * unless the caller already did. Callers still parse the response body
 * themselves so per-client error shapes stay intact.
 */
export function resilientJsonFetch(
  input: RequestInfo | URL,
  init: ResilientInit = {},
): Promise<Response> {
  const headers = toHeaderRecord(init.headers);
  if (!hasHeader(headers, "Accept")) headers["Accept"] = "application/json";
  if (init.body !== undefined && init.body !== null && !hasHeader(headers, "Content-Type")) {
    headers["Content-Type"] = "application/json";
  }
  return resilientFetch(input, { ...init, headers });
}

// Re-export the default decider so callers can compose policy on top of it.
export const __test = {
  defaultRetryOn,
  computeBackoff,
  parseRetryAfter,
  generateIdempotencyKey,
  RETRYABLE_METHODS_FOR_DEFAULT,
};
