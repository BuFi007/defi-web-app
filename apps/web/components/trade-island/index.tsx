"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { AnimatePresence, motion } from "framer-motion";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";

import { truncateAddress } from "@/utils";

import {
  ALL_MARKETS,
  FX_MARKETS,
  PERP_MARKETS,
  Icon,
  fmtPct,
  fmtUSD,
  type Market,
} from "./data";
import { TokenIconPair } from "./token-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { Hint } from "./hint";
import { OrderbookCard, OrderPanelCard, ChartCard } from "./panels";
import {
  LoanTab,
  LOAN_TOKENS,
  LOAN_HUBS,
  HUB_NAME_BY_CHAIN_ID,
  HubPip,
  symbolForToken,
  liveSupplyValueUsd,
  liveBorrowValueUsd,
} from "./loan";
import { ArcadeRoom } from "./multiplayer";
import { MobileTrade } from "./mobile-trade";
import { MarketPicker } from "./market-picker";
import { StablecoinBalances } from "@/components/stablecoin-balances";
import { OnrampCta } from "@/components/onramp/onramp-cta";
import { usePositions, useTrades } from "@/lib/perps/hooks";
import type { PerpsPositionDto, PerpsTradeDto } from "@/lib/perps/client";
import { safeBigInt, e18ToNumber } from "@/lib/perps/units";
import { useLiveMarket } from "@/lib/perps/use-live-market";
import { useMarketStats } from "@/lib/perps/use-market-stats";
import {
  usePositions as useTelaranaPositions,
  useMarkets as useTelaranaMarkets,
} from "@/lib/telarana/hooks";
import type {
  TelaranaMarketSerialized,
  TelaranaPositionSerialized,
} from "@/lib/telarana/client";

// Tiny media-query hook so the Trade tab can branch to the mobile layout
// without bringing in a dependency. Server render returns false; client
// hydrates with the actual match and subscribes to changes.
function useMediaQuery(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatch(mql.matches);
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, [query]);
  return match;
}

const TAB_HINTS: Record<string, string> = {
  loan: "Lend and borrow FX stablecoins across hubs. Earn yield or take a collateralized loan.",
  trade:
    "Order book trading with leverage. Live charts, limit/market orders, manage positions.",
  positions:
    "See your open positions, unrealized PnL, and adjust take-profit / stop-loss.",
  leaders:
    "Top traders by PnL and ROI. Tap Copy to mirror their trades automatically.",
  history: "A timeline of every trade you've closed. Filterable, exportable.",
};

interface TabDef {
  id: string;
  label: string;
  icon: string;
  count?: number;
}

// Map a live PerpsPositionDto into the row shape PerpsPositionsView renders.
// listPositions() currently returns []; the keepers will start emitting fills
// once the matcher round-trips an intent. We carry mark/entry/liq forward when
// the server eventually adds them; otherwise we display em-dashes for
// derived fields rather than fabricated values.
interface PositionRow {
  sym: string;
  side: "long" | "short";
  size: number;
  entry: number | null;
  mark: number | null;
  pnl: number | null;
  margin: number;
  leverage: number;
  liq: number | null;
  marketId?: string;
}

function liveToPositionRow(p: PerpsPositionDto): PositionRow {
  const markPriceE18 = safeBigInt(p.markPrice);
  const sizeUsdc = Number(p.sizeUsdc);
  return {
    // /perps/markets returns symbols like "EURC/USDC" — usable as-is here.
    sym: p.marketId.slice(0, 10),
    side: p.side,
    size: Number.isFinite(sizeUsdc) ? sizeUsdc : 0,
    entry: p.entryPriceE18 ? e18ToNumber(safeBigInt(p.entryPriceE18)) : null,
    mark: markPriceE18 ? e18ToNumber(markPriceE18) : null,
    pnl: p.unrealizedPnlUsdc ? Number(p.unrealizedPnlUsdc) : null,
    margin: Number(p.requiredMargin) || 0,
    leverage: p.leverage,
    liq: p.liqPriceE18 ? e18ToNumber(safeBigInt(p.liqPriceE18)) : null,
    marketId: p.marketId,
  };
}

// Display name resolution for leaderboard rows. Dynamic exposes
// `username` (the slug the user picks at signup), with `alias`,
// `firstName`, and `email` as progressively-less-friendly fallbacks.
// When none of those exist (extension-wallet-only connection, no
// social-auth profile), fall back to a truncated address so the row
// still renders identifiably instead of "Anonymous".
function resolveDisplayName(
  user: ReturnType<typeof useDynamicContext>["user"],
  address: string | null | undefined,
): string {
  const username = user?.username?.trim();
  if (username) return username;
  const alias = user?.alias?.trim();
  if (alias) return alias;
  const firstName = user?.firstName?.trim();
  if (firstName) return firstName;
  const email = user?.email?.trim();
  if (email) return email.split("@")[0] ?? email;
  if (address) return truncateAddress(address, 6);
  return "Anonymous";
}

type LeaderPeriod = "24h" | "7d" | "30d" | "all";

const PERIOD_LABELS: Record<LeaderPeriod, string> = {
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  all: "All-time",
};

