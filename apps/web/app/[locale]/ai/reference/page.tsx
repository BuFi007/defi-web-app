import type { Metadata } from "next";
import Script from "next/script";

/**
 * Human-readable API reference for the BUFI HYPER MCP, rendered from the LIVE
 * OpenAPI spec (https://mcp.bu.finance/openapi.json) — no separate swagger file
 * to maintain, the MCP's /openapi.json stays the single source of truth.
 *
 * Renderer: Scalar API Reference (standalone CDN). It loads ONLY on this route,
 * so the main /ai bundle stays light. Search + dark mode + try-it console.
 * Recommended over classic Swagger UI: lighter to embed, far more readable.
 */
export const metadata: Metadata = {
  title: "BU.FI Agent · API Reference",
  description: "Human-readable reference for the BUFI HYPER MCP, generated from the live OpenAPI spec.",
};

// Same-origin proxy (avoids CORS — the MCP serves the spec without ACAO and on
// a different origin). The proxy revalidates from mcp.bu.finance hourly.
const OPENAPI_URL = "/api/ai/openapi";

export default function ApiReferencePage() {
  // Scalar reads this element's data-url + data-configuration, then mounts in place.
  const config = JSON.stringify({
    theme: "purple",
    layout: "modern",
    hideDownloadButton: false,
    metaData: { title: "BU.FI Agent · API Reference" },
  });
  // Full-bleed fixed surface so Scalar's reference layout isn't cramped inside
  // the app's [locale] shell (header + radio chrome).
  return (
    <main style={{ position: "fixed", inset: 0, zIndex: 2147483000, background: "#fff", overflow: "auto" }}>
      <a
        href="/ai"
        style={{ position: "fixed", bottom: 16, left: 16, zIndex: 2147483001, fontSize: 12, fontWeight: 700, color: "#6b5bff", background: "#fff", border: "1px solid #e8dcff", borderRadius: 999, padding: "6px 13px", textDecoration: "none", boxShadow: "0 4px 14px rgba(80,40,140,.18)" }}
      >
        ← Agent docs
      </a>
      <script
        id="api-reference"
        data-url={OPENAPI_URL}
        data-configuration={config}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: "" }}
      />
      <Script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference" strategy="afterInteractive" />
    </main>
  );
}
