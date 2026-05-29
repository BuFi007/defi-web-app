"use client";
// "BU.FI Console" — a Teenage-Engineering × zen design kit shared by /protocol and
// /ai so the two read as one instrument. Flat OPAQUE warm-paper plane (no
// glassmorphism), each section is an indexed module with one functional accent
// color (OP-1 mixer-channel style — "colors as a beautiful item"), spec-sheet rows
// with dotted leaders, mono numerics, and a boot-sequence reveal where the color
// lights up LAST. Honors the project bans: no glass-as-decoration, no gradient
// text, no side-stripe (>1px) borders, no nested drop-shadow cards, no identical
// card grid. CLOWN-PAINT BUDGET (hard rule): accent appears ONLY in the index
// chip, the 24px title-rule stub, data state-words, and the color-last reveal —
// titles and ALL numeric values stay ink.
import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/utils";
import { easeOut } from "@/utils/animations";

export const EASE = easeOut; // single-sourced ease-out-quint [0.23,1,0.32,1]

export type Accent = { name: string; text: string; bg: string };

// Seven single-sourced functional hues (light / dark-lifted-for-AA), one per
// protocol family. House purple #6954CF (= purpleDanis) anchors 01 + the wordmark.
export const ACCENTS: Record<string, Accent> = {
  lp: { name: "lp", text: "text-[#6954CF] dark:text-[#8C7BEA]", bg: "bg-[#6954CF] dark:bg-[#8C7BEA]" },
  oracle: { name: "oracle", text: "text-[#1FA8C4] dark:text-[#4FD0E6]", bg: "bg-[#1FA8C4] dark:bg-[#4FD0E6]" },
  hedge: { name: "hedge", text: "text-[#E86FC4] dark:text-[#FCA8E6]", bg: "bg-[#E86FC4] dark:bg-[#FCA8E6]" },
  fxswap: { name: "fxswap", text: "text-[#E2741F] dark:text-[#F2974A]", bg: "bg-[#E2741F] dark:bg-[#F2974A]" },
  registry: { name: "registry", text: "text-[#7B4FD6] dark:text-[#A98BF0]", bg: "bg-[#7B4FD6] dark:bg-[#A98BF0]" },
  perps: { name: "perps", text: "text-[#C98A00] dark:text-[#E3B43A]", bg: "bg-[#C98A00] dark:bg-[#E3B43A]" },
  gateway: { name: "gateway", text: "text-[#2E9E6B] dark:text-[#4FC189]", bg: "bg-[#2E9E6B] dark:bg-[#4FC189]" },
};
export const ACCENT_LIST = [ACCENTS.lp, ACCENTS.oracle, ACCENTS.hedge, ACCENTS.fxswap, ACCENTS.registry, ACCENTS.perps, ACCENTS.gateway];

// Surface + type tokens (class fragments). Paper is fully opaque so the WebGL
// gradient never bleeds through (that would re-create the banned glass).
export const PAPER = "bg-[#FBF8F2] dark:bg-[#1A1B22]";
export const INK = "text-[#16151A] dark:text-[#EDEAF6]";
export const MUTE = "text-[#16151A]/52 dark:text-[#EDEAF6]/50";
export const HAIR = "border-[#16151A]/12 dark:border-[#EDEAF6]/10";
const DOT = "border-[#16151A]/25 dark:border-[#EDEAF6]/20";

// The flat instrument surface. Opaque fill + 1px ring, no shadow, no blur.
export function Plane({ children, className }: { children: React.ReactNode; className?: string }) {
  const rm = useReducedMotion();
  return (
    <motion.div
      initial={rm ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: EASE }}
      className={cn("rounded-[22px] p-4 ring-1 sm:p-5", PAPER, "ring-[#16151A]/12 dark:ring-[#EDEAF6]/10", className)}
    >
      {children}
    </motion.div>
  );
}