// Convert a period to a unix-second cutoff. `null` means "no lower bound"
// (i.e. all-time). Anything older than the cutoff is excluded from the
// window-scoped aggregates.
function periodSinceUnixSec(period: LeaderPeriod): number | null {
  const now = Math.floor(Date.now() / 1000);
  switch (period) {
    case "24h":
      return now - 24 * 60 * 60;
    case "7d":
      return now - 7 * 24 * 60 * 60;
    case "30d":
      return now - 30 * 24 * 60 * 60;
    case "all":
      return null;
  }
}

function LeadersTab() {
  // The hardcoded 6-trader leaderboard (kawaii_whale, zen_trader_42, etc.)
  // was removed 2026-05-18. The cross-trader Ponder leaderboard endpoint
  // still hasn't shipped, but we can render the connected trader's own
  // standings from live /perps/positions + /perps/trades data — using
  // the Dynamic username they picked at signup as the display label,
  // exactly like the eventual multi-row leaderboard will.
  //
  // Realized PnL by window is now live: the indexer writes `pnl` on
  // every `PositionDecreased` (apps/ponder/src/handlers/perps.ts:101),
  // and /perps/trades joins those events onto settlement rows (see
  // apps/api/src/routes/perps.ts), so `t.realizedPnlUsdc` is set on
  // every closing fill. Summing it inside the selected window gives
  // honest window-scoped realized PnL. Unrealized PnL is still the
  // current snapshot from /perps/positions since open positions don't
  // carry a timestamp.
  const { address } = useAccount();
  const { user } = useDynamicContext();
  const { data: livePositions, isLoading } = usePositions();
  const { data: liveTrades } = useTrades();
  const [period, setPeriod] = useState<LeaderPeriod>("30d");

  const positions = livePositions ?? [];
  const trades = liveTrades ?? [];

  const unrealizedPnl = positions.reduce(
    (s, p) => s + (p.unrealizedPnlUsdc ? Number(p.unrealizedPnlUsdc) : 0),
    0,
  );
  const totalMargin = positions.reduce(
    (s, p) => s + (Number(p.requiredMargin) || 0),
    0,
  );

  // Window-scoped trades + realized PnL + volume.
  const sinceSec = periodSinceUnixSec(period);
  const tradesInWindow =
    sinceSec == null
      ? trades
      : trades.filter((t) => t.blockTimestamp >= sinceSec);
  const windowVolume = tradesInWindow.reduce(
    (s, t) => s + (Number(t.sizeUsdc) || 0),
    0,
  );
  const realizedPnl = tradesInWindow.reduce(
    (s, t) => s + (t.realizedPnlUsdc ? Number(t.realizedPnlUsdc) : 0),
    0,
  );

  // Total PnL on the selected window = realized within window + current
  // unrealized snapshot. For "All-time" both terms compose; for shorter
  // windows realized is the slice and unrealized is what's still open.
  const windowPnl = realizedPnl + unrealizedPnl;

  // ROI denominator picks the larger of (window volume) and (current
  // margin) so the ratio reads meaningfully for both an active churner
  // and a fresh trader whose only basis is their open-position margin.
  const roiBase = Math.max(windowVolume, totalMargin);
  const roiPct = roiBase > 0 ? (windowPnl / roiBase) * 100 : null;
  const displayName = resolveDisplayName(user, address);
  const hasStandings =
    Boolean(address) && (positions.length > 0 || tradesInWindow.length > 0);

  return (
    <div className="leaders-tab">
      <div className="leaders-period">
        {(["24h", "7d", "30d", "all"] as const).map((p) => (
          <button
            key={p}
            type="button"
            className={"period-btn " + (period === p ? "active" : "")}
            title={`ROI window — ${PERIOD_LABELS[p]}`}
            onClick={() => setPeriod(p)}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>
      {!address && (
        <EmptyState
          lottie="green-man"
          title="Connect a wallet to see your standings"
          description="The cross-trader leaderboard ships with the Ponder cumulative-PnL view. Until then, sign in to see your own live rank."
        />
      )}

      {address && isLoading && positions.length === 0 && (
        <EmptyState lottie="process" title="Loading your standings…" />
      )}

      {address && !isLoading && !hasStandings && (
        <EmptyState
          lottie="chiquito"
          title={`No activity for ${displayName} in the ${PERIOD_LABELS[period]} window`}
          description="Place a perp trade to start accruing rank-worthy PnL."
        />
      )}

      {hasStandings && (
        <table className="table leaders-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Trader</th>
              <th>Open</th>
              <th>Trades ({PERIOD_LABELS[period]})</th>
              <th>Volume ({PERIOD_LABELS[period]})</th>
              <th>Realized ({PERIOD_LABELS[period]})</th>
              <th>Unrealized</th>
              <th>ROI ({PERIOD_LABELS[period]})</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <span className="rank-badge rank-1">1</span>
              </td>
              <td>
                <div style={{ fontWeight: 800 }}>{displayName}</div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "var(--ink-3)",
                    fontWeight: 700,
                  }}
                >
                  {address ? truncateAddress(address, 6) : "—"}
                </div>
              </td>
              <td className="mono">{positions.length}</td>
              <td className="mono">{tradesInWindow.length}</td>
              <td className="mono">{fmtUSD(windowVolume)}</td>
              <td
                className="mono"
                style={{
                  color:
                    realizedPnl >= 0 ? "var(--profit-ink)" : "var(--loss-ink)",
                  fontWeight: 800,
                }}
              >
                {(realizedPnl >= 0 ? "+" : "") + fmtUSD(realizedPnl)}
              </td>
              <td
                className="mono"
                style={{
                  color:
                    unrealizedPnl >= 0
                      ? "var(--profit-ink)"
                      : "var(--loss-ink)",
                  fontWeight: 800,
                }}
              >
                {(unrealizedPnl >= 0 ? "+" : "") + fmtUSD(unrealizedPnl)}
              </td>
              <td
                className="mono"
                style={{
                  color:
                    roiPct == null
                      ? "var(--ink-3)"
                      : roiPct >= 0
                        ? "var(--profit-ink)"
                        : "var(--loss-ink)",
                  fontWeight: 800,
                }}
                title={`Window PnL = realized (${fmtUSD(realizedPnl)}) + unrealized (${fmtUSD(unrealizedPnl)}); ROI base = max(window volume, current margin)`}
              >
                {roiPct == null ? "—" : fmtPct(roiPct)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function HistoryTab() {
  const { data: liveTrades, isLoading, isError } = useTrades();
  const trades = useMemo<PerpsTradeDto[]>(() => liveTrades ?? [], [liveTrades]);

  if (isLoading) {
    return (
      <div className="history-tab" aria-busy="true">
        <p className="muted" style={{ padding: "24px", textAlign: "center" }}>
          Loading trade history…
        </p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="history-tab">
        <p className="muted" style={{ padding: "24px", textAlign: "center" }}>
          Couldn&apos;t load trade history. Retry shortly.
        </p>
      </div>
    );
  }

  if (trades.length === 0) {
    // /perps/trades currently returns []. Render a clean empty state
    // surfaced as a TODO so it's obvious why nothing shows up.
    return (
      <div className="history-tab">
        <div className="history-summary">
          <div className="hsum-card">
            <div className="hsum-l">Trades</div>
            <div className="hsum-v mono">0</div>
          </div>
        </div>
        <EmptyState
          lottie="coffee"
          title="No closed trades yet"
          description="Once the matcher fills your first perp order it'll show up here."
        />
      </div>
    );
  }

  return (
    <div className="history-tab">
      <table className="table table-desktop-only">
        <thead>
          <tr>
            <th>Time</th>
            <th>Market</th>
            <th>Side</th>
            <th>Size (USDC)</th>
            <th>Fill Price</th>
            <th>Tx</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const ts = new Date(t.blockTimestamp * 1000)
              .toTimeString()
              .slice(0, 8);
            return (
              <tr key={`${t.txHash}-${t.marketId}-${t.blockTimestamp}`}>
                <td className="mono" style={{ color: "var(--ink-3)" }}>
                  {ts}
                </td>
                <td>
                  <span style={{ fontWeight: 800 }}>
                    {shortMarket(t.marketId)}
                  </span>
                </td>
                <td>
                  <span className={"side-tag " + t.side}>
                    {t.side.toUpperCase()}
                  </span>
                </td>
                <td className="mono">{t.sizeUsdc}</td>
                <td className="mono">
                  {e18ToNumber(safeBigInt(t.fillPriceE18))?.toFixed(4) ?? "—"}
                </td>
                <td className="mono" style={{ color: "var(--ink-3)" }}>
                  {t.txHash.slice(0, 10)}…
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PerpsPositionCards({ rows }: { rows: PositionRow[] }) {
  return (
    <div className="pos-cards" aria-label="Open perp positions">
      {rows.map((p, i) => {
        const m = ALL_MARKETS.find((mm) => mm.sym === p.sym);
        const dec =
          p.entry !== null ? (p.entry < 10 ? 4 : p.entry < 1000 ? 2 : 1) : 4;
        const pnlPct =
          p.pnl !== null ? (p.pnl / Math.max(p.margin, 1)) * 100 : null;
        return (
          <article key={`${p.sym}-${i}`} className="pos-card">
            <header className="pos-card-head">
              <TokenIconPair
                base={m?.base ?? p.sym}
                quote={m?.quote ?? "USD"}
                size={22}
              />
              <div className="pos-card-meta">
                <div className="pos-card-sym">{p.sym}</div>
                <div className="pos-card-sub">{p.leverage}x · Cross</div>
              </div>
              <span className={"side-tag " + p.side}>
                {p.side.toUpperCase()}
              </span>
              <div
                className={
                  "pos-card-pnl mono " + ((p.pnl ?? 0) >= 0 ? "profit" : "loss")
                }
              >
                <div className="pos-card-pnl-v">
                  {p.pnl === null
                    ? "—"
                    : (p.pnl >= 0 ? "+" : "") + fmtUSD(p.pnl)}
                </div>
                <div className="pos-card-pnl-pct">
                  {pnlPct === null ? "" : fmtPct(pnlPct)}
                </div>
              </div>
            </header>
            <dl className="pos-card-grid">
              <div>
                <dt>Size</dt>
                <dd className="mono">{p.size.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Margin</dt>
                <dd className="mono">{fmtUSD(p.margin)}</dd>
              </div>
              <div>
                <dt>Entry</dt>
                <dd className="mono">{p.entry?.toFixed(dec) ?? "—"}</dd>
              </div>
              <div>
                <dt>Mark</dt>
                <dd className="mono">{p.mark?.toFixed(dec) ?? "—"}</dd>
              </div>
              <div>
                <dt>Liq.</dt>
                <dd className="mono" style={{ color: "var(--loss-ink)" }}>
                  {p.liq?.toFixed(dec) ?? "—"}
                </dd>
              </div>
              <div>
                <dt>TP/SL</dt>
                <dd>
                  <button className="copy-btn" style={{ padding: "3px 8px" }}>
                    <Icon name="plus" size={10} /> Set
                  </button>
                </dd>
              </div>
            </dl>
            <button className="pos-card-close">Close position</button>
          </article>
        );
      })}
    </div>
  );
}

function PerpsPositionsView() {
  const { address } = useAccount();
  const { data: livePositions, isLoading, isError } = usePositions();

  const rows = useMemo<PositionRow[]>(
    () => (livePositions ?? []).map(liveToPositionRow),
    [livePositions],
  );

  const totalPnl = rows.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const totalMargin = rows.reduce((s, p) => s + p.margin, 0);
  const openCount = rows.length;

  // Surface a sentinel when the wallet isn't connected so a real trader knows
  // why they're staring at zeros (vs. assuming the keeper is broken).
  const showConnectHint = !address && !isLoading;

  return (
    <div className="pp-view">
      <div className="history-summary">
        <div className="hsum-card">
          <div className="hsum-l">
            Open Positions{" "}
            <Hint w={220}>
              How many perp trades you have running right now.
            </Hint>
          </div>
          <div className="hsum-v mono">{openCount}</div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Unrealized PnL{" "}
            <Hint w={240}>
              Profit or loss if you closed every position at the current mark
              price.
            </Hint>
          </div>
          <div className={"hsum-v mono " + (totalPnl >= 0 ? "profit" : "loss")}>
            {totalPnl >= 0 ? "+" : ""}
            {fmtUSD(totalPnl)}
          </div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Margin Used{" "}
            <Hint w={240}>
              Collateral currently locked up backing your open positions.
            </Hint>
          </div>
          <div className="hsum-v mono">{fmtUSD(totalMargin)}</div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Open Orders{" "}
            <Hint w={220}>
              Pending limit orders waiting for price to be reached.
            </Hint>
          </div>
          {/* Pending limit-order count: needs a user-scoped intents-by-signer
              endpoint (/perps/intents/pending exists but it's market-scoped).
              Show an em-dash until that lands rather than fabricate a count. */}
          <div className="hsum-v mono">—</div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Funding (24h){" "}
            <Hint w={240}>
              Net funding paid (−) or received (+) on perpetual positions in the
              last 24h.
            </Hint>
          </div>
          {/* Funding (24h) needs cumulative funding × position-size × time.
              fetchPerpsFunding() returns the per-market rate; the cumulative
              attribution lives in the indexer (per-position funding accruals).
              Show an em-dash until the indexer surfaces it. */}
          <div className="hsum-v mono">—</div>
        </div>
      </div>
      {showConnectHint && (
        <EmptyState
          lottie="green-man"
          title="Connect a wallet to load your live perp positions"
          description="Sign in via the wallet button in the top-right corner to start trading."
        />
      )}
      {isLoading && address && (
        <EmptyState lottie="process" title="Loading positions…" />
      )}
      {isError && (
        <EmptyState
          lottie="skull-lottie"
          title="Couldn't load positions"
          description="Retry shortly — the perps API may be warming up."
        />
      )}
      {rows.length === 0 && address && !isLoading && !isError && (
        <EmptyState
          lottie="chiquito"
          title="No open perp positions yet"
          description="Place a Long or Short from the Trade tab to get started."
        />
      )}
      {rows.length > 0 && (
        <>
          <table className="table table-desktop-only">
            <thead>
              <tr>
                <th>Market</th>
                <th>
                  Side{" "}
                  <Hint w={220}>
                    Long bets the price rises. Short bets it falls.
                  </Hint>
                </th>
                <th>
                  Size{" "}
                  <Hint w={220}>
                    Notional value of the position in the base currency.
                  </Hint>
                </th>
                <th>
                  Entry <Hint w={200}>Average price at which you opened.</Hint>
                </th>
                <th>
                  Mark{" "}
                  <Hint w={220}>Current price used to value the position.</Hint>
                </th>
                <th>
                  Liq. Price{" "}
                  <Hint w={260}>
                    If the mark price reaches this, your position is liquidated.
                  </Hint>
                </th>
                <th>
                  Margin{" "}
                  <Hint w={220}>
                    Collateral locked up backing this position.
                  </Hint>
                </th>
                <th>
                  PnL{" "}
                  <Hint w={220}>Profit or loss right now, before fees.</Hint>
                </th>
                <th>
                  TP/SL{" "}
                  <Hint w={260}>
                    Take-profit and stop-loss orders that auto-close this
                    position.
                  </Hint>
                </th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const m = ALL_MARKETS.find((mm) => mm.sym === p.sym);
                const dec =
                  p.entry !== null
                    ? p.entry < 10
                      ? 4
                      : p.entry < 1000
                        ? 2
                        : 1
                    : 4;
                const pnlPct =
                  p.pnl !== null ? (p.pnl / Math.max(p.margin, 1)) * 100 : null;
                return (
                  <tr key={`${p.sym}-${i}`}>
                    <td>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <TokenIconPair
                          base={m?.base ?? p.sym}
                          quote={m?.quote ?? "USD"}
                          size={20}
                        />
                        <div>
                          <div style={{ fontWeight: 800 }}>{p.sym}</div>
                          <div
                            style={{
                              fontSize: 10.5,
                              color: "var(--ink-3)",
                              fontWeight: 700,
                            }}
                          >
                            {p.leverage}x · Cross
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={"side-tag " + p.side}>
                        {p.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="mono">{p.size.toLocaleString()}</td>
                    <td className="mono">{p.entry?.toFixed(dec) ?? "—"}</td>
                    <td className="mono">{p.mark?.toFixed(dec) ?? "—"}</td>
                    <td className="mono" style={{ color: "var(--loss-ink)" }}>
                      {p.liq?.toFixed(dec) ?? "—"}
                    </td>
                    <td className="mono">{fmtUSD(p.margin)}</td>
                    <td
                      className="mono"
                      style={{
                        color:
                          (p.pnl ?? 0) >= 0
                            ? "var(--profit-ink)"
                            : "var(--loss-ink)",
                        fontWeight: 800,
                      }}
                    >
                      {p.pnl === null
                        ? "—"
                        : (p.pnl >= 0 ? "+" : "") + fmtUSD(p.pnl)}
                      <div style={{ fontSize: 10.5, opacity: 0.8 }}>
                        {pnlPct === null ? "" : fmtPct(pnlPct)}
                      </div>
                    </td>
                    <td>
                      <button className="copy-btn">
                        <Icon name="plus" size={10} /> Set
                      </button>
                    </td>
                    <td>
                      <button className="close-btn">Close</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <PerpsPositionCards rows={rows} />
        </>
      )}
    </div>
  );
}

function LoanPositionsView() {
  const { address } = useAccount();
  // Live telarana positions. Replaces the legacy LOAN_POSITIONS
  // hardcoded $4,246 / $6,320 / $2,073 demo block. The DTO returned
  // by /fx-telarana/positions/:address only carries marketId +
  // supply/borrow assets — token addresses come from joining against
  // the live markets list.
  const {
    positions: livePositions,
    loading,
    error,
  } = useTelaranaPositions(address as `0x${string}` | undefined);
  const { markets: liveMarkets } = useTelaranaMarkets();
  const marketById = useMemo(() => {
    const map = new Map<string, TelaranaMarketSerialized>();
    for (const m of liveMarkets) {
      map.set(`${m.hubChainId}-${m.id.toLowerCase()}`, m);
    }
    return map;
  }, [liveMarkets]);

  // Split each TelaranaPositionSerialized into supply / borrow legs.
  // A user can hold BOTH on the same market (supply USDC + borrow
  // EURC against it) — Morpho stores them as separate fields on the
  // same position object.
  const rows = livePositions.flatMap((p) => {
    const market = marketById.get(
      `${p.hubChainId}-${p.marketId.toLowerCase()}`,
    );
    const legs: Array<{
      kind: "supply" | "borrow";
      pos: TelaranaPositionSerialized;
      market: TelaranaMarketSerialized | undefined;
      valueUsd: number;
    }> = [];
    const supplyUsd = liveSupplyValueUsd(p);
    if (supplyUsd > 0)
      legs.push({ kind: "supply", pos: p, market, valueUsd: supplyUsd });
    const borrowUsd = liveBorrowValueUsd(p);
    if (borrowUsd > 0)
      legs.push({ kind: "borrow", pos: p, market, valueUsd: borrowUsd });
    return legs;
  });

  const totalSupplied = rows
    .filter((r) => r.kind === "supply")
    .reduce((s, r) => s + r.valueUsd, 0);
  const totalBorrowed = rows
    .filter((r) => r.kind === "borrow")
    .reduce((s, r) => s + r.valueUsd, 0);
  const netWorth = totalSupplied - totalBorrowed;
  const supplyCount = rows.filter((r) => r.kind === "supply").length;
  const borrowCount = rows.filter((r) => r.kind === "borrow").length;

  return (
    <div className="pp-view">
      <div className="history-summary">
        <div className="hsum-card">
          <div className="hsum-l">
            Net worth{" "}
            <Hint w={220}>
              Supplied minus borrowed across all loan/borrow markets.
            </Hint>
          </div>
          <div className="hsum-v mono">{address ? fmtUSD(netWorth) : "—"}</div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Supplied{" "}
            <Hint w={220}>Funds you&apos;ve deposited earning yield.</Hint>
          </div>
          <div className="hsum-v mono" style={{ color: "var(--profit-ink)" }}>
            {address ? fmtUSD(totalSupplied) : "—"}
          </div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Borrowed{" "}
            <Hint w={220}>Loans you&apos;ve taken accruing interest.</Hint>
          </div>
          <div className="hsum-v mono" style={{ color: "var(--loss-ink)" }}>
            {address ? fmtUSD(totalBorrowed) : "—"}
          </div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Open lends{" "}
            <Hint w={220}>Number of supply positions across all hubs.</Hint>
          </div>
          <div className="hsum-v mono">{address ? supplyCount : "—"}</div>
        </div>
        <div className="hsum-card">
          <div className="hsum-l">
            Open borrows{" "}
            <Hint w={220}>Number of borrow positions across all hubs.</Hint>
          </div>
          <div className="hsum-v mono">{address ? borrowCount : "—"}</div>
        </div>
      </div>

      {!address && (
        <EmptyState
          lottie="green-man"
          title="Connect a wallet to see your live loan/borrow positions"
          description="Sign in via the wallet button in the top-right corner."
        />
      )}
      {address && loading && rows.length === 0 && (
        <EmptyState lottie="process" title="Loading positions…" />
      )}
      {address && error && (
        <EmptyState
          lottie="skull-lottie"
          title="Couldn't load positions"
          description={error}
        />
      )}
      {address && !loading && !error && rows.length === 0 && (
        <EmptyState
          lottie="vampi"
          title="No open loan/borrow positions yet"
          description="Head to the Loan / Borrow tab to lend or borrow."
        />
      )}

      {rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>
                Kind{" "}
                <Hint w={220}>
                  Whether you&apos;re supplying (earning) or borrowing (paying).
                </Hint>
              </th>
              <th>Market</th>
              <th>
                Hub <Hint w={220}>Which chain hub this position lives on.</Hint>
              </th>
              <th>Amount</th>
              <th>Value</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const p = r.pos;
              const m = r.market;
              // When the market lookup misses (live markets API
              // still loading), fall back to the bare marketId hex
              // so the row stays readable instead of crashing.
              const loanSym = m ? symbolForToken(m.loanToken) : "TOK";
              const collSym = m ? symbolForToken(m.collateralToken) : "TOK";
              const hubName = HUB_NAME_BY_CHAIN_ID[p.hubChainId];
              const hub = LOAN_HUBS[hubName];
              const tok = LOAN_TOKENS[loanSym] ?? LOAN_TOKENS.USDC;
              const decimals = 6; // both USDC and EURC use 6-dp testnet
              const amountAtomic =
                r.kind === "supply"
                  ? BigInt(p.supplyAssets)
                  : BigInt(p.borrowAssets);
              const amountFloat = Number(amountAtomic) / 10 ** decimals;
              return (
                <tr key={`${p.marketId}-${r.kind}-${i}`}>
                  <td>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <TokenIconPair base={loanSym} quote={collSym} size={24} />
                      <div>
                        <div style={{ fontWeight: 800 }}>{loanSym}</div>
                        <div
                          style={{
                            fontSize: 10.5,
                            color: "var(--ink-3)",
                            fontWeight: 700,
                          }}
                        >
                          {tok.name}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      className={
                        "side-tag " + (r.kind === "supply" ? "long" : "short")
                      }
                    >
                      {r.kind === "supply" ? "LEND" : "BORROW"}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontWeight: 800 }}>
                      <span className="mkt-loan">{loanSym}</span>
                      <span className="mkt-slash">/</span>
                      <span className="mkt-coll">{collSym}</span>
                    </span>
                  </td>
                  <td>
                    {hub ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontWeight: 700,
                          fontSize: 12.5,
                        }}
                      >
                        <HubPip hub={hub} size={18} />
                        {hub.short}
                      </span>
                    ) : (
                      <span className="mono" style={{ fontSize: 11 }}>
                        chain {p.hubChainId}
                      </span>
                    )}
                  </td>
                  <td className="mono">
                    {amountFloat.toLocaleString(undefined, {
                      maximumFractionDigits: 4,
                    })}{" "}
                    <span style={{ color: "var(--ink-3)", fontWeight: 700 }}>
                      {loanSym}
                    </span>
                  </td>
                  <td className="mono">{fmtUSD(r.valueUsd)}</td>
                  <td>
                    <button className="close-btn" type="button">
                      {r.kind === "supply" ? "Withdraw" : "Repay"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PositionsOnlyTab() {
  const [sub, setSub] = useState("perps");
  const { address } = useAccount();
  const { data: livePositions } = usePositions();
  const { positions: loanLivePositions } = useTelaranaPositions(
    address as `0x${string}` | undefined,
  );
  const perpsCount = livePositions?.length ?? 0;
  // Count loan-tab positions as the number of legs (supply or borrow)
  // with non-zero on-chain assets — matches the row count rendered by
  // LoanPositionsView.
  const loanLegCount = loanLivePositions.reduce((sum, p) => {
    let legs = 0;
    if (liveSupplyValueUsd(p) > 0) legs += 1;
    if (liveBorrowValueUsd(p) > 0) legs += 1;
    return sum + legs;
  }, 0);
  return (
    <div className="positions-only-tab">
      <div className="pp-subtabs">
        <button
          className={"pp-subtab " + (sub === "perps" ? "active" : "")}
          onClick={() => setSub("perps")}
        >
          <Icon name="candle" size={13} />
          <span>Trading</span>
          <span className="pp-subtab-count">{perpsCount}</span>
        </button>
        <button
          className={"pp-subtab " + (sub === "loan" ? "active" : "")}
          onClick={() => setSub("loan")}
        >
          <Icon name="vault" size={13} />
          <span>Loan / Borrow</span>
          <span className="pp-subtab-count">{loanLegCount}</span>
        </button>
      </div>
      {sub === "perps" && <PerpsPositionsView />}
      {sub === "loan" && <LoanPositionsView />}
    </div>
  );
}

function TradeTab({
  market,
  marketSym,
  setMarketSym,
}: {
  market: Market;
  marketSym: string;
  setMarketSym: (s: string) => void;
}) {
  // Switch to the dedicated mobile layout under the `lg` breakpoint. Matches
  // the island.css cutover at 1023.98px so the two systems agree.
  const isMobile = useMediaQuery("(max-width: 1023.98px)");
  // Single source of truth for the trader-selected leverage. Lifted
  // here so ChartCard's pill stays in sync with OrderPanelCard's
  // slider — both consume `lev`, only OrderPanelCard mutates it via
  // `setLev`. Default = 1x = SPOT mode (Buy/Sell labels); the trader
  // explicitly opts into perps by sliding past 1. Reset to spot on
  // market change so symbol switches don't carry stale leverage.
  const [lev, setLev] = useState(1);
  useEffect(() => {
    setLev(1);
  }, [market.sym]);
  if (isMobile) {
    return (
      <div className="trade-tab trade-tab-mobile">
        <MobileTrade
          market={market}
          marketSym={marketSym}
          setMarketSym={setMarketSym}
        />
      </div>
    );
  }
  return (
    <div className="trade-tab">
      <div className="trade-layout">
        <div className="t-orderbook">
          <OrderbookCard market={market} />
        </div>
        <div className="t-chart">
          <ChartCard market={market} selectedLeverage={lev} />
        </div>
        <div className="t-order">
          <OrderPanelCard market={market} leverage={lev} setLeverage={setLev} />
        </div>
      </div>
    </div>
  );
}

function TradeIslandHeader({
  tab,
  setTab,
  market,
  setMarketSym,
  arcade,
  setArcade,
}: {
  tab: string;
  setTab: (id: string) => void;
  market: Market;
  setMarketSym: (s: string) => void;
  arcade: boolean;
  setArcade: (v: boolean) => void;
}) {
  // Live position count drives the tab pill; mock orders + mock positions are
  // no longer trusted for the trader-visible total.
  const { data: livePositions } = usePositions();
  const livePositionsCount = livePositions?.length ?? 0;

  const tabs: TabDef[] = [
    { id: "loan", label: "Loan / Borrow", icon: "vault" },
    { id: "trade", label: "Trade", icon: "candle" },
    {
      id: "positions",
      label: "Positions",
      icon: "layers",
      count: livePositionsCount,
    },
    { id: "leaders", label: "Leaderboard", icon: "trophy" },
    { id: "history", label: "History", icon: "doc" },
  ];

  const liveTotalPnl = (livePositions ?? []).reduce(
    (s, p) => s + (p.unrealizedPnlUsdc ? Number(p.unrealizedPnlUsdc) : 0),
    0,
  );

  return (
    <header className="island-header">
      {/* MarketPicker docks at the far LEFT of the header on the Trade
          tab — separates "what market am I looking at" from the rest
          of the island chrome and keeps the pair price always visible
          in the upper-left where the user's eye lands first. */}
      {tab === "trade" && (
        <div className="island-leading">
          <MarketPicker market={market} setMarketSym={setMarketSym} />
        </div>
      )}
      <div className="island-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={"island-tab " + (tab === t.id ? "active" : "")}
            onClick={() => {
              setTab(t.id);
              if (t.id !== "trade") setArcade(false);
            }}
            title={TAB_HINTS[t.id]}
          >
            <Icon name={t.icon} size={14} />
            <span>{t.label}</span>
            {t.count != null && <span className="tab-pill">{t.count}</span>}
          </button>
        ))}
      </div>
      <div className="island-summary">
        <OnrampCta />
        <StablecoinBalances />
        {liveTotalPnl !== 0 && (
          <span className={"pill " + (liveTotalPnl >= 0 ? "profit" : "loss")}>
            {liveTotalPnl >= 0 ? "+" : ""}
            {fmtUSD(liveTotalPnl)}
          </span>
        )}
        {/* Arcade toggle is always visible — clicking from a non-Trade
            tab also flips the active tab to "trade" so the Arcade room
            actually renders. Previously the button only existed on the
            Trade tab, which made it impossible to drop into arcade from
            Loan / Positions / etc. */}
        <button
          className={"island-collapse mode-switch " + (arcade ? "arcade" : "")}
          onClick={() => {
            const next = !arcade;
            setArcade(next);
            if (next && tab !== "trade") setTab("trade");
          }}
          title={arcade ? "Back to Pro Mode" : "Enter Arcade Mode"}
        >
          <span className="mode-label">{arcade ? "PRO" : "ARCADE"}</span>
          <span className="mode-glyph">{arcade ? "⊞" : "✦"}</span>
        </button>
      </div>
    </header>
  );
}

export default function TradeIsland() {
  const [tab, setTab] = useState("trade");
  const [marketSym, setMarketSym] = useState("EUR/USD");
  const [arcade, setArcade] = useState(false);
  const baseMarket = useMemo(
    () => ALL_MARKETS.find((m) => m.sym === marketSym) || FX_MARKETS[0],
    [marketSym],
  );

  // Live market state, two sources:
  //
  //   1. useLiveMarket — Pyth Hermes WS via apps/api /ws/markets/:sym.
  //      Streams `mark` updates every ~400 ms. Most accurate price.
  //
  //   2. useMarketStats — Pyth Benchmarks (15 m candles aggregated to
  //      24 h high/low/changePct/close). The change% comes from here.
  //
  // The static `price` + `change` fields on FX_MARKETS / PERP_MARKETS
  // in data.tsx are LAST-RESORT seeds for offline dev — they go years
  // out of date (the 1.0842 EUR/USD seed dates from 2024). At runtime
  // both fields are overridden by the live sources so the trader
  // never sees stale numbers on the trigger pill, chart header, or
  // order panel mid-price.
  const live = useLiveMarket(baseMarket.sym);
  const stats = useMarketStats(baseMarket.sym);
  const market = useMemo(() => {
    const livePrice = live.tick?.mark;
    const fallbackPrice =
      stats.data?.close ??
      (Number.isFinite(baseMarket.price) ? baseMarket.price : 0);
    const price =
      livePrice && Number.isFinite(livePrice) && livePrice > 0
        ? livePrice
        : fallbackPrice;
    const change =
      stats.data?.changePct != null && Number.isFinite(stats.data.changePct)
        ? stats.data.changePct
        : 0;
    return { ...baseMarket, price, change };
  }, [baseMarket, live.tick?.mark, stats.data?.close, stats.data?.changePct]);

  // PERP_MARKETS still feeds arcade / market-picker filtering downstream
  // until it's swapped for fetchPerpsMarkets() (Task 2). Silence the
  // unused-import warning until then.
  void PERP_MARKETS;

  // Adaptive width per tab — the dynamic-island morph. Every tab maps
  // to a UNIQUE width so switching produces a visible spring on the
  // container chrome (no two tabs match — the user always feels the
  // motion). Arcade overrides per phase: only the live game runs at
  // full canvas (1440); lobby / countdown / round-end shrink toward
  // the centre to match the actual content density.
  const ISLAND_MAX_WIDTH: Record<string, number> = {
    trade: 1440, // full 3-column trading canvas
    positions: 1140, // table + summary cards
    loan: 1100, // markets table + ActionCard, narrower per user request
    leaders: 920, // vertical leaderboard rows
    history: 1000, // trade history rows — wide enough to breathe like positions
  };
  const ARCADE_PHASE_WIDTH: Record<string, number> = {
    lobby: 1180, // room cards grid
    countdown: 720, // 3-2-1 splash — tightest screen
    playing: 1440, // live game canvas, full width per spec
    roundEnd: 1080, // leaderboard overlay
    final: 1280, // results screen
  };
  const [arcadePhase, setArcadePhase] = useState<
    "lobby" | "countdown" | "playing" | "roundEnd" | "final"
  >("lobby");
  const targetMaxWidth =
    arcade && tab === "trade"
      ? (ARCADE_PHASE_WIDTH[arcadePhase] ?? 1440)
      : (ISLAND_MAX_WIDTH[tab] ?? 1440);

  return (
    <motion.div
      layout
      initial={false}
      animate={{ maxWidth: targetMaxWidth }}
      transition={{ type: "spring", stiffness: 220, damping: 28, mass: 0.9 }}
      className={
        "island " +
        (arcade && tab === "trade" ? "arcade-on" : "") +
        " tab-" +
        tab
      }
      style={{ width: "100%", marginLeft: "auto", marginRight: "auto" }}
    >
      <TradeIslandHeader
        tab={tab}
        setTab={setTab}
        market={market}
        setMarketSym={setMarketSym}
        arcade={arcade}
        setArcade={setArcade}
      />

      <div
        className={
          "island-body " + (arcade && tab === "trade" ? "arcade-on" : "")
        }
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={arcade && tab === "trade" ? "arcade" : tab}
            initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
            }}
          >
            {tab === "trade" && !arcade && (
              <TradeTab
                market={market}
                marketSym={marketSym}
                setMarketSym={setMarketSym}
              />
            )}
            {tab === "trade" && arcade && (
              <ArcadeRoom
                market={market}
                onClose={() => setArcade(false)}
                onPhaseChange={setArcadePhase}
              />
            )}
            {tab === "positions" && <PositionsOnlyTab />}
            {tab === "loan" && <LoanTab />}
            {tab === "leaders" && <LeadersTab />}
            {tab === "history" && <HistoryTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function shortMarket(marketId: string): string {
  if (marketId.length <= 14) return marketId;
  return `${marketId.slice(0, 10)}…${marketId.slice(-4)}`;
}
