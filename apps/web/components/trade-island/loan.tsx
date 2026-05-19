"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { useAccount, useBalance } from "wagmi";
import { formatUnits, parseUnits } from "viem";

import { useToast } from "@/components/ui/use-toast";
import { errMsg } from "@/utils";
import {
  emitOracleStaleToast,
  isOracleStaleError,
  useMarkets,
  usePositions,
  useLendingAction,
  type LendingActionInput,
  type LendingActionKind,
} from "@/lib/telarana/hooks";
import type { TelaranaMarketSerialized, TelaranaPositionSerialized } from "@/lib/telarana/client";
import { formatHealthFactor, healthBucket, healthFactorFromE18, toAtomic } from "@/lib/telarana/health";

import { Hint } from "./hint";
import { TokenIcon } from "./token-icon";
import { useMarketCandles } from "@/lib/perps/hooks";

export interface LoanToken {
  sym: string;
  name: string;
  flag: string;
  price: number;
  decimals: number;
  mock: boolean;
}

export interface LoanHub {
  id: string;
  /** Long-form name shown in tooltips ("Arc Hub", "Fuji Hub"). */
  name: string;
  /** Short display label for filter pills and breadcrumbs ("Arc",
   *  "Fuji"). NOT the address — that lives on `address`. */
  short: string;
  /** Brand colour for the per-hub badge / accent. */
  color: string;
  /** Legacy text glyph fallback rendered only when no `iconUrl` resolves. */
  glyph: string;
  /** Real chain logo (svg / png). Pulled from constants/Chains. */
  iconUrl: string;
  /** On-chain FxMarketRegistry address for the hub. Surfaced (shortened)
   *  next to per-market rows so the user sees the contract they're
   *  interacting with. */
  address: `0x${string}`;
  /** EVM chainId — used to build block-explorer hyperlinks. */
  chainId: 43113 | 5042002;
}

export type LoanMarketStatus = "live" | "paused" | "stale";

export interface LoanMarket {
  id: string;
  hub: string;
  loan: string;
  coll: string;
  /**
   * Dynamic on-chain numbers. NULL when the /fx-telarana/markets feed
   * hasn't responded yet (api startup, hub RPC timeout, etc.). Never
   * seed these to fake numbers — renderers must show "—" instead so
   * the UI cannot mislead about supply/borrow APYs, utilization, or
   * TVL during a transient outage. Derived live in toLoanMarket() from
   * MorphoBlue.market(id) → totalSupplyAssets / totalBorrowAssets.
   *
   * LLTV is a deploy-time constant (set in MarketParams when the market
   * is created and immutable after), so it's safe to surface from the
   * SDK manifest even if the runtime state read fails. We still type
   * it nullable for the case where the manifest entry is missing.
   */
  supply: number | null;
  borrow: number | null;
  util: number | null;
  lltv: number | null;
  tvl: number | null;
  status: LoanMarketStatus;
  trend: "up" | "down";
  /** Optional onchain metadata — present for live markets. */
  onchain?: {
    hubChainId: 43113 | 5042002;
    marketId: `0x${string}`;
    loanToken: Address;
    collateralToken: Address;
    loanDecimals: number;
    collateralDecimals: number;
  };
}

export type LoanPositionKind = "supply" | "borrow";

export interface LoanAction {
  id: string;
  label: string;
  verb: string;
  side: LoanPositionKind;
  hint: string;
}

export const LOAN_TOKENS: Record<string, LoanToken> = {
  USDC: { sym: "USDC", name: "USD Coin", flag: "🇺🇸", price: 1.0, decimals: 2, mock: false },
  EURC: { sym: "EURC", name: "Euro Coin", flag: "🇪🇺", price: 1.084, decimals: 2, mock: false },
  // MXNB graduated from mock → real after fx-telarana#feat/mxnb-fuji-markets:
  //   Bitso ships the live issuer-controlled testnet contract; the M3/M4
  //   Morpho markets on the Fuji hub route through the canonical address
  //   0xAB99…85eBb. Keep the price field for client-side $-value previews
  //   until the live oracle is wired (Pyth USD/MXN ≈ 17, inverted → 0.0585).
  MXNB: { sym: "MXNB", name: "Mexican Peso", flag: "🇲🇽", price: 0.0585, decimals: 2, mock: false },
  // AUDF graduated from mock → real after fx-telarana#feat/mxnb-fuji-markets
  // (the AUDF mints + Arc M3/M4 deploy): Forte ships the live issuer-controlled
  // testnet contract on Eth Sepolia + Arc Testnet at the same canonical address
  // 0xd2a5…7456b. Markets live on Arc; price field is for $-value previews
  // until the live AUD/USD oracle is wired (Pyth ≈ 0.66).
  AUDF: { sym: "AUDF", name: "Australian Dollar", flag: "🇦🇺", price: 0.6648, decimals: 2, mock: false },
  mJPYC: { sym: "mJPYC", name: "Japanese Yen", flag: "🇯🇵", price: 0.00648, decimals: 0, mock: true },
  mKRW1: { sym: "mKRW1", name: "Korean Won", flag: "🇰🇷", price: 0.000726, decimals: 0, mock: true },
  mZCHF: { sym: "mZCHF", name: "Swiss Franc", flag: "🇨🇭", price: 1.135, decimals: 2, mock: true },
};

// FxMarketRegistry addresses per hub — surfaced in the UI in place of
// the human-readable hub.short label so users see the actual on-chain
// contract a borrow / lend touches. Sourced from the contracts package
// manifests: packages/contracts/deployments/telarana-{arc-testnet,
// avalanche-fuji}.json → contracts.FxMarketRegistry.
const HUB_REGISTRY_ADDRESS: Readonly<Record<string, `0x${string}`>> = {
  arc: "0x813232259c9b922e7571F15220617C80581f1464",
  fuji: "0x7ba745b979e027992ECFa51207666e3F5B46cF0a",
};

const shortHex = (addr: string): string =>
  addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

/**
 * Block-explorer address URL for the chains the loan tab touches.
 * Returns a per-chain explorer base — Snowtrace for Fuji, Arcscan for
 * Arc Testnet. Caller renders an `<a target="_blank">` so the page
 * opens in a new tab. Extend the switch when more spoke hubs go live.
 */
