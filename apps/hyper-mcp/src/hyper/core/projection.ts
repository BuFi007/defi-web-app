/**
 * Multi-protocol projection infrastructure.
 *
 * One route definition projects to many transports:
 *   HTTP              — always on (the route is HTTP-first).
 *   typed RPC client  — always on (shape is inferred from the route graph).
 *   MCP tool          — opt-in via `meta.mcp`.
 *   server action     — opt-in via `meta.action` or `.actionable()`.
 *   websocket/SSE     — opt-in via the handler return type.
 *
 * The functions in this file walk a route graph and produce serializable
 * manifests. The `app.invoke()` path is shared across protocols so
 * business logic runs exactly once.
 */

import type { Route, RouteMeta } from "./types.ts"

/** Minimal serializable schema descriptor — the full converter lives in @hyper/openapi. */
export interface SchemaDescriptor {
  readonly kind: "unknown" | "object" | "string" | "number" | "boolean" | "array"
  readonly properties?: Record<string, SchemaDescriptor>
}

/** A raw route as projected into any manifest. */
export interface ProjectedRoute {
  readonly method: string
  readonly path: string
  readonly name?: string
  readonly tags: readonly string[]
  readonly deprecated?: boolean
  readonly version?: string
  readonly mcp?: RouteMeta["mcp"]
  readonly action?: boolean
  readonly internal?: boolean
  readonly params?: SchemaDescriptor
  readonly query?: SchemaDescriptor
  readonly body?: SchemaDescriptor
  /** Thrown HTTP status codes declared via `.throws(status, schema)`. */
  readonly throws?: readonly number[]
  /** Named error codes declared via `.errors({ code: schema })`. */
  readonly errors?: readonly string[]
}

function descriptorOf(x: unknown): SchemaDescriptor | undefined {
  if (!x) return undefined
  return { kind: "unknown" }
}

export function projectRoute(r: Route): ProjectedRoute {
  const meta = r.meta
  const params = descriptorOf(r.params)
  const query = descriptorOf(r.query)
  const body = descriptorOf(r.body)
  const deprecated = meta.deprecated ? true : undefined
  const throws = r.throws
    ? Object.keys(r.throws)
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
    : undefined
  const errors = r.errors ? Object.keys(r.errors) : undefined
  const base: ProjectedRoute = {
    method: r.method,
    path: r.path,
    tags: meta.tags ?? [],
    ...(meta.name !== undefined && { name: meta.name }),
    ...(meta.mcp !== undefined && { mcp: meta.mcp }),
    ...(meta.action !== undefined && { action: Boolean(meta.action) }),
    ...(meta.internal !== undefined && { internal: meta.internal }),
    ...(deprecated !== undefined && { deprecated }),
    ...(meta.version !== undefined && { version: meta.version }),
    ...(params && { params }),
    ...(query && { query }),
    ...(body && { body }),
    ...(throws && throws.length > 0 && { throws }),
    ...(errors && errors.length > 0 && { errors }),
  }
  return base
}

export function projectRoutes(routes: readonly Route[]): readonly ProjectedRoute[] {
  return routes.filter((r) => !r.meta.internal).map(projectRoute)
}

/** Minimal OpenAPI 3.1 manifest. @hyper/openapi adds schema conversion later. */
export interface OpenAPIManifest {
  readonly openapi: "3.1.0"
  readonly info: { title: string; version: string; description?: string }
  readonly paths: Record<string, Record<string, OpenAPIOperation>>
}

interface OpenAPIOperation {
  readonly operationId?: string
  readonly tags?: readonly string[]
  readonly deprecated?: boolean
  readonly parameters?: readonly OpenAPIParam[]
  readonly requestBody?: { readonly content: Record<string, unknown> }
  readonly responses: Record<string, { description: string }>
}

interface OpenAPIParam {
  readonly name: string
  readonly in: "path" | "query" | "header"
  readonly required: boolean
}

export interface OpenAPIManifestConfig {
  readonly title?: string
  readonly version?: string
  readonly description?: string
}

function openApiPath(path: string): string {
  // Convert Bun `:param` to OpenAPI `{param}`
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")
}

export function toOpenAPI(
  routes: readonly Route[],
  cfg: OpenAPIManifestConfig = {},
): OpenAPIManifest {
  const paths: Record<string, Record<string, OpenAPIOperation>> = {}
  for (const r of routes) {
    if (r.meta.internal) continue
    const p = openApiPath(r.path)
    const operation: OpenAPIOperation = {
      ...(r.meta.name !== undefined && { operationId: r.meta.name }),
      ...(r.meta.tags !== undefined && { tags: r.meta.tags }),
      ...(r.meta.deprecated && { deprecated: true }),
      ...(r.body !== undefined && {
        requestBody: {
          content: { "application/json": { schema: { $ref: "#/components/schemas/Body" } } },
        },
      }),
      responses: {
        "200": { description: "success" },
      },
    }
    if (!paths[p]) paths[p] = {}
    paths[p][r.method.toLowerCase()] = operation
  }
  return {
    openapi: "3.1.0",
    info: {
      title: cfg.title ?? "Hyper API",
      version: cfg.version ?? "0.0.0",
      ...(cfg.description !== undefined && { description: cfg.description }),
    },
    paths,
  }
}