// A color key that boots up: enters desaturated, color floods in last.
export function BootSquare({ accent, delay = 0, size = 10 }: { accent: Accent; delay?: number; size?: number }) {
  const rm = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      initial={rm ? false : { filter: "grayscale(1)", opacity: 0.35 }}
      animate={{ filter: "grayscale(0)", opacity: 1 }}
      transition={{ delay, duration: 0.4, ease: EASE }}
      style={{ width: size, height: size }}
      className={cn("inline-block shrink-0 rounded-[3px]", accent.bg)}
    />
  );
}

// Two-digit channel index, accent text on a faint ink chip.
function IndexChip({ n, accent }: { n: number; accent: Accent }) {
  return (
    <span className={cn("rounded-[5px] bg-[#16151A]/[0.05] px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums dark:bg-[#EDEAF6]/[0.06]", accent.text)}>
      {String(n).padStart(2, "0")}
    </span>
  );
}

// The 24px title-rule stub — the accent's home beside the index. Grows in LAST.
function Stub({ accent, delay }: { accent: Accent; delay: number }) {
  const rm = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      initial={rm ? false : { width: 0 }}
      animate={{ width: 24 }}
      transition={{ delay, duration: 0.3, ease: EASE }}
      style={{ height: 2 }}
      className={cn("mt-1 block rounded-full", accent.bg)}
    />
  );
}

// An indexed module: a hairline-bordered region of the plane (transparent fill, no
// second shadow → not a nested card). Seats onto the pegboard from its top-left.
export function Module({
  n, label, accent, base = 0.5, className, headerRight, children,
}: {
  n: number; label: string; accent: Accent; base?: number;
  className?: string; headerRight?: React.ReactNode; children: React.ReactNode;
}) {
  const rm = useReducedMotion();
  const delay = base + n * 0.032;
  return (
    <motion.section
      initial={rm ? false : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.28, ease: EASE }}
      style={{ transformOrigin: "top left" }}
      className={cn("rounded-xl border p-3.5", HAIR, className)}
    >
      <header className="flex items-center gap-2">
        <IndexChip n={n} accent={accent} />
        <h2 className={cn("font-knick text-[15px] font-bold tracking-tight", INK)}>{label}</h2>
        {headerRight && <span className="ml-auto flex items-center">{headerRight}</span>}
      </header>
      <Stub accent={accent} delay={delay + 0.14} />
      <div className="mt-2.5">{children}</div>
    </motion.section>
  );
}

// The signature: a color rail mapping every accent to its index. Boots color-last,
// left → right at 22ms — a perceptible wipe, the "learn the key" beat.
export function Legend({ items, base = 0.28 }: { items: { n: number; label: string; accent: Accent }[]; base?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
      {items.map((it, i) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <BootSquare accent={it.accent} delay={base + i * 0.022} />
          <span className={cn("font-mono text-[10px] tabular-nums", it.accent.text)}>{String(it.n).padStart(2, "0")}</span>
          <span className={cn("text-[10px] uppercase tracking-[0.1em]", MUTE)}>{it.label}</span>
        </span>
      ))}
    </div>
  );
}

// A value that fades (160ms) only when its rendered string actually changes — keyed
// remount, so an unchanged 30s refetch never blinks. tabular-nums prevents reflow.
export function Val({ children }: { children: React.ReactNode }) {
  const rm = useReducedMotion();
  if (rm) return <span>{children}</span>;
  return (
    <motion.span key={String(children)} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.16, ease: EASE }} className="inline-block">
      {children}
    </motion.span>
  );
}

// Spec-sheet row: sans eyebrow — dotted leader — mono ink value (right-aligned).
export function SpecRow({ label, value, unit }: { label: string; value: React.ReactNode; unit?: string }) {
  const v = typeof value === "string" || typeof value === "number" ? <Val>{value}</Val> : value;
  return (
    <div className="flex items-baseline gap-2 py-[5px]">
      <span className={cn("shrink-0 text-[10px] uppercase tracking-[0.08em]", MUTE)}>{label}</span>
      <span className={cn("flex-1 self-center border-b border-dotted", DOT)} />
      <span className={cn("text-right font-mono text-[13px] font-medium tabular-nums", INK)}>
        {v}
        {unit && <span className={cn("ml-1 text-[10px] font-normal", MUTE)}>{unit}</span>}
      </span>
    </div>
  );
}