export const blockExplorerUrl = (
  chainId: number,
  address: `0x${string}`,
): string => {
  switch (chainId) {
    case 43113:
      return `https://testnet.snowtrace.io/address/${address}`;
    case 5042002:
      return `https://testnet.arcscan.app/address/${address}`;
    case 11155111:
      return `https://sepolia.etherscan.io/address/${address}`;
    case 421614:
      return `https://sepolia.arbiscan.io/address/${address}`;
    default:
      return `https://etherscan.io/address/${address}`;
  }
};

export const LOAN_HUBS: Record<string, LoanHub> = {
  arc: {
    id: "arc",
    name: "Arc Hub",
    short: "Arc",
    color: "#1a1340",
    // Arc's official mark — lives under public/networks/. The HubPip
    // wrapper places it on a tinted background so it reads cleanly.
    iconUrl: "/networks/arc.svg",
    glyph: "◆",
    address: HUB_REGISTRY_ADDRESS.arc,
    chainId: 5042002,
  },
  fuji: {
    id: "fuji",
    name: "Fuji Hub",
    short: "Fuji",
    color: "#e84142",
    iconUrl: "/networks/avax.svg",
    glyph: "▲",
    address: HUB_REGISTRY_ADDRESS.fuji,
    chainId: 43113,
  },
};

export const hubRegistryAddress = (hubId: string): `0x${string}` | null =>
  HUB_REGISTRY_ADDRESS[hubId] ?? null;

