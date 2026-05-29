"use client";
// Additive protocol dashboard — surfaces the hyper-mcp protocol families for
// non-technical + agentic users. Self-contained on the /protocol route; does NOT
// touch or restyle the existing TradeIsland / HomeContent UX. The loop appends a
// section per family here. Tailwind utility styling, light/dark safe.
import React from "react";
import { useAccount } from "wagmi";
import {
  useLpInfo, useVaultDepths, useOraclePrice, useGatewayInfo,
  useHedgePools, useHedgeStatus, useFxswapPools, useRegistryAssets, usePerpsAccount,
} from "@/lib/protocol/hooks";

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/60">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{title}</h2>
        {subtitle && <p className="text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</span>
      <span className="text-base font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{value}</span>
      {hint && <span className="text-[11px] text-neutral-400">{hint}</span>}
    </div>
  );
}

function LpInsuranceCard() {
  const info = useLpInfo();
  const depths = useVaultDepths();
  const fs = info.data?.feeSplit;
  return (
    <Card title="LP Vault — Composite APY" subtitle="Deposit USDC, earn lending + trading-fee share + hedge income as one blended yield.">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Composite APY" value={info.isLoading ? "…" : info.data?.compositeApyPercent ? `${Number(info.data.compositeApyPercent).toFixed(2)}%` : "—"} hint="no LPs yet → 0" />
        <Stat label="Total Deposits" value={info.isLoading ? "…" : `${info.data?.totalDeposits ?? "0"} USDC`} />
        <Stat label="Junior Buffer" value={depths.isLoading ? "…" : `${Number(depths.data?.totalJuniorUsdc ?? 0).toLocaleString()} USDC`} />
      </div>
      {fs && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Protocol {fs.protocolBps / 100}%</span>
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">LP {fs.lpBps / 100}%</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Insurance {fs.insuranceBps / 100}%</span>
        </div>
      )}
      {depths.data?.juniorTokenBalances && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {Object.entries(depths.data.juniorTokenBalances).map(([sym, bal]) => (
            <Stat key={sym} label={sym} value={Number(bal).toLocaleString(undefined, { maximumFractionDigits: 0 })} />
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
    <div className="flex items-center justify-between border-b border-neutral-100 py-1.5 last:border-0 dark:border-neutral-800">
      <span className="text-sm text-neutral-700 dark:text-neutral-300">{base}/{quote}</span>
      <span className="flex items-center gap-2 tabular-nums">
        <span className="text-sm font-medium">{isLoading ? "…" : data?.mid ? Number(data.mid).toFixed(6) : data?.error ? "n/a" : "—"}</span>
        {data?.stale && <span className="rounded bg-red-100 px-1.5 text-[10px] text-red-700 dark:bg-red-900/40 dark:text-red-300">stale</span>}
      </span>
    </div>
  );
}
function OracleCard() {
  return (
    <Card title="FX Oracle V2" subtitle="Live mid prices (Pyth → RedStone → Chainlink). 'stale' = past the freshness window.">
      <div className="flex flex-col">{ORACLE_PAIRS.map(([b, q2]) => <OracleRow key={b} base={b} quote={q2} />)}</div>
    </Card>
  );
}

function GatewayCard() {
  const { data, isLoading } = useGatewayInfo();
  return (
    <Card title="Cross-Hub Gateway" subtitle="Circle Gateway USDC locked across hubs (FxGatewayHook).">
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Gateway Balance" value={isLoading ? "…" : `${data?.gatewayBalance ?? "0"} USDC`} />
        <Stat label="Withdraw Unlock" value={isLoading ? "…" : (data?.withdrawalUnlockBlock ?? "—")} hint="block" />
      </div>
    </Card>
  );
}

function HedgeCard() {
  const pools = useHedgePools();
  const first = pools.data?.pools?.[0];
  const status = useHedgeStatus(first?.poolId);
  return (
    <Card title="Delta-Neutral Hedge" subtitle="FxHedgeHook keeps a pool delta-neutral via an offsetting perp.">
      {!first ? (
        <span className="text-sm text-neutral-400">{pools.isLoading ? "…" : "no hedge pools"}</span>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Pool" value={first.pair} hint={first.symbol} />
          <Stat
            label="Status"
            value={
              status.isLoading ? "…" : status.data?.isDeltaNeutral ? (
                <span className="text-emerald-600 dark:text-emerald-400">neutral ✓</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">Δ {status.data?.currentDelta ?? "?"}</span>
              )
            }
          />
        </div>
      )}
    </Card>
  );
}

function FxSwapCard() {
  const { data, isLoading } = useFxswapPools();
  return (
    <Card title="FX Swap Pools" subtitle="Vault-backed v4 cross-currency pools (quote/execute via the MCP).">
      {isLoading ? (
        <span className="text-sm text-neutral-400">…</span>
      ) : (
        <div className="flex flex-col">
          {(data?.pools ?? []).map((p) => (
            <div key={p.asset} className="flex items-center justify-between border-b border-neutral-100 py-1.5 last:border-0 dark:border-neutral-800">
              <span className="text-sm text-neutral-700 dark:text-neutral-300">{p.pair}</span>
              <span className="text-xs text-neutral-400">{p.pyth} · fee {p.fee / 100}bps</span>
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
    <Card title="Asset Registry" subtitle="Assets registered on-chain in the protocol.">
      <Stat label="Registered" value={isLoading ? "…" : `${data?.count ?? 0} assets`} />
      <div className="flex flex-wrap gap-1.5">
        {(data?.assets ?? []).map((a) => (
          <span key={a.symbol} className={`rounded-full px-2 py-0.5 text-[11px] ${a.enabled ? "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200" : "bg-red-100 text-red-700"}`}>
            {a.symbol}
          </span>
        ))}
      </div>
    </Card>
  );
}

function PerpsCard() {
  const { address } = useAccount();
  const { data, isLoading } = usePerpsAccount(address);
  return (
    <Card title="Perps — Margin" subtitle="Your perp margin account (FxMarginAccount).">
      {!address ? (
        <span className="text-sm text-neutral-400">Connect a wallet to view margin.</span>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Total" value={isLoading ? "…" : `${data?.totalMargin ?? "0"}`} hint="USDC" />
          <Stat label="Reserved" value={isLoading ? "…" : `${data?.reservedMargin ?? "0"}`} />
          <Stat label="Free" value={isLoading ? "…" : `${data?.freeMargin ?? "0"}`} />
        </div>
      )}
    </Card>
  );
}

export function ProtocolDashboard() {
  const { address } = useAccount();
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Protocol</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Live read-only view of the fx-Telaraña protocol surface (additive — your trading UX is unchanged).
          {address ? "" : " Connect a wallet to see your positions."}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LpInsuranceCard />
        <OracleCard />
        <HedgeCard />
        <FxSwapCard />
        <RegistryCard />
        <PerpsCard />
        <GatewayCard />
      </div>
    </main>
  );
}
