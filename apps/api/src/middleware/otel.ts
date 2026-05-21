/**
 * Hono span-per-request middleware.
 *
 * One span per inbound HTTP request, with the canonical semconv attrs that
 * Axiom's HTTP view keys off (`http.method`, `http.route`,
 * `http.status_code`). Errors thrown downstream are recorded on the span as
 * exceptions and re-thrown — the global onError handler still wins.
 *
 * Mounted in `server.ts` immediately after `requestContextMiddleware()`, so
 * the span covers every middleware (wallet session, structured logger) and
 * the route handler itself.
 */
import { getTracer, SpanStatusCode } from "@bufi/observability";
import type { MiddlewareHandler } from "hono";

export function otelMiddleware(tracerName = "bufi-api"): MiddlewareHandler {
  return async (c, next) => {
    const tracer = getTracer(tracerName);
    // Hono's `routePath` resolves to the matched pattern (e.g. `/perps/:id`),
    // which is what we want for cardinality. Fall back to the literal path
    // for unmatched / wildcard routes — `notFoundHandler` will still emit a
    // 404 against the literal URL.
    const route = c.req.routePath ?? c.req.path;
    const span = tracer.startSpan(`${c.req.method} ${route}`, {
      attributes: {
        "http.method": c.req.method,
        "http.url": c.req.url,
        "http.route": route,
      },
    });
    try {
      await next();
      const status = c.res.status;
      span.setAttribute("http.status_code", status);
      span.setStatus({
        code: status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
      });
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
  };
}
