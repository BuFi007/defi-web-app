"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useSpring, useTransform } from "framer-motion";
import { cn } from "@/utils";
import { useTvl, type TvlChainBreakdown } from "@/hooks/use-tvl";

type View = "idle" | "expanded";

const SIZES = {
  idle: { width: 110, height: 34, radius: 999 },
  expanded: { width: 300, height: "auto" as const, radius: 20 },
} as const;

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function AnimatedDollar({ value }: { value: number }) {
  const spring = useSpring(0, { stiffness: 80, damping: 20 });
  const display = useTransform(spring, (v) => formatCompact(v));

  spring.set(value);

  return <motion.span>{display}</motion.span>;
}

export default function TvlPill() {
  const [view, setView] = useState<View>("idle");
  const tvl = useTvl();

  const maxAssetValue = useMemo(() => {
    let max = 0;
    for (const chain of tvl.breakdown) {
      for (const a of chain.assets) {
        if (a.usdValue > max) max = a.usdValue;
      }
    }
    return max || 1;
  }, [tvl.breakdown]);

  const currentSize = SIZES[view];

  return (
    <div
      className="relative"
      style={{ width: SIZES.idle.width, height: SIZES.idle.height }}
      onMouseEnter={() => setView("expanded")}
      onMouseLeave={() => setView("idle")}
    >
      <motion.div
        initial={false}
        animate={{
          width: currentSize.width,
          height: view === "expanded" ? "auto" : SIZES.idle.height,
          borderRadius: currentSize.radius,
        }}
        transition={{ type: "spring", bounce: 0.28, duration: 0.45 }}
        style={{ transformOrigin: "0% 100%" }}
        className={cn(
          "absolute left-0 bottom-0 overflow-hidden backdrop-blur-xl ring-1 z-50",
          "bg-white/95 ring-purpleDanis/15 shadow-[0_14px_36px_-12px_rgba(105,84,207,0.4)]",
          "dark:bg-black/95 dark:ring-white/10 dark:shadow-[0_18px_50px_-16px_rgba(105,84,207,0.65)]",
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {view === "idle" ? (
            <motion.div
              key="idle"
              initial={{ opacity: 0, scale: 0.92, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.92, filter: "blur(4px)" }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="h-[34px] w-full flex items-center justify-center gap-1.5 px-3"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-knick text-[11px] tracking-[0.04em] text-purpleDanis dark:text-white whitespace-nowrap">
                <AnimatedDollar value={tvl.totalTvl} /> TVL
              </span>
            </motion.div>
          ) : (
            <motion.div
              key="expanded"
              initial={{ opacity: 0, scale: 0.94, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.94, filter: "blur(4px)" }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1], delay: 0.06 }}
              className="w-full"
            >
              <ExpandedContent
                tvl={tvl}
                maxAssetValue={maxAssetValue}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function ExpandedContent({
  tvl,
  maxAssetValue,
}: {
  tvl: ReturnType<typeof useTvl>;
  maxAssetValue: number;
}) {
  return (
    <div className="px-4 py-3 space-y-3" style={{ width: SIZES.expanded.width }}>
      <div className="font-knick text-[11px] tracking-[0.12em] uppercase text-purpleDanis/60 dark:text-white/50">
        BUFX Protocol TVL
      </div>

      {tvl.breakdown.map((chain) => (
        <ChainSection key={chain.chainId} chain={chain} maxValue={maxAssetValue} />
      ))}

      {tvl.breakdown.length === 0 && (
        <div className="text-[11px] text-purpleDanis/40 dark:text-white/30 font-knick">
          No market data
        </div>
      )}

      <div className="border-t border-purpleDanis/10 dark:border-white/10 pt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        <MiniStat label="Morpho" value={tvl.morphoTvl} />
        <MiniStat label="Vault" value={tvl.vaultTvl} />
        <MiniStat label="Perps" value={tvl.perpsTvl} />
        <MiniStat label="Pools" value={tvl.poolsTvl} />
      </div>

      <div className="flex items-center justify-center gap-1.5 pt-1 pb-0.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="font-knick text-[13px] tracking-[0.04em] text-purpleDanis dark:text-white">
          <AnimatedDollar value={tvl.totalTvl} /> TVL
        </span>
      </div>
    </div>
  );
}

function ChainSection({
  chain,
  maxValue,
}: {
  chain: TvlChainBreakdown;
  maxValue: number;
}) {
  return (
    <div className="space-y-1">
      <div className="font-knick text-[10px] tracking-[0.08em] font-semibold text-purpleDanis dark:text-white/80">
        {chain.chainName}
      </div>
      {chain.assets.map((asset) => (
        <div key={asset.symbol} className="flex items-center gap-2">
          <span className="font-knick text-[10px] w-10 text-purpleDanis/70 dark:text-white/60 shrink-0">
            {asset.symbol}
          </span>
          <span className="font-knick text-[10px] w-14 text-right text-purpleDanis dark:text-white shrink-0">
            {formatCompact(asset.usdValue)}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-purpleDanis/10 dark:bg-white/10 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-purpleDanis dark:bg-violetDanis"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max((asset.usdValue / maxValue) * 100, 1)}%` }}
              transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-knick text-[9px] tracking-[0.06em] text-purpleDanis/50 dark:text-white/40">
        {label}
      </span>
      <span className="font-knick text-[10px] text-purpleDanis dark:text-white">
        {formatCompact(value)}
      </span>
    </div>
  );
}
