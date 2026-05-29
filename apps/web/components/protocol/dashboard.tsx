"use client";
// /protocol — the BU.FI Console. Read-only live view of every protocol family,
// styled as a Teenage-Engineering instrument (see components/console/kit.tsx): one
// opaque warm-paper plane, an accent-color legend rail, indexed modules in an
// asymmetric 12-col masonry, mono spec-sheet numerics. Purely presentational — all
// react-query hooks + signatures are unchanged. Replaces the old glass-island look.
import React from "react";
import { useAccount } from "wagmi";
import { cn } from "@/utils";
import {
  useLpInfo, useVaultDepths, useOraclePrice, useGatewayInfo,
  useHedgePools, useHedgeStatus, useFxswapPools, useRegistryAssets, usePerpsAccount,
} from "@/lib/protocol/hooks";
import {
  ACCENTS, Plane, Legend, Module, SpecRow, Marquee, Chip, Good, Warn, Val, StatusDot,
  INK, MUTE, HAIR, type Accent,
} from "@/components/console/kit";

const LEADER = "border-[#16151A]/20 dark:border-[#EDEAF6]/15";

const fmt = (v?: string | number | null, dp = 0) => {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: dp }) : String(v);
};

function FeeBar({ p, l, ins }: { p: number; l: number; ins: number }) {
  const total = p + l + ins || 1;
  const segs = [
    { label: "PROTOCOL", bps: p, acc: ACCENTS.lp },
    { label: "LP", bps: l, acc: ACCENTS.oracle },
    { label: "INSURANCE", bps: ins, acc: ACCENTS.perps },
  ];
  return (
    <div className="space-y-1.5">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[#16151A]/[0.06] dark:bg-[#EDEAF6]/[0.06]">
        {segs.map((s) => <span key={s.label} className={cn("h-full", s.acc.bg)} style={{ width: `${(s.bps / total) * 100}%` }} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {segs.map((s) => (
          <span key={s.label} className="flex items-center gap-1">
            <span className={cn("h-2 w-2 rounded-[2px]", s.acc.bg)} />
            <span className={cn("text-[9px] uppercase tracking-wide", MUTE)}>{s.label}</span>
            <span className={cn("font-mono text-[10px] tabular-nums", INK)}>{s.bps / 100}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function LpModule() {
  const info = useLpInfo();
  const depths = useVaultDepths();
  const fs = info.data?.feeSplit;
  const jb = depths.data?.juniorTokenBalances;
  const apy = info.isLoading ? "…" : info.data?.compositeApyPercent ? Number(info.data.compositeApyPercent).toFixed(2) : "—";
  return (
    <Module n={1} label="LP Vault" accent={ACCENTS.lp} className="md:col-span-7">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <div className={cn("mb-1 text-[10px] uppercase tracking-[0.08em]", MUTE)}>Composite APY</div>
          <Marquee value={apy} unit="%" accent={ACCENTS.lp} />
        </div>
        <div className="min-w-[150px] flex-1">
          <SpecRow label="Deposits" value={info.isLoading ? "…" : fmt(info.data?.totalDeposits)} unit="USDC" />
          <SpecRow label="Junior buffer" value={depths.isLoading ? "…" : fmt(depths.data?.totalJuniorUsdc)} unit="USDC" />
        </div>
      </div>
      {fs && <div className="mt-3.5"><FeeBar p={fs.protocolBps} l={fs.lpBps} ins={fs.insuranceBps} /></div>}
      {jb && Object.keys(jb).length > 0 && (
        <div className={cn("mt-3 flex flex-wrap gap-1.5 border-t pt-3", HAIR)}>
          {Object.entries(jb).map(([sym, bal]) => (
            <Chip key={sym}><span className="opacity-60">{sym}</span> {fmt(bal)}</Chip>
          ))}
        </div>
      )}
    </Module>
  );
}

function OracleRow({ base, quote }: { base: string; quote: string }) {
  const { data, isLoading } = useOraclePrice(base, quote);
  const mid = data?.mid ? Number(data.mid).toFixed(5) : isLoading ? "…" : "n/a";
  const fresh = !isLoading && !data?.stale && !!data?.mid;
  return (
    <div className="flex items-baseline gap-2 py-[5px]">
      <span className={cn("flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-[0.08em]", MUTE)}>
        {fresh && <span className="h-1.5 w-1.5 rounded-full bg-[#1FA8C4] dark:bg-[#4FD0E6]" />}
        {base}/{quote}
      </span>
      <span className={cn("flex-1 self-center border-b border-dotted", LEADER)} />
      {data?.stale
        ? <Warn>stale {data.mid ? Number(data.mid).toFixed(5) : ""}</Warn>
        : <span className={cn("text-right font-mono text-[13px] font-medium tabular-nums", INK)}><Val>{mid}</Val></span>}
    </div>
  );
}

function OracleModule() {
  const pairs: Array<[string, string]> = [["EURC", "USDC"], ["MXNB", "USDC"], ["AUDF", "USDC"]];
  return (
    <Module n={2} label="FX Oracle" accent={ACCENTS.oracle} className="md:col-span-5">
      <div>{pairs.map(([b, q]) => <OracleRow key={b} base={b} quote={q} />)}</div>
      <div className={cn("mt-2 text-[10px]", MUTE)}>Pyth → RedStone → Chainlink</div>
    </Module>
  );
}

function StateRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-[5px]">
      <span className={cn("shrink-0 text-[10px] uppercase tracking-[0.08em]", MUTE)}>{label}</span>
      <span className={cn("flex-1 self-center border-b border-dotted", LEADER)} />
      <span className="text-right">{children}</span>
    </div>
  );
}

function HedgeModule() {
  const pools = useHedgePools();
  const first = pools.data?.pools?.[0];
  const status = useHedgeStatus(first?.poolId);
  return (
    <Module n={3} label="Hedge" accent={ACCENTS.hedge} className="md:col-span-4">
      {!first ? (
        <span className={cn("text-[11px]", MUTE)}>{pools.isLoading ? "…" : "no hedge pools"}</span>
      ) : (
        <>
          <SpecRow label="Pool" value={first.pair} />
          <SpecRow label="Fee" value={first.fee / 100} unit="bps" />
          <StateRow label="State">
            {status.isLoading ? <span className={cn("font-mono text-[12px]", MUTE)}>…</span>
              : status.data?.isDeltaNeutral ? <Good>neutral ✓</Good>
              : <Warn>Δ {status.data?.currentDelta ?? "?"}</Warn>}
          </StateRow>
        </>
      )}
    </Module>
  );
}

function FxSwapModule() {
  const { data, isLoading } = useFxswapPools();
  const pools = data?.pools ?? [];
  return (
    <Module n={4} label="FX Swap" accent={ACCENTS.fxswap} className="md:col-span-4">
      {isLoading ? <span className={cn("text-[11px]", MUTE)}>…</span>
        : pools.length === 0 ? <span className={cn("text-[11px]", MUTE)}>no pools</span>
        : pools.map((p) => <SpecRow key={p.asset} label={p.pair} value={p.fee / 100} unit="bps" />)}
    </Module>
  );
}

function RegistryModule() {
  const { data, isLoading } = useRegistryAssets();
  const assets = data?.assets ?? [];
  return (
    <Module
      n={5} label="Registry" accent={ACCENTS.registry} className="md:col-span-4"
      headerRight={<span className={cn("font-mono text-[11px] tabular-nums", MUTE)}>{isLoading ? "…" : data?.count ?? 0}</span>}
    >
      {isLoading ? <span className={cn("text-[11px]", MUTE)}>…</span> : (
        <div className="flex flex-wrap gap-1.5">
          {assets.map((a) => <Chip key={a.symbol} violet>{a.symbol}</Chip>)}
        </div>
      )}
    </Module>
  );
}

function PerpsModule() {
  const { address } = useAccount();
  const { data, isLoading } = usePerpsAccount(address);
  return (
    <Module n={6} label="Perps Margin" accent={ACCENTS.perps} className="md:col-span-5">
      {!address ? (
        <div className="rounded-lg border border-dashed border-[#C98A00]/50 px-3 py-4 text-center dark:border-[#E3B43A]/50">
          <span className={cn("text-[11px]", MUTE)}>Connect a wallet to view margin.</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-8">
          <div className="min-w-[110px] flex-1">
            <SpecRow label="Total" value={isLoading ? "…" : fmt(data?.totalMargin, 2)} unit="USDC" />
            <SpecRow label="Reserved" value={isLoading ? "…" : fmt(data?.reservedMargin, 2)} />
          </div>
          <div className="min-w-[110px] flex-1">
            <SpecRow label="Free" value={isLoading ? "…" : fmt(data?.freeMargin, 2)} unit="USDC" />
          </div>
        </div>
      )}
    </Module>
  );
}

function GatewayModule() {
  const { data, isLoading } = useGatewayInfo();
  return (
    <Module n={7} label="Cross-Hub Gateway" accent={ACCENTS.gateway} className="md:col-span-7">
      <div className="flex flex-wrap gap-x-8">
        <div className="min-w-[120px] flex-1">
          <SpecRow label="Locked" value={isLoading ? "…" : fmt(data?.gatewayBalance, 2)} unit="USDC" />
        </div>
        <div className="min-w-[120px] flex-1">
          <SpecRow label="Unlock" value={isLoading ? "…" : data?.withdrawalUnlockBlock ?? "—"} unit="block" />
        </div>
      </div>
    </Module>
  );
}

const LEGEND: { n: number; label: string; accent: Accent }[] = [
  { n: 1, label: "LP", accent: ACCENTS.lp },
  { n: 2, label: "Oracle", accent: ACCENTS.oracle },
  { n: 3, label: "Hedge", accent: ACCENTS.hedge },
  { n: 4, label: "Swap", accent: ACCENTS.fxswap },
  { n: 5, label: "Registry", accent: ACCENTS.registry },
  { n: 6, label: "Perps", accent: ACCENTS.perps },
  { n: 7, label: "Gateway", accent: ACCENTS.gateway },
];

export function ProtocolDashboard() {
  return (
    <main className="mx-auto w-full max-w-4xl self-start p-3 sm:p-4">
      <Plane>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className={cn("font-knick text-[28px] font-bold leading-none tracking-tight", INK)}>console</h1>
            <p className={cn("mt-1.5 text-[11px]", MUTE)}>bu.finance protocol · live read-only</p>
          </div>
          <span className="flex items-center gap-1.5">
            <StatusDot />
            <span className={cn("font-mono text-[10px] uppercase tracking-[0.12em]", MUTE)}>live · 30s</span>
          </span>
        </div>

        <div className={cn("my-3.5 border-t", HAIR)} />
        <Legend items={LEGEND} />

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:gap-3 md:grid-cols-12 md:items-start">
          <LpModule />
          <OracleModule />
          <HedgeModule />
          <FxSwapModule />
          <RegistryModule />
          <PerpsModule />
          <GatewayModule />
        </div>
      </Plane>
    </main>
  );
}
