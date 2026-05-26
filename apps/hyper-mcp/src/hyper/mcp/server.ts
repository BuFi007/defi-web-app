/**
 * Minimal MCP server — JSON-RPC 2.0 over HTTP POST / stdio pipes.
 *
 * We implement the subset needed for tools:
 *   - initialize
 *   - tools/list
 *   - tools/call
 *
 * Anything declared with `meta.mcp = { description }` becomes a tool.
 * Tool invocation funnels through the shared `app.invoke()` path so
 * middleware, logging, and validation run exactly once.
 */

import type { HttpMethod, HyperApp, MCPManifest } from "@hyper/core"

export interface McpServer {
  readonly handle: (req: Request) => Promise<Response>
  readonly manifest: MCPManifest
  readonly listTools: () => readonly { name: string; description: string }[]
  readonly callTool: (name: string, args: unknown) => Promise<unknown>
}

interface JsonRpcRequest {
  readonly jsonrpc: "2.0"
  readonly id?: number | string | null
  readonly method: string
  readonly params?: unknown
}

interface JsonRpcResponse {
  readonly jsonrpc: "2.0"
  readonly id: number | string | null
  readonly result?: unknown
  readonly error?: { code: number; message: string; data?: unknown }
}

export interface McpServerConfig {
  /** Override the manifest (usually omitted; taken from app). */
  readonly manifest?: MCPManifest
  /** Require auth check on every tool call. Defaults to always-allow. */
  readonly authorize?: (args: { toolName: string; req: Request }) => boolean | Promise<boolean>
  /** Server identity (surfaced on initialize). */
  readonly info?: { name: string; version: string }
}

export function mcpServer(app: HyperApp, cfg: McpServerConfig = {}): McpServer {
  const manifest = cfg.manifest ?? app.toMCPManifest()
  const byName = new Map(manifest.tools.map((t) => [t.name, t]))

  const callTool = async (name: string, args: unknown): Promise<unknown> => {
    const tool = byName.get(name)
    if (!tool) throw rpcError(-32601, `unknown tool: ${name}`)
    const input = (args ?? {}) as {
      params?: Record<string, string>
      query?: Record<string, unknown>
      body?: unknown
    }
    const result = await app.invoke({
      method: tool.method as HttpMethod,
      path: tool.path,
      ...(input.params && { params: input.params }),
      ...(input.query && { query: input.query }),
      ...(input.body !== undefined && { body: input.body }),
    })
    if (result.status >= 400) {
      throw rpcError(-32000, `tool failed with ${result.status}`, result.data)
    }
    return result.data
  }

  const handle = async (req: Request): Promise<Response> => {
    if (req.method === "GET") {
      const accept = req.headers.get("accept") ?? ""
      if (accept.includes("text/event-stream")) {
        const sessionId = crypto.randomUUID()
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`event: endpoint\ndata: /mcp?sessionId=${sessionId}\n\n`))
          },
        })
        return new Response(stream, {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "connection": "keep-alive",
            "mcp-session-id": sessionId,
          },
        })
      }
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32600, message: "expected POST or SSE GET" } },
        405,
      )
    }
    if (req.method === "DELETE") {
      return new Response(null, { status: 204 })
    }
    if (req.method !== "POST") {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32600, message: "expected POST" } },
        405,
      )
    }
    let msg: JsonRpcRequest
    try {
      msg = (await req.json()) as JsonRpcRequest
    } catch {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } },
        400,
      )
    }
    const sessionId = req.headers.get("mcp-session-id")
    try {
      switch (msg.method) {
        case "initialize":
          return rpcOkWithSession(msg.id ?? null, {
            protocolVersion: "2024-11-05",
            serverInfo: cfg.info ?? { name: "hyper-mcp", version: "0.0.0" },
            capabilities: { tools: {} },
          }, sessionId ?? crypto.randomUUID())
        case "notifications/initialized":
          return new Response(null, { status: 204 })
        case "tools/list":
          return rpcOk(msg.id ?? null, {
            tools: manifest.tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          })
        case "tools/call": {
          const params = (msg.params ?? {}) as { name: string; arguments?: unknown }
          if (cfg.authorize) {
            const ok = await cfg.authorize({ toolName: params.name, req })
            if (!ok) {
              return rpcErr(msg.id ?? null, -32001, `unauthorized: ${params.name}`)
            }
          }
          const output = await callTool(params.name, params.arguments)
          return rpcOk(msg.id ?? null, {
            content: [{ type: "text", text: JSON.stringify(output) }],
          })
        }
        default:
          return rpcErr(msg.id ?? null, -32601, `method not found: ${msg.method}`)
      }
    } catch (e) {
      const err = e as { code?: number; message?: string; data?: unknown }
      return rpcErr(msg.id ?? null, err.code ?? -32000, err.message ?? "server error", err.data)
    }
  }

  return {
    handle,
    manifest,
    listTools: () => manifest.tools.map((t) => ({ name: t.name, description: t.description })),
    callTool,
  }
}

function rpcError(
  code: number,
  message: string,
  data?: unknown,
): Error & {
  code: number
  data?: unknown
} {
  return Object.assign(new Error(message), { code, data })
}

function rpcOk(id: number | string | null, result: unknown): Response {
  const body: JsonRpcResponse = { jsonrpc: "2.0", id, result }
  return json(body, 200)
}

function rpcOkWithSession(id: number | string | null, result: unknown, sessionId: string): Response {
  const body: JsonRpcResponse = { jsonrpc: "2.0", id, result }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "mcp-session-id": sessionId,
    },
  })
}

function rpcErr(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): Response {
  const body: JsonRpcResponse = {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined && { data }) },
  }
  return json(body, 200)
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}
