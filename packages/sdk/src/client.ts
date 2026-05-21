/**
 * BUFI HTTP client — thin `fetch`-based wrapper around the BUFI REST API.
 *
 * Designed to be isomorphic (node, browser, edge, deno) — uses the global
 * `fetch` and `AbortSignal`. The `@bufi/api` Hono app does not currently
 * export an `AppType`, so the public surface here is a hand-typed subset
 * matching the route shapes in `apps/api/src/routes/*`. Once `AppType` is
 * exported upstream, this client can be swapped for `hc<AppType>` without
 * breaking the public API.
 */

import type { ChainId } from "@bufi/shared-types";
import type {
  PerpsIntentRequest,
  PerpsIntentResponse,
  PerpsQuoteRequest,
  PerpsQuoteResponse,
  PerpsReplacementPrepareRequest,
  PerpsReplacementPrepareResponse,
  PerpsReplacementSubmitRequest,
} from "@bufi/perps/schemas";

import { BufiApiError } from "./errors";

/**
 * Default base URL for the BUFI production API.
 */
export const BUFI_DEFAULT_API_URL = "https://api.bu.finance";

/**
 * Options accepted by {@link createBufiClient}.
 */
export interface BufiClientConfig {
  /**
   * HTTP(S) origin of the BUFI API. Defaults to {@link BUFI_DEFAULT_API_URL}.
   * Set to a localhost url (e.g. `http://localhost:3002`) for dev.
   */
  apiUrl?: string;
  /**
   * Default `chainId` to pass to every API call. Can be overridden
   * per-call. If unset, callers must pass `chainId` explicitly on each
   * query / mutation.
   */
  chainId?: ChainId;
  /**
   * Optional `fetch` implementation. Use this to inject an auth-bearing
   * fetcher in node, or to add OpenTelemetry instrumentation.
   *
   * Default: the global `fetch`.
   */
  fetch?: typeof fetch;
  /**
   * Per-request timeout in ms. The SDK wraps every call in an
   * `AbortController` that fires after this many ms.
   *
   * Default: `30_000` (30s) — matches the API's worst-case
   * `/fx-telarana/markets` budget.
   */
  timeoutMs?: number;
  /**
   * Headers added to every request — useful for an `X-API-Key` or
   * `Authorization: Bearer …` if BUFI ever gates a route.
   */
  headers?: Record<string, string>;
}

/**
 * Resolved configuration after {@link createBufiClient} applies defaults.
 */
export interface BufiClient {
  /** The resolved base URL (without trailing slash). */
  readonly apiUrl: string;
  /** Default chain id (if configured). */
  readonly chainId: ChainId | undefined;
  /**
   * Low-level typed fetcher. Most integrators should use the higher-level
   * `perps.*` and `queries.*` modules instead.
   */
  readonly request: BufiRequest;
}

/**
 * Generic typed fetcher used by every higher-level SDK function. Throws
 * {@link BufiApiError} on non-2xx.
 */
export type BufiRequest = <T = unknown>(opts: BufiRequestOptions) => Promise<T>;

/** Options accepted by {@link BufiRequest}. */
export interface BufiRequestOptions {
  /** URL path (e.g. `/perps/markets`). MUST start with `/`. */
  path: string;
  /** Defaults to `GET`. */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Query-string params; serialized with `URLSearchParams`. */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON body — will be `JSON.stringify`-ed. */
  body?: unknown;
  /** Headers merged on top of the client defaults. */
  headers?: Record<string, string>;
  /** AbortSignal for caller-driven cancellation. */
  signal?: AbortSignal;
}

/**
 * Build a {@link BufiClient}. The returned object is immutable — call it
 * once at app boot and reuse it.
 *
 * @example
 * ```ts
 * import { createBufiClient } from "@bufi/sdk";
 *
 * const bufi = createBufiClient({
 *   apiUrl: "https://api.bu.finance",
 *   chainId: 5042002,
 * });
 * ```
 */