// Marquee figure (composite APY) with a 2px accent underline tick — an allowed
// accent home. Value stays ink.
export function Marquee({ value, unit, accent }: { value: React.ReactNode; unit?: string; accent: Accent }) {
  return (
    <div className="flex items-end gap-1.5">
      <span className="relative inline-block">
        <span className={cn("font-mono text-[22px] font-medium leading-none tabular-nums", INK)}>
          {typeof value === "string" || typeof value === "number" ? <Val>{value}</Val> : value}
        </span>
        <span aria-hidden className={cn("absolute -bottom-1.5 left-0 h-[2px] w-full rounded-full", accent.bg)} />
      </span>
      {unit && <span className={cn("mb-0.5 font-mono text-[11px]", MUTE)}>{unit}</span>}
    </div>
  );
}

// Categorical mono chip. Ink by default; `violet` is the ONE place a tinted chip
// fill is allowed (the registry catalog), using brand violetDanis.
export function Chip({ children, violet }: { children: React.ReactNode; violet?: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
      violet ? "bg-[#CBB0FF]/25 text-[#7B4FD6] dark:bg-[#CBB0FF]/15 dark:text-[#A98BF0]" : cn("bg-[#16151A]/[0.05] dark:bg-[#EDEAF6]/[0.06]", MUTE),
    )}>
      {children}
    </span>
  );
}

// State words (kawaii inversion preserved). Profit = lavender text, never green.
export function Good({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[12px] font-medium text-[#A89CE8] dark:text-[#B8ACF0]">{children}</span>;
}
// Loss/stale/warn = soft-yellow. On paper: yellow text on an ink chip. On dark:
// plain yellow text (legible on the dark plane). Never red, never a yellow fill.
export function Warn({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-[#16151A] px-1.5 py-0.5 font-mono text-[11px] font-medium text-[#FFECB4] dark:bg-transparent dark:px-0 dark:py-0">{children}</span>;
}

// Cyan ambient status dot — the ONE moving thing besides load. Opacity pulse only.
export function StatusDot() {
  const rm = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      animate={rm ? undefined : { opacity: [1, 0.4, 1] }}
      transition={rm ? undefined : { duration: 2, repeat: Infinity, ease: "easeInOut" }}
      className="inline-block h-1.5 w-1.5 rounded-full bg-[#1FA8C4] dark:bg-[#4FD0E6]"
    />
  );
}

// Copy control as a labelled readout + pressable COPY key. One UI for the connect
// command and the example prompt. Label is a state-word (allowed accent use).
export function CopyRow({ label, accent, text, n }: { label: string; accent: Accent; text: string; n?: number }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className={cn("overflow-hidden rounded-xl border", HAIR)}>
      <div className={cn("flex items-center gap-2 border-b px-3 py-1.5", HAIR)}>
        {n != null && <span className={cn("font-mono text-[10px] tabular-nums", accent.text)}>{String(n).padStart(2, "0")}</span>}
        <span className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", accent.text)}>{label}</span>
      </div>
      <div className="flex items-stretch">
        <code className={cn("flex-1 px-3 py-2.5 font-mono text-[11px] leading-relaxed", INK)} style={{ overflowWrap: "anywhere" }}>
          {text}
        </code>
        <button
          type="button"
          onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
          className={cn(
            "shrink-0 self-stretch border-l px-3 text-[10px] font-semibold uppercase tracking-[0.14em] transition-transform active:scale-[0.97]",
            HAIR, copied ? accent.text : MUTE, "hover:bg-[#16151A]/[0.03] dark:hover:bg-[#EDEAF6]/[0.04]",
          )}
        >
          {copied ? "ok ✓" : "copy"}
        </button>
      </div>
    </div>
  );
}
