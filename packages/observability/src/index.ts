export { initOtel, type InitOtelOptions } from "./init-otel";
export {
  getTracer,
  keeperAttributes,
  withSpan,
  withSpanSync,
} from "./trace";
// Re-export the API types so call sites don't have to add
// `@opentelemetry/api` to every package.json that only needs `withSpan`.
export {
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
