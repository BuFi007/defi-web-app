"use client";
// Super-minimal, casual agent docs: what the MCP can do + how to point an agent
// at it. Additive route (/ai); same solid-island styling as /protocol.
import React from "react";

const MCP_URL = "https://mcp.bu.finance/mcp";
const CONNECT = `claude mcp add --transport http bufi-hyper ${MCP_URL}`;

const TOOLS: Array<{ group: string; items: string }> = [
  { group: "Trade", items: "forex perps (open/close, up to 50x), spot FX buys" },
  { group: "Earn / borrow", items: "supply USDC, borrow FX, repay, withdraw (Morpho)" },
  { group: "LP", items: "deposit into the composite-APY vault (lending + fees + hedge)" },
  { group: "Hedge", items: "delta-neutral status per pool (FxHedgeHook)" },
  { group: "Private", items: "ghost deposit → proof → relayer withdrawal (shielded)" },
  { group: "Read", items: "oracle mids, FX-swap quotes, registry, gateway, positions" },
];

function CopyRow({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
      className="group flex w-full items-center justify-between gap-3 rounded-lg border border-purpleDanis/15 bg-purpleDanis/[0.04] px-3 py-2 text-left transition-colors hover:bg-purpleDanis/[0.08] dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
    >
      <code className="truncate font-mono text-[11px] text-neutral-700 dark:text-white/70">{text}</code>
      <span className="shrink-0 text-[10px] font-medium text-purpleDanis dark:text-violetDanis">{copied ? "copied ✓" : "copy"}</span>
    </button>
  );
}

export function AiDocs() {
  return (
    <main className="mx-auto w-full max-w-2xl p-3 sm:p-4">
      <div className="rounded-2xl border border-purpleDanis/15 bg-white/85 p-5 shadow-[0_14px_36px_-18px_rgba(105,84,207,0.4)] backdrop-blur-xl dark:border-white/10 dark:bg-neutral-950/80">
        <h1 className="text-base font-semibold tracking-tight text-purpleDanis dark:text-white">Connect an AI agent</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-neutral-600 dark:text-white/55">
          BU.FI speaks MCP. Point your agent at one URL and it can trade FX perps + spot, lend/borrow,
          run private (ghost) swaps, LP into the vault, and read oracle/hedge state — no SDK, no keys held by us
          (writes come back as unsigned calls you sign).
        </p>

        <h2 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-white/40">Connect</h2>
        <div className="mt-2 flex flex-col gap-2">
          <CopyRow text={CONNECT} />
          <p className="text-[11px] text-neutral-500 dark:text-white/45">
            Claude Code ↑. Claude Desktop / Cursor: add to <code className="font-mono">.mcp.json</code> →{" "}
            <code className="font-mono text-[10px]">{`{ "mcpServers": { "bufi-hyper": { "type": "url", "url": "${MCP_URL}" } } }`}</code>
          </p>
        </div>

        <h2 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-white/40">What it can do</h2>
        <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {TOOLS.map((t) => (
            <div key={t.group} className="rounded-lg border border-purpleDanis/10 bg-white/50 px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]">
              <div className="text-[12px] font-medium text-purpleDanis dark:text-white">{t.group}</div>
              <div className="text-[11px] leading-snug text-neutral-500 dark:text-white/45">{t.items}</div>
            </div>
          ))}
        </div>

        <p className="mt-5 text-[11px] text-neutral-500 dark:text-white/45">
          Full machine docs: <a className="text-purpleDanis underline dark:text-violetDanis" href="https://mcp.bu.finance/llms.txt" target="_blank" rel="noopener noreferrer">llms.txt</a>
          {" · "}<a className="text-purpleDanis underline dark:text-violetDanis" href="https://mcp.bu.finance/openapi.json" target="_blank" rel="noopener noreferrer">openapi.json</a>
          {" · "}<a className="text-purpleDanis underline dark:text-violetDanis" href="/protocol">live protocol view →</a>
        </p>
      </div>
    </main>
  );
}