export function createBufiClient(config: BufiClientConfig = {}): BufiClient {
  const apiUrl = (config.apiUrl ?? BUFI_DEFAULT_API_URL).replace(/\/+$/, "");
  const chainId = config.chainId;
  const fetcher = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 30_000;
  const baseHeaders = config.headers ?? {};

  if (!fetcher) {
    throw new Error(
      "@bufi/sdk: no `fetch` available. Pass `config.fetch` or run in an environment with global fetch (node 18+, modern browsers).",
    );
  }

  const request: BufiRequest = async <T,>(opts: BufiRequestOptions): Promise<T> => {
    const url = buildUrl(apiUrl, opts.path, opts.query);
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...baseHeaders,
      ...(opts.headers ?? {}),
    };
    let body: BodyInit | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] ??= "application/json";
      body = JSON.stringify(opts.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const compositeSignal = opts.signal
      ? combineSignals(opts.signal, controller.signal)
      : controller.signal;

    let res: Response;
    try {
      res = await fetcher(url, {
        method: opts.method ?? "GET",
        headers,
        body,
        signal: compositeSignal,
      });
    } finally {
      clearTimeout(timer);
    }

    const endpoint = `${opts.method ?? "GET"} ${opts.path}`;
    const requestId = res.headers.get("x-request-id") ?? undefined;
    if (!res.ok) {
      const parsed = await parseBodySafe(res);
      throw new BufiApiError({
        message: `BUFI API ${res.status} ${res.statusText} on ${endpoint}`,
        status: res.status,
        endpoint,
        body: parsed,
        requestId,
      });
    }
    // 204 / empty body short-circuit.
    if (res.status === 204) return undefined as T;
    const parsed = (await parseBodySafe(res)) as T;
    return parsed;
  };

  return Object.freeze({
    apiUrl,
    chainId,
    request,
  });
}

function buildUrl(
  base: string,
  path: string,
  query: BufiRequestOptions["query"],
): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, `${base}/`);
  // Re-set origin in case `path` itself was absolute.
  url.protocol = new URL(base).protocol;
  url.host = new URL(base).host;
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function parseBodySafe(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  try {
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Cross-runtime `AbortSignal` combinator — `AbortSignal.any` is only on
 * node 20+, browsers since 2024.
 */
function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") {
    return anyFn([a, b]);
  }
  const controller = new AbortController();
  const onAbort = (sig: AbortSignal) => () => controller.abort(sig.reason);
  if (a.aborted) controller.abort(a.reason);
  else a.addEventListener("abort", onAbort(a), { once: true });
  if (b.aborted) controller.abort(b.reason);
  else b.addEventListener("abort", onAbort(b), { once: true });
  return controller.signal;
}

// --------- typed convenience wrappers around the REST surface ----------

/**
 * Typed surface over the `/perps/*` REST routes. Exposed via
 * {@link createBufiClient}.perps after consumers import from `./perps/*`.
 */
export interface PerpsRestApi {
  quote(req: PerpsQuoteRequest, opts?: { signal?: AbortSignal }): Promise<PerpsQuoteResponse>;
  submitIntent(req: PerpsIntentRequest, opts?: { signal?: AbortSignal }): Promise<PerpsIntentResponse>;
  getIntent(intentId: string, opts?: { signal?: AbortSignal }): Promise<{ intent: unknown }>;
  prepareReplacement(
    intentId: string,
    req: PerpsReplacementPrepareRequest,
    opts?: { signal?: AbortSignal },
  ): Promise<PerpsReplacementPrepareResponse>;
  submitReplacement(
    intentId: string,
    req: PerpsReplacementSubmitRequest,
    opts?: { signal?: AbortSignal },
  ): Promise<PerpsIntentResponse>;
}

/**
 * Build the `perps.*` REST surface bound to a {@link BufiClient}.
 *
 * Most integrators should import the higher-level flows from
 * `@bufi/sdk/perps` (e.g. `openPerp`, `closePerp`) instead — those compose
 * `perpsRest` with `walletClient` signing.
 */
export function perpsRest(client: BufiClient): PerpsRestApi {
  const { request } = client;
  return {
    quote: (req, opts) =>
      request<PerpsQuoteResponse>({
        path: "/perps/quote",
        method: "POST",
        body: req,
        signal: opts?.signal,
      }),
    submitIntent: (req, opts) =>
      request<PerpsIntentResponse>({
        path: "/perps/intents",
        method: "POST",
        body: req,
        signal: opts?.signal,
      }),
    getIntent: (intentId, opts) =>
      request<{ intent: unknown }>({
        path: `/perps/intents/${encodeURIComponent(intentId)}`,
        signal: opts?.signal,
      }),
    prepareReplacement: (intentId, req, opts) =>
      request<PerpsReplacementPrepareResponse>({
        path: `/perps/intents/${encodeURIComponent(intentId)}/replacement/prepare`,
        method: "POST",
        body: req,
        signal: opts?.signal,
      }),
    submitReplacement: (intentId, req, opts) =>
      request<PerpsIntentResponse>({
        path: `/perps/intents/${encodeURIComponent(intentId)}/replacement`,
        method: "POST",
        body: req,
        signal: opts?.signal,
      }),
  };
}
