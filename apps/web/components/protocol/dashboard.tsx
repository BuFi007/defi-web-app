"use client";
// Additive protocol dashboard — surfaces the hyper-mcp protocol families for
// non-technical + agentic users. Sits inside a solid card "island" (like the main
// tab content) so text reads cleanly against a surface, not the gradient. Compact
// + read-only; does NOT touch TradeIsland/HomeContent. Loop appends a section here.
import React from "react";
import { useAccount } from "wagmi";
import {
  useLpInfo, useVaultDepths, useOraclePrice, useGatewayInfo,
  useHedgePools, useHedgeStatus, useFxswapPools, useRegistryAssets, usePerpsAccount,
} from "@/lib/protocol/hooks";

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-purpleDanis/10 bg-white/60 p-3.5 dark:border-white/5 dark:bg-white/[0.03]">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-[13px] font-semibold tracking-tight text-purpleDanis dark:text-white">{title}</h2>
        {subtitle && <p className="text-[11px] leading-snug text-neutral-500 dark:text-white/45">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-neutral-400 dark:text-white/35">{label}</span>
      <span className="text-sm font-medium tabular-nums text-neutral-900 dark:text-white">{value}</span>
      {hint && <span className="text-[10px] text-neutral-400 dark:text-white/30">{hint}</span>}
    </div>
  );
}

