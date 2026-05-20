/**
 * Tracing helpers. Imports from `@opentelemetry/api` only — the global tracer
 * is a NoOp until `initOtel(...)` registers a provider, so calling these from
 * a service without `AXIOM_TOKEN` is free.
 */
import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type Tracer,
} from "@opentelemetry/api";

/**
 * Cache tracers by name so we don't repeatedly hit the global registry.
 * The OTel API itself does this internally too, but we keep the surface
 * explicit so the helpers are obvious in call sites.
 */
const tracerCache = new Map<string, Tracer>();

export function getTracer(name: string): Tracer {
  const cached = tracerCache.get(name);
  if (cached) return cached;
  const next = trace.getTracer(name);
  tracerCache.set(name, next);
  return next;
}

/**
 * Wrap an async function in a span. On throw, records the exception, sets
 * the span status to ERROR, and re-throws — the caller's control flow is
 * unchanged.
 *
 * The optional `attributes` are attached on span creation; pass dynamic
 * attrs by using the (span) callback form.
 *
 * @example
 *   await withSpan("perps.matcher.match-loop", async (span) => {
 *     const matches = await matchPriceTimePriority(intents);
 *     span.setAttribute("matcher.matches_found", matches.length);
 *     return matches;
 *   }, { "matcher.intents_pending": intents.length });
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  attributes?: Attributes,
  tracerName = "bufi",
): Promise<T> {
  const tracer = getTracer(tracerName);
  const span = tracer.startSpan(name, { attributes });
  try {
    const result = await fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.recordException(err as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: (err as Error).message,
    });
    throw err;
  } finally {
    span.end();
  }
}

/**
 * Synchronous companion to `withSpan`. Same semantics, no `await`.
 */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  attributes?: Attributes,
  tracerName = "bufi",
): T {
  const tracer = getTracer(tracerName);
  const span = tracer.startSpan(name, { attributes });
  try {
    const result = fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.recordException(err as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: (err as Error).message,
    });
    throw err;
  } finally {
    span.end();
  }
}

/**
 * Build the canonical attribute set for a keeper tick. Used by
 * @bufi/keeper-runtime; exposed here so individual keepers can extend the
 * set when calling `withSpan` for sub-operations.
 */
export function keeperAttributes(args: {
  name: string;
  chainId?: number;
  marketId?: string;
  tickIndex?: number;
}): Attributes {
  const attrs: Attributes = { "keeper.name": args.name };
  if (typeof args.chainId === "number") attrs["keeper.chainId"] = args.chainId;
  if (args.marketId) attrs["keeper.marketId"] = args.marketId;
  if (typeof args.tickIndex === "number") attrs["tick.index"] = args.tickIndex;
  return attrs;
}