// Metadata-only stub for every real market this app talks to. NO numbers.
// Every numeric field (supply, borrow, util, lltv, tvl) is null on
// purpose — the only acceptable source for those is the live
// /fx-telarana/markets feed populated by `toLoanMarket()` from on-chain
// MorphoBlue.market(id). When the api is down, renderers render "—".
//
// The list mirrors the deployment manifests under
// packages/contracts/deployments/telarana-*.json. Synthetic FX rows
// (mJPYC / mKRW1 / mZCHF / mAUDF) used to live here as table padding;
// they're gone now because (a) they had no on-chain backing, (b) their
// "supply / borrow" numbers were invented, and (c) we can't ever
// promise the user an APY we can't prove on-chain.
export const LOAN_MARKETS: LoanMarket[] = [
  // Arc Testnet — M1 + M2 (EURC/USDC), M3 + M4 (AUDF/USDC).
  // Deployed in fx-telarana#feat/mxnb-fuji-markets.
  { id: "arc-usdc-eurc", hub: "arc", loan: "USDC", coll: "EURC", supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
  { id: "arc-eurc-usdc", hub: "arc", loan: "EURC", coll: "USDC", supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
  { id: "arc-audf-usdc", hub: "arc", loan: "AUDF", coll: "USDC", supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
  { id: "arc-usdc-audf", hub: "arc", loan: "USDC", coll: "AUDF", supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
  // Avalanche Fuji — M1 + M2 (EURC/USDC), M3 + M4 (MXNB/USDC).
  // Deployed in fx-telarana#feat/mxnb-fuji-markets.
  { id: "fuji-usdc-eurc", hub: "fuji", loan: "USDC", coll: "EURC", supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
  { id: "fuji-mxnb-usdc", hub: "fuji", loan: "MXNB", coll: "USDC", supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
  { id: "fuji-usdc-mxnb", hub: "fuji", loan: "USDC", coll: "MXNB", supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
];

// Ordered as two pairs: [lend, withdraw] (supply side) and [borrow, repay]
// (debt side). The render below inserts a vertical divider between
// indices 1 and 2 so the two pairs read as related actions, not four
// equal-weight choices.
const ACTIONS: LoanAction[] = [
  { id: "lend", label: "Lend", verb: "lend", side: "supply", hint: "Deposit the loan asset to earn yield." },
  { id: "withdraw", label: "Withdraw", verb: "withdraw", side: "supply", hint: "Pull supplied funds back to your wallet." },
  { id: "borrow", label: "Borrow", verb: "borrow", side: "borrow", hint: "Lock collateral and take a loan in the loan asset." },
  { id: "repay", label: "Repay", verb: "repay", side: "borrow", hint: "Pay back some or all of your debt." },
];

const ACTION_TO_KIND: Record<string, LendingActionKind> = {
  lend: "supply",
  borrow: "borrow",
  withdraw: "withdraw",
  repay: "repay",
};

const HUB_CHAIN_IDS = { arc: 5042002 as const, fuji: 43113 as const };
export const HUB_NAME_BY_CHAIN_ID: Record<number, "arc" | "fuji"> = { 5042002: "arc", 43113: "fuji" };

const fmtCompact = (n: number) =>
  n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(0) + "k" : "$" + n.toFixed(0);

// Render a nullable numeric field. Null means "live api hasn't reported
// yet" — never invent a number, just show the em-dash. Every loan-tab
// surface that touches supply / borrow / util / lltv / tvl goes through
// this so a fake APY can't slip back in via copy-paste.
const fmtOrDash = (n: number | null | undefined, fmt: (x: number) => string): string =>
  n == null || !Number.isFinite(n) ? "—" : fmt(n);

export function symbolForToken(address: Address): string {
  // All addresses lower-cased. Sources: Circle canonical testnet docs
  // (developers.circle.com/stablecoins) for USDC + EURC, Bitso for MXNB.
  // Both MockEURC AND Circle's real testnet EURC on Fuji are mapped to
  // "EURC" — the on-chain Morpho M1/M2 markets currently use the mock,
  // while user wallets hold Circle's real one.
  const known: Record<string, string> = {
    // Avalanche Fuji
    "0x5425890298aed601595a70ab815c96711a31bc65": "USDC",
    "0xefd7cf5ad5a2db9a3c23e2807f2279de92c730d2": "EURC", // FxReceiptEURC
    "0x50c4ba39caa7f56152d0df4914e1f6b907194992": "EURC", // MockEURC (M1/M2)
    "0x5e44db7996c682e92a960b65ac713a54ad815c6b": "EURC", // Circle real EURC
    "0xab99d44185af87aeb08361588f00f59b0ce85ebb": "MXNB", // Bitso testnet
    // Arc Testnet
    "0x3600000000000000000000000000000000000000": "USDC",
    "0x89b50855aa3be2f677cd6303cec089b5f319d72a": "EURC",
    "0xd2a530170d71a9cfe1651fb468e2b98f7ed7456b": "AUDF", // Forte canonical (same address on Eth Sepolia)
    // Ethereum Sepolia
    "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238": "USDC", // Circle canonical
    "0x5fd84259d66cd46123540766be93dfe6d43130d7": "USDC", // (legacy: actually OP Sepolia — kept for backward-compat)
    "0x08210f9170f89ab7658f0b5e3ff39b0e03c594d4": "EURC",
    "0x34d4cebb03af55b99b68342ac4bd78e598d9a9fc": "MXNB",
    // Arbitrum Sepolia
    "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d": "USDC", // Circle canonical
    "0xb56e3e3769efb85214cb4fa42eba198e9fda92bf": "MXNB",
  };
  return known[address.toLowerCase()] ?? "TOK";
}

function decimalsForSymbol(sym: string): number {
  // USDC, EURC, MXNB, and AUDF are all 6-dp on the live testnet deployments
  // (Bitso ships MXNB at 6-dp, Forte ships AUDF at 6-dp; both match the
  // Fuji/Arc USDC representation). The synthetic mJPYC / mKRW1 / mZCHF
  // tokens shown in the static LOAN_MARKETS aren't backed by real onchain
  // markets — they keep the table populated for demo purposes.
  if (sym === "USDC" || sym === "EURC" || sym === "MXNB" || sym === "AUDF") return 6;
  return 6;
}

function bpsFromWad(value: bigint | string): number {
  const big = typeof value === "bigint" ? value : BigInt(value);
  return Number(big / 10n ** 14n);
}

/**
 * Liftover: turn a serialized fx-telarana market into the LoanMarket row
 * shape the existing UI knows how to render.
 *
 * APY/APR derivation. The Fuji + Arc deployments wire `IrmMock`
 * (Morpho's reference IRM mock) at the manifest's `IrmMock` address.
 * Its formula is, verbatim:
 *
 *   borrowRateView(_, Market m) = totalBorrow.wDivDown(totalSupply) / SECONDS_PER_YEAR
 *
 * So `borrowRate (per second, WAD) × SECONDS_PER_YEAR / 1e18` simplifies
 * to `utilization` (fraction). i.e. **APR = utilization** on the mock IRM.
 * Supply APY ≈ borrowAPR × utilization × (1 − fee); the Morpho `fee`
 * field defaults to 0, so `supplyAPY ≈ util²` on these markets.
 *
 * When the protocol swaps in a non-mock IRM, this needs to become a
 * proper `viem.readContract({ functionName: "borrowRateView" })` per
 * market — exposed via the SDK so the API can include it in the
 * /fx-telarana/markets response.
 */
function toLoanMarket(market: TelaranaMarketSerialized): LoanMarket {
  const loanSym = symbolForToken(market.loanToken);
  const collSym = symbolForToken(market.collateralToken);
  const hub = HUB_NAME_BY_CHAIN_ID[market.hubChainId];
  // Distinguish "market.state was provided as zero" (real on-chain
  // zero — show 0% / $0) from "the SDK couldn't fetch state at all"
  // (return nulls so the row renders "—"). The former is honest
  // empty-market data, the latter is a feed gap and rendering 0%
  // would mislead the user the same way the old 4.42 seed did.
  const hasState = Boolean(market.state);
  const supplyAssets = hasState ? BigInt(market.state!.totalSupplyAssets) : 0n;
  const borrowAssets = hasState ? BigInt(market.state!.totalBorrowAssets) : 0n;
  const util = hasState
    ? supplyAssets > 0n
      ? Number((borrowAssets * 10_000n) / supplyAssets) / 10_000
      : 0
    : null;
  // 6-dp atomic → USD float. We assume both stables sit at 6 decimals
  // on every deployed market (USDC, EURC, MXNB, AUDF are all 6-dp on
  // testnets per their issuer docs); revisit when a 18-dp loan asset
  // lands.
  const tvl = hasState ? Number((supplyAssets - borrowAssets) / 10n ** 4n) / 100 : null;
  // LLTV is an immutable MarketParams field — the SDK fills it even when
  // the runtime state read fails, so it's safe to surface unconditionally.
  const lltv = market.lltv ? Number(BigInt(market.lltv) / 10n ** 14n) / 10_000 : null;
  // IrmMock: borrowAPR ≡ utilization (fraction). Convert to percentage
  // for the UI. Supply ≈ borrow × util (Morpho fee defaults to 0). When
  // the protocol swaps in the adaptive IRM, replace these two lines
  // with a real `borrowRateView(...)` call surfaced via the SDK.
  const borrow = util != null ? util * 100 : null;
  const supply = util != null ? util * util * 100 : null;
  return {
    id: `${hub}-${loanSym.toLowerCase()}-${collSym.toLowerCase()}`,
    hub,
    loan: loanSym,
    coll: collSym,
    supply,
    borrow,
    util,
    lltv,
    tvl,
    status: market.isLive ? "live" : "paused",
    trend: "up",
    onchain: {
      hubChainId: market.hubChainId,
      marketId: market.id,
      loanToken: market.loanToken,
      collateralToken: market.collateralToken,
      loanDecimals: decimalsForSymbol(loanSym),
      collateralDecimals: decimalsForSymbol(collSym),
    },
  };
}

void bpsFromWad; // reserved for future APY surfacing

export function FxChip({ sym, size = 28 }: { sym: string; size?: number }) {
  // Real token artwork via STABLE_TOKEN_LIST (with synthetic m-prefix
  // remapping inside TokenIcon). Falls back to a coloured monogram
  // when the symbol isn't recognised.
  const meta = LOAN_TOKENS[sym];
  return <TokenIcon sym={sym} size={size} title={meta?.name ?? sym} />;
}

export function HubPip({ hub, size = 18 }: { hub: LoanHub; size?: number }) {
  // Render the chain's official mark on a neutral light background.
  //
  // Why not hub.color: the canonical chain SVGs (avax, eth, arbitrum,
  // arc) ship with their brand fill already applied — avax.svg is red,
  // arc.svg is dark, etc. Putting them on a wrapper that uses the same
  // hub.color makes the icon disappear (red on red). The neutral
  // surface lets each brand-coloured logo read on its own.
  //
  // Falls back to the text glyph if the image fails to load.
  return (
    <span
      className="hub-pip"
      style={{
        // Subtle ring tinted to the brand colour, neutral fill so the
        // coloured SVG paths read on top.
        background: "var(--surface)",
        boxShadow: `inset 0 0 0 1.5px ${hub.color}40`,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.55),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
      }}
      title={hub.name}
    >
      {hub.iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={hub.iconUrl}
          alt={hub.name}
          width={size}
          height={size}
          style={{
            // 65% inner → ~17.5% padding on each side. Logos with
            // their own circular background (Avalanche red disc, Eth
            // diamond) still look anchored, and the bare-glyph SVGs
            // (Arc letter) get breathing room from the ring.
            width: "65%",
            height: "65%",
            objectFit: "contain",
            display: "block",
          }}
          onError={(e) => {
            // Hide the broken image so the text glyph shows through.
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <span style={{ color: hub.color, lineHeight: 1, fontWeight: 800 }}>
          {hub.glyph}
        </span>
      )}
    </span>
  );
}

export function StatusTag({ status }: { status: LoanMarketStatus }) {
  if (status === "live") return <span className="lo-st lo-st-live">Live</span>;
  if (status === "paused") return <span className="lo-st lo-st-paused">Paused</span>;
  if (status === "stale") return <span className="lo-st lo-st-stale">Stale</span>;
  return null;
}

/**
 * Map a loan-market loan/collateral pair to the Pyth Benchmarks FX
 * symbol that feeds it. Returns null for markets where the two legs are
 * both USD-pegged (no meaningful price line) or where no upstream feed
 * exists (synthetic m-prefixed placeholders that haven't been wired to
 * an issuer contract yet).
 */
function loanMarketPythSymbol(market: LoanMarket): string | null {
  const a = market.loan.toUpperCase();
  const b = market.coll.toUpperCase();
  // Both legs are USD-anchored → no price movement to chart.
  const isUsdPeg = (sym: string) =>
    sym === "USDC" || sym === "USDT" || sym === "DAI" || sym === "USD";
  if (isUsdPeg(a) && isUsdPeg(b)) return null;
  const nonUsd = isUsdPeg(a) ? b : a;
  switch (nonUsd) {
    case "EURC":
    case "EUR":
      return "EUR/USD";
    case "MXNB":
    case "MMXNB":
    case "MXN":
      return "USD/MXN";
    case "MJPYC":
    case "JPYC":
    case "JPY":
      return "USD/JPY";
    case "MAUDF":
    case "AUDF":
    case "AUD":
      return "AUD/USD";
    case "MKRW1":
    case "KRW1":
    case "KRW":
      return "USD/KRW";
    case "MZCHF":
    case "ZCHF":
    case "CHF":
      return "USD/CHF";
    case "BRLA":
    case "BRL":
      return "USD/BRL";
    default:
      return null;
  }
}

/**
 * Inline SVG sparkline driven by Pyth Benchmarks candles (the same
 * source the main chart consumes). 24×1h candles per market — cached
 * 60s by react-query, so a table with 8 rows hits Benchmarks once per
 * symbol per minute. Falls back to an em-dash when the loan pair has
 * no associated FX feed (synthetic markets, USD/USD pairs).
 *
 * lightweight-charts is intentionally NOT mounted per row — that
 * library is ~120 KB and mounting it 8× costs more than the data fetch.
 * A flat SVG <path> built from close prices reads the same way for a
 * 24-point timeline and keeps the table snappy.
 */
export function MarketSpark({ market }: { market: LoanMarket }) {
  const feed = loanMarketPythSymbol(market);
  const { data: resp, isLoading } = useMarketCandles({
    sym: feed ?? undefined,
    tf: "1H",
    limit: 24,
  });

  if (!feed) {
    return (
      <span
        className="lo-spark"
        title="No FX feed for this market"
        style={{
          display: "inline-block",
          width: "100%",
          textAlign: "center",
          color: "var(--ink-4)",
          fontWeight: 700,
          fontSize: 11,
        }}
      >
        —
      </span>
    );
  }

  const candles = resp?.candles ?? [];
  if (isLoading || candles.length < 2) {
    return (
      <span
        className="lo-spark"
        style={{
          display: "block",
          width: "100%",
          height: 28,
          background: "var(--surface-3)",
          borderRadius: 4,
          opacity: 0.4,
        }}
      />
    );
  }

  const closes = candles.map((c) => c.c);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const first = closes[0];
  const last = closes[closes.length - 1];
  const up = last >= first;
  const stroke = up ? "var(--profit-ink)" : "var(--loss-ink)";
  const gradId = `sg-${market.id}`;

  const W = 120;
  const H = 28;
  const pad = 2;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;
  const pts = closes.map((c, i) => {
    const x = pad + (i / (closes.length - 1)) * innerW;
    const y = pad + innerH - ((c - min) / range) * innerH;
    return [x, y] as const;
  });
  const linePath = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const fillPath = `${linePath} L${pts[pts.length - 1][0].toFixed(2)},${H} L${pts[0][0].toFixed(2)},${H} Z`;
  const changePct = ((last - first) / first) * 100;

  return (
    <svg
      className="lo-spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: "block", width: "100%", height: H }}
      role="img"
      aria-label={`${feed} 24h sparkline (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={pts[pts.length - 1][0]}
        cy={pts[pts.length - 1][1]}
        r="1.8"
        fill="var(--surface)"
        stroke={stroke}
        strokeWidth="1.4"
        vectorEffect="non-scaling-stroke"
      />
      <title>{`${feed} · 24h ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}</title>
    </svg>
  );
}

function MarketsTable({
  market,
  markets,
  onSelect,
}: {
  market: LoanMarket;
  markets: LoanMarket[];
  onSelect: (id: string) => void;
}) {
  const [hubFilter, setHubFilter] = useState("all");
  const visible = markets.filter((m) => hubFilter === "all" || m.hub === hubFilter);
  // Each row reads the user's wallet balance for the row's loan token on
  // the row's hub chain. This turns the table into a chain + token +
  // balance selector inline on the left of ActionCard — no popover.
  const { address: walletAddress } = useAccount();

  return (
    <div className="lo-table-wrap">
      <div className="lo-table-head">
        <span className="lo-eyebrow">Markets</span>
        <div className="lo-hub-filter">
          {["all", "arc", "fuji"].map((h) => (
            <button
              key={h}
              className={"lo-hub-btn " + (hubFilter === h ? "active" : "")}
              onClick={() => setHubFilter(h)}
            >
              {h === "all" ? "All" : LOAN_HUBS[h].short}
              <span className="lo-hub-btn-count">
                {h === "all" ? markets.length : markets.filter((m) => m.hub === h).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="lo-table">
        <div className="lo-table-thead">
          <span>Market</span>
          <span style={{ textAlign: "right" }}>Supply</span>
          <span style={{ textAlign: "right" }}>Borrow</span>
          <span style={{ textAlign: "right" }}>Util</span>
          <span style={{ textAlign: "right" }}>TVL</span>
          <span style={{ textAlign: "right" }}>30d</span>
        </div>
        {visible.map((m) => {
          const sel = m.id === market.id;
          const hub = LOAN_HUBS[m.hub];
          const disabled = m.status !== "live";
          return (
            <button
              key={m.id}
              className={"lo-trow " + (sel ? "sel " : "") + (disabled ? "dim " : "")}
              onClick={() => onSelect(m.id)}
            >
              <div className="lo-trow-pair">
                <span className="lo-trow-flags">
                  <FxChip sym={m.loan} size={26} />
                  <FxChip sym={m.coll} size={26} />
                </span>
                <div className="lo-trow-meta">
                  <div className="lo-trow-syms">
                    <span className="mkt-loan">{m.loan}</span>
                    <span className="mkt-slash">/</span>
                    <span className="mkt-coll">{m.coll}</span>
                    {m.status !== "live" && <StatusTag status={m.status} />}
                  </div>
                  <div className="lo-trow-hub">
                    <HubPip hub={hub} size={18} />
                    <span style={{ fontWeight: 700 }}>{hub.short}</span>
                    <span className="lo-trow-divider" aria-hidden="true">·</span>
                    <a
                      className="mono lo-trow-addr"
                      href={blockExplorerUrl(hub.chainId, hub.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`FxMarketRegistry — open on ${
                        hub.chainId === 5042002 ? "Arcscan" : "Snowtrace"
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {shortHex(hub.address)}
                    </a>
                    <span className="lo-trow-lltv">
                      · {fmtOrDash(m.lltv, (x) => `${Math.round(x * 100)}%`)} LLTV
                    </span>
                  </div>
                  <div className="lo-trow-balrow">
                    <span className="lo-trow-bal-l">Balance</span>
                    <MarketRowBalance
                      market={m}
                      walletAddress={walletAddress as Address | undefined}
                    />
                  </div>
                </div>
              </div>
              <span className="mono profit lo-trow-num">
                {fmtOrDash(m.supply, (x) => `${x.toFixed(2)}%`)}
              </span>
              <span className="mono loss lo-trow-num">
                {fmtOrDash(m.borrow, (x) => `${x.toFixed(2)}%`)}
              </span>
              <span className="mono lo-trow-num">
                {fmtOrDash(m.util, (x) => `${Math.round(x * 100)}%`)}
              </span>
              <span className="mono lo-trow-num">{fmtOrDash(m.tvl, fmtCompact)}</span>
              <span className="lo-trow-spark">
                <MarketSpark market={m} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function findInverse(market: LoanMarket, markets: LoanMarket[]): LoanMarket | undefined {
  return markets.find((m) => m.hub === market.hub && m.loan === market.coll && m.coll === market.loan);
}

// ─────────────────────────────────────────────────────────────
// Inline wallet-balance row for the MarketsTable on the left of
// ActionCard. Each market row gets its own balance subscription so
// users see "I have 10M AUDF on Arc" without a popup. The legacy
// popover (LendCandidateRow / ConfirmRowButton / ConfirmActionPopover)
// has been removed — the table IS the chain + token + balance
// selector now, the ActionCard fires intents inline.
// ─────────────────────────────────────────────────────────────

function MarketRowBalance({
  market,
  walletAddress,
}: {
  market: LoanMarket;
  walletAddress: Address | undefined;
}) {
  const onchain = market.onchain;
  const enabled = Boolean(walletAddress && onchain?.loanToken && onchain?.hubChainId);
  const bal = useBalance({
    address: walletAddress,
    token: onchain?.loanToken as `0x${string}` | undefined,
    chainId: onchain?.hubChainId,
    query: { enabled },
  });
  if (!walletAddress) {
    return (
      <span className="lo-trow-bal lo-trow-bal-muted mono" aria-label="connect a wallet">
        —
      </span>
    );
  }
  if (!onchain) {
    return <span className="lo-trow-bal lo-trow-bal-muted mono">demo</span>;
  }
  if (bal.isLoading || !bal.data) {
    return <span className="lo-trow-bal lo-trow-bal-muted mono">…</span>;
  }
  const decimals = bal.data.decimals ?? onchain.loanDecimals;
  const human = Number(formatUnits(bal.data.value, decimals));
  if (!Number.isFinite(human) || human === 0) {
    return <span className="lo-trow-bal lo-trow-bal-muted mono">0 {market.loan}</span>;
  }
  return (
    <span className="lo-trow-bal mono" title={`${human} ${market.loan}`}>
      {human.toLocaleString(undefined, { maximumFractionDigits: 2 })} {market.loan}
    </span>
  );
}


interface ActionCardProps {
  market: LoanMarket;
  action: string;
  setAction: (id: string) => void;
  amount: string;
  setAmount: (val: string) => void;
  onFlipMarket?: (id: string) => void;
  /** Optional override for the balance shown above the input. */
  balance?: number;
  /** Legacy submit-by-currently-selected-market path. The Confirm popover
   *  uses `onConfirm` below; `onSubmit` is kept for callers that don't
   *  thread the full markets/positions feed through. */
  onSubmit?: (input: { kind: LendingActionKind; amount: bigint }) => Promise<void> | void;
  /**
   * Confirm Action popover submission. Called with the row the user
   * picked (which may be different from the table-selected market) plus
   * the typed amount converted to atomic loan-decimals. Parent fires the
   * EIP-712 intent through useLendingAction.
   */
  onConfirm?: (
    market: LoanMarket,
    kind: LendingActionKind,
    atomicAmount: bigint,
  ) => Promise<void>;
  submitting?: boolean;
  /**
   * Replaces the CTA verb when set (e.g. "Oracle stale — retry…" during the
   * 5s cooldown the parent imposes after an ORACLE_STALE error).
   */
  submitLabelOverride?: string;
  /** Optional live debt for the impact panel. */
  liveDebt?: number;
  /** Optional alternative markets list for the flip-pair lookup. */
  marketsList?: LoanMarket[];
}

export function ActionCard({
  market,
  action,
  setAction,
  amount,
  setAmount,
  onFlipMarket,
  balance: balanceOverride,
  onSubmit,
  onConfirm,
  submitting = false,
  submitLabelOverride,
  liveDebt,
  marketsList,
}: ActionCardProps) {
  const loan = LOAN_TOKENS[market.loan] ?? LOAN_TOKENS.USDC;
  const A = ACTIONS.find((a) => a.id === action) || ACTIONS[0];
  // rate is nullable until the /fx-telarana/markets feed lands. The
  // earnings projection treats null as 0 for math purposes (no fake
  // yearly/monthly/daily) but the header pill renders "—" instead of a
  // fabricated APR/APY.
  const rate: number | null = A.side === "supply" ? market.supply : market.borrow;
  const rateLabel = A.side === "supply" ? "APY" : "APR";
  const rateForMath = rate ?? 0;

  // Wallet balance for the loan token on the hub chain. The card lists
  // this as "BALANCE" above the amount input — for lend/borrow it's the
  // wallet amount available; for withdraw/repay the parent must pass
  // `balanceOverride` with the user's supplied / debt position (read
  // from telarana, not the wallet). Without that override AND without a
  // connected wallet we show 0 — never the legacy 12,840.21 placeholder.
  const { address: walletAddress } = useAccount();
  const onchain = market.onchain;
  const walletBalance = useBalance({
    address: walletAddress,
    token: onchain?.loanToken as `0x${string}` | undefined,
    chainId: onchain?.hubChainId,
    query: {
      enabled: Boolean(
        walletAddress && onchain?.loanToken && onchain?.hubChainId,
      ),
    },
  });
  const walletBalanceFloat = walletBalance.data
    ? Number(formatUnits(walletBalance.data.value, walletBalance.data.decimals ?? 6))
    : 0;
  const balance = balanceOverride ?? walletBalanceFloat;
  const amt = parseFloat(amount) || 0;
  const usd = amt * loan.price;
  const inverse = findInverse(market, marketsList ?? LOAN_MARKETS);

  const yearly = (usd * rateForMath) / 100;
  const monthly = yearly / 12;
  const daily = yearly / 365;

  let impactTitle: string;
  let impactBig: string;
  let impactBigClass: string;
  let impactMini1: [string, string];
  let impactMini2: [string, string];
  if (action === "lend") {
    impactTitle = "You will earn";
    impactBig = "+$" + yearly.toFixed(2);
    impactBigClass = "profit";
    impactMini1 = ["per month", "+$" + monthly.toFixed(2)];
    impactMini2 = ["per day", "+$" + daily.toFixed(2)];
  } else if (action === "borrow") {
    impactTitle = "You will pay";
    impactBig = "−$" + yearly.toFixed(2);
    impactBigClass = "loss";
    impactMini1 = ["per month", "−$" + monthly.toFixed(2)];
    impactMini2 = ["per day", "−$" + daily.toFixed(2)];
  } else if (action === "withdraw") {
    impactTitle = "You will receive";
    impactBig = "$" + usd.toFixed(2);
    impactBigClass = "ink";
    impactMini1 = ["in " + loan.sym, amt.toLocaleString(undefined, { maximumFractionDigits: 2 })];
    impactMini2 = ["stops earning", "−$" + monthly.toFixed(2) + "/mo"];
  } else {
    // repay action — debt comes from telarana position read. No
    // fallback: when the parent doesn't know the user's debt yet (no
    // wallet connected, or position hasn't loaded), show the input as
    // "—" rather than fake numbers.
    const debt = liveDebt;
    impactTitle = "You will free";
    impactBig = "$" + usd.toFixed(2);
    impactBigClass = "ink";
    impactMini1 = [
      "debt left",
      debt != null ? `−$${Math.max(0, debt - usd).toFixed(2)}` : "—",
    ];
    impactMini2 = ["interest saved", "−$" + monthly.toFixed(2) + "/mo"];
  }

  // Legacy implicit-submit path. The Confirm popover is the primary CTA
  // surface now; onSubmit is only used if a caller doesn't pass
  // popoverMarkets (e.g. a unit test or future embed). Touch the prop
  // refs so the linter doesn't yell when the popover path is the one
  // that fires.
  void onSubmit;

  return (
    <section className="lo-action">
      <div className="lo-action-head">
        <span className="lo-eyebrow">Action</span>
        <span
          className="lo-rate mono"
          style={{ color: A.side === "supply" ? "var(--profit-ink)" : "var(--loss-ink)" }}
        >
          {fmtOrDash(rate, (x) => `${x.toFixed(2)}%`)} {rateLabel}
        </span>
      </div>

      <div className="lo-tabs">
        {ACTIONS.map((a, i) => (
          <Fragment key={a.id}>
            <button
              className={"lo-tab tone-" + (i + 1) + (action === a.id ? " active" : "")}
              onClick={() => setAction(a.id)}
              title={a.hint}
            >
              <span>{a.label}</span>
            </button>
            {/* Vertical rule between the supply pair (lend / withdraw) and the
                debt pair (borrow / repay). Pure visual grouping — not focusable. */}
            {i === 1 && <span className="lo-tab-divider" aria-hidden="true" />}
          </Fragment>
        ))}
      </div>

      <div className="lo-amount-shell">
        <input
          className="lo-amount-input mono"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder="0.00"
          inputMode="decimal"
        />
        {inverse && (
          <button
            className="lo-flip"
            onClick={() => onFlipMarket && onFlipMarket(inverse.id)}
            title={`Flip to ${inverse.loan} / ${inverse.coll}`}
          >
            <span className="lo-flip-pair">
              <span className="mkt-loan">{market.loan}</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7 10h13M16 6l4 4-4 4M17 14H4M8 18l-4-4 4-4" />
              </svg>
              <span className="mkt-coll">{market.coll}</span>
            </span>
            <span className="lo-flip-l">Flip</span>
          </button>
        )}
      </div>

      <div className="lo-amount-foot">
        <span className="lo-balance">
          BALANCE <span className="mono">{balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} {loan.sym}</span>
          <span className="lo-balance-usd mono">≈ ${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </span>
        <div className="lo-amount-quick">
          <button onClick={() => setAmount((balance / 4).toString())}>25%</button>
          <button onClick={() => setAmount((balance / 2).toString())}>50%</button>
          <button onClick={() => setAmount((balance * 0.75).toString())}>75%</button>
          <button onClick={() => setAmount(balance.toString())}>MAX</button>
        </div>
      </div>

      <div className="lo-impact">
        <div className="lo-impact-head">
          <span className="lo-impact-title">{impactTitle}</span>
          <span className="lo-impact-period">per year</span>
        </div>
        <div className={"lo-impact-big mono " + impactBigClass}>{impactBig}</div>
        <div className="lo-impact-grid">
          <div className="lo-impact-mini">
            <span className="lo-impact-mini-l">{impactMini1[0]}</span>
            <span className={"mono lo-impact-mini-v " + impactBigClass}>{impactMini1[1]}</span>
          </div>
          <div className="lo-impact-mini">
            <span className="lo-impact-mini-l">{impactMini2[0]}</span>
            <span className={"mono lo-impact-mini-v " + impactBigClass}>{impactMini2[1]}</span>
          </div>
        </div>
      </div>

      {onConfirm && (
        <div className="lo-confirm-row">
          <button
            type="button"
            className="lo-confirm-cta"
            onClick={async () => {
              if (!walletAddress) return;
              if (!market.onchain) return;
              const amt = parseFloat(amount);
              if (!Number.isFinite(amt) || amt <= 0) return;
              let atomic: bigint;
              try {
                atomic = parseUnits(amount, market.onchain.loanDecimals);
              } catch {
                return;
              }
              const kind: LendingActionKind =
                action === "lend"
                  ? "supply"
                  : action === "withdraw"
                  ? "withdraw"
                  : action === "borrow"
                  ? "borrow"
                  : "repay";
              await onConfirm(market, kind, atomic);
            }}
            disabled={
              submitting ||
              !walletAddress ||
              !market.onchain ||
              !(parseFloat(amount) > 0)
            }
            title={
              !walletAddress
                ? "Connect a wallet"
                : !market.onchain
                ? "Pick a live market from the list on the left"
                : !(parseFloat(amount) > 0)
                ? "Enter an amount above"
                : submitLabelOverride ??
                  `Confirm ${
                    action === "lend"
                      ? "Lend"
                      : action === "withdraw"
                      ? "Withdraw"
                      : action === "borrow"
                      ? "Borrow"
                      : "Repay"
                  }`
            }
          >
            {submitting
              ? "Signing…"
              : submitLabelOverride ??
                `Confirm ${
                  action === "lend"
                    ? "Lend"
                    : action === "withdraw"
                    ? "Withdraw"
                    : action === "borrow"
                    ? "Borrow"
                    : "Repay"
                }`}
          </button>
        </div>
      )}
    </section>
  );
}

// The old `Positions` component rendered the LOAN_POSITIONS demo array
// (hardcoded 4,820.4 supply, 320,000 borrow, etc.) as if those were the
// user's real positions. Removed 2026-05-18 along with LOAN_POSITIONS
// — the real positions surface is PositionsOnlyTab in trade-island/
// index.tsx, which reads useTelaranaPositions() and joins against
// useTelaranaMarkets() for live state. No caller imports `Positions`.

// ────────────────────────────── live LoanTab ───────────────────────────────

function mergeMockAndLiveMarkets(live: LoanMarket[]): LoanMarket[] {
  if (live.length === 0) return LOAN_MARKETS;
  // Live live markets take priority; pad with the mocked rows so the table
  // still shows the long tail of FX pairs the protocol plans to support.
  const liveIds = new Set(live.map((m) => m.id));
  return [...live, ...LOAN_MARKETS.filter((m) => !liveIds.has(m.id))];
}

export function liveSupplyValueUsd(position: TelaranaPositionSerialized, loanDecimals = 6): number {
  const supplyAtomic = BigInt(position.supplyAssets);
  if (supplyAtomic === 0n) return 0;
  return Number(supplyAtomic / 10n ** BigInt(Math.max(loanDecimals - 2, 0))) / 100;
}

export function liveBorrowValueUsd(position: TelaranaPositionSerialized, loanDecimals = 6): number {
  const borrowAtomic = BigInt(position.borrowAssets);
  if (borrowAtomic === 0n) return 0;
  return Number(borrowAtomic / 10n ** BigInt(Math.max(loanDecimals - 2, 0))) / 100;
}

export function LoanTab() {
  const { address } = useAccount();
  const { toast } = useToast();
  const { markets: liveMarkets, error: marketsError } = useMarkets();
  const { positions, refresh: refreshPositions } = usePositions(address as Address | undefined);
  const { submit: submitAction, loading: actionSubmitting } = useLendingAction();

  const [selectedId, setSelectedId] = useState("arc-usdc-eurc");
  const [actionId, setActionId] = useState("lend");
  const [amount, setAmount] = useState("");

  // When the API reports ORACLE_STALE we lock the CTA for 5s so users
  // don't hammer the backend while Pyth/Redstone catches up. The hook
  // emits the toast itself; we add a cooldown for the button only.
  const [oracleStaleUntil, setOracleStaleUntil] = useState<number>(0);
  const [now, setNow] = useState<number>(() => Date.now());
  const cooldownTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (oracleStaleUntil <= now) return;
    const id = window.setTimeout(() => setNow(Date.now()), oracleStaleUntil - now);
    cooldownTimerRef.current = id;
    return () => {
      window.clearTimeout(id);
      cooldownTimerRef.current = null;
    };
  }, [oracleStaleUntil, now]);
  const oracleStaleActive = oracleStaleUntil > now;

  const enrichedMarkets = useMemo(() => mergeMockAndLiveMarkets(liveMarkets.map(toLoanMarket)), [liveMarkets]);

  const market = enrichedMarkets.find((m) => m.id === selectedId) ?? enrichedMarkets[0];

  // Default to the first live market once we have data so the action card
  // can talk to a real chain instead of the synthetic rows.
  useEffect(() => {
    if (!market?.onchain) {
      const firstLive = enrichedMarkets.find((m) => m.onchain);
      if (firstLive) setSelectedId(firstLive.id);
    }
  }, [enrichedMarkets, market]);

  // Hero stats (net worth / supplied / borrowed) were removed 2026-05-18
  // because the no-wallet fallback rendered LOAN_POSITIONS demo numbers
  // as if they were live. When the wallet's positions feed is wired the
  // right way, surface these inside the position list, not in a header
  // band that lies on first paint.

  const onchainPositionForMarket = market?.onchain
    ? positions.find(
        (p) =>
          p.marketId.toLowerCase() === market.onchain!.marketId.toLowerCase() &&
          p.hubChainId === market.onchain!.hubChainId,
      )
    : undefined;
  const liveDebt = onchainPositionForMarket ? liveBorrowValueUsd(onchainPositionForMarket) : undefined;
  const hf = onchainPositionForMarket
    ? healthFactorFromE18(onchainPositionForMarket.healthFactorE18)
    : null;

  // Legacy submit path — kept so callers that don't pass markets/positions
  // through to the popover (unit tests, embeds) still have a working CTA.
  // Operates against the table-selected market.
  const handleSubmit = async (input: { kind: LendingActionKind; amount: bigint }) => {
    if (!market?.onchain) {
      toast({ title: "Pick a live market", description: "This row is a placeholder.", variant: "destructive" });
      return;
    }
    await submitLendingIntent(market, input.kind, input.amount);
  };

  // Confirm Action popover path. The popover already showed the user only
  // the rows they can act on, so we know `pickedMarket.onchain` is set
  // and the atomic amount is bounded by their balance / position. Still
  // re-validate at the edge for safety.
  const submitLendingIntent = async (
    pickedMarket: LoanMarket,
    kind: LendingActionKind,
    atomicAmount: bigint,
  ) => {
    if (!address) {
      toast({ title: "Connect a wallet", description: "Connect to sign the lending intent.", variant: "destructive" });
      return;
    }
    if (!pickedMarket.onchain) {
      toast({ title: "Pick a live market", description: "This row is a placeholder.", variant: "destructive" });
      return;
    }
    if (atomicAmount <= 0n) {
      toast({ title: "Enter an amount", description: "Amount must be greater than zero.", variant: "destructive" });
      return;
    }
    try {
      const payload: LendingActionInput = {
        kind,
        hubChainId: pickedMarket.onchain.hubChainId,
        spokeChainId: pickedMarket.onchain.hubChainId,
        loanToken: pickedMarket.onchain.loanToken,
        collateralToken: pickedMarket.onchain.collateralToken,
        onBehalf: address as Address,
        receiver: address as Address,
        amount: atomicAmount,
      };
      const result = await submitAction(payload);
      toast({
        title: "Intent signed",
        description: `${kind} intent ${result.intent.id.slice(0, 8)}… queued for settlement.`,
      });
      setAmount("");
      // Sync the left-column selection so the user sees what they just
      // acted on highlighted, instead of whatever was selected before.
      setSelectedId(pickedMarket.id);
      refreshPositions();
    } catch (err) {
      if (isOracleStaleError(err)) {
        emitOracleStaleToast();
        setOracleStaleUntil(Date.now() + 5_000);
        setNow(Date.now());
        return;
      }
      toast({ title: "Signing failed", description: errMsg(err), variant: "destructive" });
    }
  };

  return (
    <div className="lo-shell">
      {(marketsError || hf !== null) && (
        <div className="lo-status-strip">
          {marketsError && (
            <span className="loss mono" style={{ fontSize: 11, fontWeight: 700 }}>
              markets feed: {marketsError}
            </span>
          )}
          {hf !== null && (
            <span className={"mono " + healthBucketClass(hf)} style={{ fontSize: 11, fontWeight: 700 }}>
              HF {formatHealthFactor(hf)}
            </span>
          )}
        </div>
      )}

      <div className="lo-strip">
        <div className="lo-strip-market">
          <MarketsTable market={market} markets={enrichedMarkets} onSelect={setSelectedId} />
        </div>
        <ActionCard
          market={market}
          action={actionId}
          setAction={setActionId}
          amount={amount}
          setAmount={setAmount}
          onFlipMarket={setSelectedId}
          marketsList={enrichedMarkets}
          onSubmit={handleSubmit}
          onConfirm={submitLendingIntent}
          submitting={actionSubmitting || oracleStaleActive}
          submitLabelOverride={oracleStaleActive ? "Oracle stale — retry…" : undefined}
          liveDebt={liveDebt}
        />
      </div>
    </div>
  );
}

function healthBucketClass(hf: number | null): string {
  const bucket = healthBucket(hf);
  if (bucket === "safe") return "profit";
  if (bucket === "liquidatable" || bucket === "danger") return "loss";
  return "ink";
}

// Reserve HUB_CHAIN_IDS for the future cross-chain UI; currently the live
// market metadata supplies the chain id directly.
void HUB_CHAIN_IDS;
