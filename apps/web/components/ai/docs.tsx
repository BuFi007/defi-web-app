"use client";
// /ai — "agent": casual docs for pointing an AI agent at the BU.FI MCP. Same
// BU.FI Console system as /protocol (components/console/kit.tsx): opaque warm-paper
// plane, indexed blocks, accent-as-index. The connect command AND the example
// prompt use the SAME CopyRow control. Calm, left-aligned, zen.
import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/utils";
import {
  ACCENTS, Plane, Module, CopyRow, EASE, INK, MUTE, HAIR,
} from "@/components/console/kit";

const MCP_URL = "https://mcp.bu.finance/mcp";
const CONNECT = `claude mcp add --transport http bufi-hyper ${MCP_URL}`;
const EXAMPLE =
  "Open a 5x long EURC/USDC perp on BU.FI with $200 margin, then hedge it delta-neutral. " +
  "Before you sign anything, show me the oracle mid, the fee in bps, and the liquidation price, " +
  "then hand the writes back to me as unsigned calls (don't hold my keys). If EUR yield beats " +
  "the perp funding, skip the perp and LP the $200 into the composite vault instead, routing that " +
  "deposit as a private ghost swap.";

const CAPS = [
  { code: "01", name: "Trade", desc: "FX perps (open / close, up to 50x) + spot FX buys", acc: ACCENTS.lp },
  { code: "02", name: "Earn / borrow", desc: "supply USDC, borrow FX, repay, withdraw (Morpho)", acc: ACCENTS.oracle },
  { code: "03", name: "LP", desc: "deposit into the composite-APY vault (lending + fees + hedge)", acc: ACCENTS.hedge },
  { code: "04", name: "Hedge", desc: "delta-neutral status per pool (FxHedgeHook)", acc: ACCENTS.fxswap },
  { code: "05", name: "Private", desc: "ghost deposit → proof → relayer withdrawal (shielded)", acc: ACCENTS.registry },
  { code: "06", name: "Read", desc: "oracle mids, FX-swap quotes, registry, gateway, positions", acc: ACCENTS.perps },
];

function Reveal({ n, children }: { n: number; children: React.ReactNode }) {
  const rm = useReducedMotion();
  return (
    <motion.div
      initial={rm ? false : { opacity: 0, scale: 0.98, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: 0.34 + n * 0.05, duration: 0.3, ease: EASE }}
      style={{ transformOrigin: "top left" }}
    >
      {children}
    </motion.div>
  );
}

function FootLink({ href, children, ext }: { href: string; children: React.ReactNode; ext?: boolean }) {
  return (
    <a
      href={href}
      {...(ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={cn("underline-offset-4 transition-colors hover:underline hover:text-purpleDanis dark:hover:text-white", MUTE)}
    >
      {children}
    </a>
  );
}

export function AiDocs() {
  return (
    <main className="mx-auto w-full max-w-xl self-start p-3 sm:p-4">
      <Plane>
        <header>
          <h1 className={cn("font-knick text-[28px] font-bold leading-none tracking-tight", INK)}>agent</h1>
          <p className={cn("mt-2 text-[14px] leading-relaxed", INK)}>
            BU.FI speaks MCP. Point your agent at one URL and it can trade FX perps + spot, lend / borrow,
            run private (ghost) swaps, LP into the vault, and read oracle / hedge state.
          </p>
          <p className={cn("mt-1 text-[12px] leading-relaxed", MUTE)}>
            No SDK, no keys held by us. Writes come back as unsigned calls you sign.
          </p>
        </header>

        <div className={cn("my-4 border-t", HAIR)} />

        <div className="space-y-3">
          <Reveal n={1}><CopyRow n={1} label="connect" accent={ACCENTS.lp} text={CONNECT} /></Reveal>
          <Reveal n={2}><CopyRow n={2} label="try this" accent={ACCENTS.oracle} text={EXAMPLE} /></Reveal>
          <Reveal n={3}>
            <Module n={3} label="What it can do" accent={ACCENTS.hedge}>
              <div>
                {CAPS.map((c) => (
                  <div key={c.code} className="flex items-baseline gap-2.5 py-1.5">
                    <span className={cn("font-mono text-[10px] tabular-nums", c.acc.text)}>{c.code}</span>
                    <span className={cn("w-[92px] shrink-0 text-[12px] font-medium", INK)}>{c.name}</span>
                    <span className={cn("flex-1 text-[12px] leading-snug", MUTE)}>{c.desc}</span>
                  </div>
                ))}
              </div>
            </Module>
          </Reveal>
        </div>

        <div className={cn("mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]", MUTE)}>
          <FootLink href="https://mcp.bu.finance/llms.txt" ext>llms.txt</FootLink>
          <span aria-hidden>·</span>
          <FootLink href="https://mcp.bu.finance/openapi.json" ext>openapi.json</FootLink>
          <span aria-hidden>·</span>
          <FootLink href="/protocol">live console →</FootLink>
        </div>
      </Plane>
    </main>
  );
}
