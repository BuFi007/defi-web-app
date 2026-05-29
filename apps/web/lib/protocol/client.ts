// Read client for the hyper-mcp protocol surface (oracle/vault/lp/hedge/fxswap/
// registry/perps/lending). These routes live on the MCP (mcp.bu.finance / local
// :4002), NOT the :3002 api — so this resolves its own base URL. Reads only here;
// writes use the MCP's PREPARE endpoints (returns unsigned calls the user signs).
const DEFAULT_MCP_URL = "https://mcp.bu.finance";

export function mcpUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const base = (process.env.NEXT_PUBLIC_MCP_URL ?? DEFAULT_MCP_URL).replace(/\/$/, "");
  const qs = query
    ? "?" +
      Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  return `${base}${path}${qs}`;
}

export async function mcpFetch<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const res = await fetch(mcpUrl(path, query), { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`MCP ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function mcpPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(mcpUrl(path), { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`MCP ${path} → ${res.status}`);
  return (await res.json()) as T;
}