/** MCP manifest (JSON-RPC shaped). @hyper/mcp produces the transport. */
export interface MCPManifest {
  readonly version: "1.0"
  readonly tools: readonly MCPTool[]
}

export interface MCPTool {
  readonly name: string
  readonly description: string
  readonly method: string
  readonly path: string
  readonly inputSchema: {
    readonly type: "object"
    readonly properties: Record<string, unknown>
  }
}

/**
 * Optional schema expander. When supplied (by the app layer, which knows
 * which validator is in use — e.g. `zodConverter.toJsonSchema`), the body's
 * concrete shape is emitted into the MCP `inputSchema` instead of an opaque
 * `{ type: "object" }`. Core stays validator-agnostic: it only calls the fn.
 * Anything the expander can't understand falls back to `{ type: "object" }`.
 */
export type SchemaExpander = (schema: unknown) => Record<string, unknown>

function expand(
  schema: unknown,
  convert: SchemaExpander | undefined,
): Record<string, unknown> {
  if (!convert) return { type: "object" }
  try {
    const out = convert(schema)
    // A converter that returns {} (unrecognized, e.g. refine/transform wrappers)
    // must not produce an empty, propertyless schema — keep the safe default.
    return out && typeof out === "object" && Object.keys(out).length > 0
      ? out
      : { type: "object" }
  } catch {
    return { type: "object" }
  }
}

const MCP_PATH_PARAM = /:([A-Za-z0-9_]+)/g

/** Human hint for well-known path params so a fresh client knows what to send. */
function pathParamDescription(name: string): string {
  const n = name.toLowerCase()
  if (n === "agentid")
    return 'The agent\'s on-chain identity id — this is the trader EVM address ("0x…"), NOT an ERC-721 tokenId.'
  if (n === "follower") return 'The follower wallet address ("0x…").'
  if (n === "address" || n.endsWith("address")) return 'An EVM wallet address ("0x…").'
  return `Path parameter "${name}".`
}

/**
 * Project a route's inline path params (`/positions/:address`) into the MCP
 * `inputSchema` under `params`. Routes declare path params in the path string
 * rather than via a `.params()` schema, so without this every path-parameterized
 * GET tool emits an empty inputSchema — a schema-driven client never learns to
 * send the address, and the `:address` placeholder leaks into the upstream path
 * (a silent false-empty result). The MCP server substitutes from `input.params`,
 * so the params nest under `params` here to match. Mirrors the OpenAPI generator,
 * which already emits these from the same `:param` regex.
 */
function paramsProperty(path: string): Record<string, unknown> | undefined {
  const names = [...path.matchAll(MCP_PATH_PARAM)].map((m) => m[1]!)
  if (names.length === 0) return undefined
  const properties: Record<string, unknown> = {}
  for (const name of names) {
    properties[name] = { type: "string", description: pathParamDescription(name) }
  }
  return { type: "object", properties, required: names }
}

export function toMCPManifest(
  routes: readonly Route[],
  convertBody?: SchemaExpander,
): MCPManifest {
  const tools: MCPTool[] = []
  for (const r of routes) {
    if (r.meta.internal) continue
    if (!r.meta.mcp) continue
    const cfg = r.meta.mcp as { description: string }
    const params = paramsProperty(r.path)
    tools.push({
      name: r.meta.name ?? `${r.method.toLowerCase()}_${r.path.replace(/[^a-z0-9]+/gi, "_")}`,
      description: cfg.description,
      method: r.method,
      path: r.path,
      inputSchema: {
        type: "object",
        properties: {
          ...(params && { params }),
          // Expand query params (same converter as body) so GET tools
          // self-describe their query fields (e.g. hedge/status.poolId) instead
          // of an opaque { type: "object" } a schema-driven client can't fill.
          ...(r.query ? { query: expand(r.query, convertBody) } : {}),
          ...(r.body ? { body: expand(r.body, convertBody) } : {}),
        },
      },
    })
  }
  return { version: "1.0", tools }
}

/** Typed-client manifest — the serializable contract @hyper/client consumes. */
export interface ClientManifest {
  readonly version: "1.0"
  readonly routes: readonly ProjectedRoute[]
}

export function toClientManifest(routes: readonly Route[]): ClientManifest {
  return { version: "1.0", routes: projectRoutes(routes) }
}