function LpInsuranceCard() {
  const info = useLpInfo();
  const depths = useVaultDepths();
  const fs = info.data?.feeSplit;
  return (
    <Card title="LP Vault — Composite APY" subtitle="Deposit USDC → blended lending + fee-share + hedge yield.">
      <div className="grid grid-cols-3 gap-2.5">
        <Stat label="APY" value={info.isLoading ? "…" : info.data?.compositeApyPercent ? `${Number(info.data.compositeApyPercent).toFixed(2)}%` : "—"} />
        <Stat label="Deposits" value={info.isLoading ? "…" : `${info.data?.totalDeposits ?? "0"}`} hint="USDC" />
        <Stat label="Junior" value={depths.isLoading ? "…" : `${Number(depths.data?.totalJuniorUsdc ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} hint="USDC" />
      </div>
      {fs && (
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Protocol {fs.protocolBps / 100}%</span>
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">LP {fs.lpBps / 100}%</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Insurance {fs.insuranceBps / 100}%</span>
        </div>
      )}
      {depths.data?.juniorTokenBalances && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-purpleDanis/5 pt-2 dark:border-white/5">
          {Object.entries(depths.data.juniorTokenBalances).map(([sym, bal]) => (
            <span key={sym} className="text-[10px] tabular-nums text-neutral-500 dark:text-white/40">
              {sym} <span className="text-neutral-800 dark:text-white/70">{Number(bal).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

const ORACLE_PAIRS: Array<[string, string]> = [["EURC", "USDC"], ["MXNB", "USDC"], ["AUDF", "USDC"]];
function OracleRow({ base, quote }: { base: string; quote: string }) {
  const { data, isLoading } = useOraclePrice(base, quote);
  return (
    <div className="flex items-center justify-between border-b border-purpleDanis/5 py-1 last:border-0 dark:border-white/5">
      <span className="text-xs text-neutral-600 dark:text-white/55">{base}/{quote}</span>
      <span className="flex items-center gap-1.5 tabular-nums">
        <span className="text-xs font-medium text-neutral-900 dark:text-white">{isLoading ? "…" : data?.mid ? Number(data.mid).toFixed(5) : "n/a"}</span>
        {data?.stale && <span className="rounded bg-red-100 px-1 text-[9px] text-red-700 dark:bg-red-500/15 dark:text-red-300">stale</span>}
      </span>
    </div>
  );
}
function OracleCard() {
  return (
    <Card title="FX Oracle V2" subtitle="Live mids (Pyth → RedStone → Chainlink).">
      <div className="flex flex-col">{ORACLE_PAIRS.map(([b, q2]) => <OracleRow key={b} base={b} quote={q2} />)}</div>
    </Card>
  );
}

function HedgeCard() {
  const pools = useHedgePools();
  const first = pools.data?.pools?.[0];
  const status = useHedgeStatus(first?.poolId);
  return (
    <Card title="Delta-Neutral Hedge" subtitle="FxHedgeHook keeps a pool neutral via an offsetting perp.">
      {!first ? (
        <span className="text-xs text-neutral-400">{pools.isLoading ? "…" : "no hedge pools"}</span>
      ) : (
        <div className="flex items-center justify-between">
          <Stat label="Pool" value={first.pair} hint={first.symbol} />
          <span className="text-sm font-medium">
            {status.isLoading ? "…" : status.data?.isDeltaNeutral ? <span className="text-emerald-600 dark:text-emerald-400">neutral ✓</span> : <span className="text-amber-600 dark:text-amber-400">Δ {status.data?.currentDelta ?? "?"}</span>}
          </span>
        </div>
      )}
    </Card>
  );
}

function FxSwapCard() {
  const { data, isLoading } = useFxswapPools();
  return (
    <Card title="FX Swap Pools" subtitle="Vault-backed v4 cross-currency pools.">
      {isLoading ? <span className="text-xs text-neutral-400">…</span> : (
        <div className="flex flex-col">
          {(data?.pools ?? []).map((p) => (
            <div key={p.asset} className="flex items-center justify-between border-b border-purpleDanis/5 py-1 last:border-0 dark:border-white/5">
              <span className="text-xs text-neutral-600 dark:text-white/55">{p.pair}</span>
              <span className="text-[10px] text-neutral-400 dark:text-white/35">{p.pyth} · {p.fee / 100}bps</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RegistryCard() {
  const { data, isLoading } = useRegistryAssets();
  return (
    <Card title="Asset Registry" subtitle={isLoading ? "…" : `${data?.count ?? 0} assets registered on-chain`}>
      <div className="flex flex-wrap gap-1">
        {(data?.assets ?? []).map((a) => (
          <span key={a.symbol} className="rounded-full bg-purpleDanis/8 px-2 py-0.5 text-[10px] text-neutral-700 dark:bg-white/8 dark:text-white/70">{a.symbol}</span>
        ))}
      </div>
    </Card>
  );
}

function PerpsCard() {
  const { address } = useAccount();
  const { data, isLoading } = usePerpsAccount(address);
  return (
    <Card title="Perps — Margin" subtitle="Your FxMarginAccount balance.">
      {!address ? <span className="text-xs text-neutral-400 dark:text-white/40">Connect a wallet to view margin.</span> : (
        <div className="grid grid-cols-3 gap-2.5">
          <Stat label="Total" value={isLoading ? "…" : data?.totalMargin ?? "0"} hint="USDC" />
          <Stat label="Reserved" value={isLoading ? "…" : data?.reservedMargin ?? "0"} />
          <Stat label="Free" value={isLoading ? "…" : data?.freeMargin ?? "0"} />
        </div>
      )}
    </Card>
  );
}

function GatewayCard() {
  const { data, isLoading } = useGatewayInfo();
  return (
    <Card title="Cross-Hub Gateway" subtitle="Circle Gateway USDC locked across hubs.">
      <div className="grid grid-cols-2 gap-2.5">
        <Stat label="Balance" value={isLoading ? "…" : `${data?.gatewayBalance ?? "0"}`} hint="USDC" />
        <Stat label="Unlock" value={isLoading ? "…" : data?.withdrawalUnlockBlock ?? "—"} hint="block" />
      </div>
    </Card>
  );
}

export function ProtocolDashboard() {
  return (
    <main className="mx-auto w-full max-w-4xl p-3 sm:p-4">
      <div className="rounded-2xl border border-purpleDanis/15 bg-white/85 p-4 shadow-[0_14px_36px_-18px_rgba(105,84,207,0.4)] backdrop-blur-xl dark:border-white/10 dark:bg-neutral-950/80 sm:p-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h1 className="text-base font-semibold tracking-tight text-purpleDanis dark:text-white">Protocol</h1>
          <p className="hidden text-[11px] text-neutral-500 dark:text-white/45 sm:block">Live read-only · additive · trading UX unchanged</p>
        </div>
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          <LpInsuranceCard />
          <OracleCard />
          <HedgeCard />
          <FxSwapCard />
          <RegistryCard />
          <PerpsCard />
          <GatewayCard />
        </div>
      </div>
    </main>
  );
}
