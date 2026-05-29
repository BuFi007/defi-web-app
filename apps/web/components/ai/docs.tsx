"use client";
// /ai — "agent": casual docs for pointing an AI agent at the BU.FI MCP. Same
// BU.FI Console system as /protocol (components/console/kit.tsx): opaque warm-paper
// plane, indexed blocks, accent-as-index. The connect command AND the example
// prompt use the SAME CopyRow control. Calm, left-aligned, zen.
import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/utils";
import { useScopedI18n } from "@/locales/client";
import {
  ACCENTS, Plane, Module, CopyRow, EASE, INK, MUTE, HAIR,
} from "@/components/console/kit";

const MCP_URL = "https://mcp.bu.finance/mcp";
const CONNECT = `claude mcp add --transport http bufi-hyper ${MCP_URL}`;
const EXAMPLE =
  "Using the bufi-hyper MCP, open a 5x EURC/USDC long with $200 margin and hedge it " +
  "delta-neutral. Show me the mid, fee in bps, and liquidation price, then return the " +
  "unsigned calls for me to sign.";

const CAPS = [
  { code: "01", name: "Trade", desc: "FX perps (open / close, up to 50x) + spot FX buys", acc: ACCENTS.lp },
  { code: "02", name: "Earn / borrow", desc: "supply USDC, borrow FX, repay, withdraw (Morpho)", acc: ACCENTS.oracle },
  { code: "03", name: "LP", desc: "deposit into the composite-APY vault (lending + fees + hedge)", acc: ACCENTS.hedge },
  { code: "04", name: "Hedge", desc: "delta-neutral status per pool (FxHedgeHook)", acc: ACCENTS.fxswap },
  { code: "05", name: "Private", desc: "ghost deposit → proof → relayer withdrawal (shielded)", acc: ACCENTS.registry },
  { code: "06", name: "Read", desc: "oracle mids, FX-swap quotes, registry, gateway, positions", acc: ACCENTS.perps },
];

// Tiny infographic: why the "try this" trade is low-risk. A long leg + an auto
// short hedge cancel directional price risk → delta-neutral, you keep the yield.
function Leg({ arrow, accent, label }: { arrow: string; accent: typeof ACCENTS.lp; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1", HAIR)}>
      <span className={cn("text-[12px] font-bold leading-none", accent.text)}>{arrow}</span>
      <span className={cn("text-[11px] font-medium", INK)}>{label}</span>
    </span>
  );
}

function DeltaInfo() {
  const t = useScopedI18n("Agent");
  return (
    <div className={cn("rounded-xl border p-3", HAIR)}>
      <div className={cn("mb-2 text-[10px] font-semibold uppercase tracking-[0.16em]", ACCENTS.hedge.text)}>
        {t("whySafe")}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Leg arrow="↑" accent={ACCENTS.lp} label={t("legLong")} />
        <span className={cn("font-mono text-[12px]", MUTE)}>+</span>
        <Leg arrow="↓" accent={ACCENTS.hedge} label={t("legShort")} />
        <span className={cn("font-mono text-[12px]", MUTE)}>=</span>
        <span className="inline-flex items-center gap-1 rounded-md bg-[#A89CE8]/15 px-2 py-1 text-[11px] font-semibold text-[#8E7FD6] dark:text-[#B8ACF0]">
          Δ0 neutral
        </span>
      </div>
      <p className={cn("mt-2 text-[11px] leading-snug", MUTE)}>
        {t("deltaExplainer")}
      </p>
    </div>
  );
}

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
  const t = useScopedI18n("Agent");
  return (
    <main className="mx-auto w-full max-w-3xl self-start p-2 sm:p-2.5">
      <Plane>
        <header>
          <h1 className={cn("font-knick text-[20px] font-bold leading-none tracking-tight", INK)}>Agent</h1>
          <p className={cn("mt-1 text-[12px] leading-snug", MUTE)}>
            {t("valueProp")}
          </p>
        </header>

        <div className={cn("my-2 border-t", HAIR)} />

        {/* Two columns on md+ (shorter card → survives the Discord banner push); stacks on mobile. */}
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-3">
          <div className="space-y-2">
            <Reveal n={1}><CopyRow n={1} label={t("connect")} accent={ACCENTS.lp} text={CONNECT} /></Reveal>
            <Reveal n={2}><CopyRow n={2} label={t("tryThis")} accent={ACCENTS.oracle} text={EXAMPLE} /></Reveal>
          </div>
          <div className="space-y-2">
            <Reveal n={3}><DeltaInfo /></Reveal>
            <Reveal n={4}>
              <Module n={3} label={t("whatItCanDo")} accent={ACCENTS.hedge}>
                <div className="flex flex-wrap gap-1.5">
                  {CAPS.map((c) => (
                    <span key={c.code} className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1", HAIR)}>
                      <span className={cn("h-2 w-2 rounded-[2px]", c.acc.bg)} />
                      <span className={cn("text-[11px] font-medium", INK)}>{c.name}</span>
                    </span>
                  ))}
                </div>
              </Module>
            </Reveal>
          </div>
        </div>

        <div className={cn("mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]", MUTE)}>
          <FootLink href="https://mcp.bu.finance/llms.txt" ext>llms.txt</FootLink>
          <span aria-hidden>·</span>
          <FootLink href="https://mcp.bu.finance/openapi.json" ext>openapi.json</FootLink>
          <span aria-hidden>·</span>
          <FootLink href="/protocol">{t("liveConsole")}</FootLink>
        </div>
      </Plane>
    </main>
  );
}
