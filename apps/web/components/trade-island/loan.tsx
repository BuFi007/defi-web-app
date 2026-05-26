"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { useAccount, useBalance, useChainId, useSwitchChain } from "wagmi";
import { formatUnits, parseUnits } from "viem";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/components/ui/use-toast";
import { errMsg } from "@/utils";
import { useI18n } from "@/locales/client";
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
import { LoanMarketPicker } from "./loan-market-picker";
import { AnimatedNumber } from "@/components/animated-number";
import { useMarketCandles } from "@/lib/perps/hooks";
import {
  STABLE_TOKEN_LIST,
  type StableTokenType,
} from "@bufi/location/stable-tokens";
import { getDeployment } from "@bufi/location/deployments";
import {
  HUBS,
  hubByChainId,
  hubKeyByChainId,
  chainIdByHubKey,
  type HubChain,
  type HubKey,
} from "@bufi/location/hubs";

export interface LoanToken {
  sym: string;
  name: string;
  flag: string;
  price: number;
  decimals: number;
  mock: boolean;
}

// LoanHub = platform HubChain (from @bufi/location/hubs) + the lending
// app's per-hub FxMarketRegistry contract address. The base fields
// (name, short, color, glyph, iconUrl, chainId) are inherited so adding
// a third hub only requires touching @bufi/location/hubs.
export interface LoanHub extends HubChain {
  /** Legacy alias for HubChain.key, kept so existing call sites that
   *  read `hub.id` continue to work without a sweeping rename. */
  id: HubKey;
  /** On-chain FxMarketRegistry address for the hub. Surfaced (shortened)
   *  next to per-market rows so the user sees the contract they're
   *  interacting with. */
  address: `0x${string}`;
}

export type LoanMarketStatus = "live" | "paused" | "stale" | "pending";

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

// Projection of StableToken → LoanToken so loan-tab call sites that
// still expect the old `{ sym, name, flag, price, decimals, mock }`
// shape keep working. The metadata source of truth lives in
// packages/location/src/stable-tokens.ts — DO NOT add a price/flag
// override here. New stablecoins surface automatically once the
// StableTokenType union includes them.
export const LOAN_TOKENS: Record<string, LoanToken> = Object.fromEntries(
  STABLE_TOKEN_LIST.map((t) => [
    t.asset,
    {
      sym: t.asset,
      name: t.name,
      flag: t.flag,
      price: t.usdPrice,
      decimals: t.displayDecimals,
      mock: t.mock,
    } satisfies LoanToken,
  ]),
);

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

// Lending-specific overlay on top of the platform-level HUBS table
// (@bufi/location/hubs). We append the FxMarketRegistry contract address
// per hub — that's app metadata, not platform metadata, so it stays
// here. Every other field flows from the central HUBS source.
export const LOAN_HUBS: Record<HubKey, LoanHub> = {
  arc: {
    ...HUBS.arc,
    id: HUBS.arc.key,
    address: HUB_REGISTRY_ADDRESS.arc,
  },
  fuji: {
    ...HUBS.fuji,
    id: HUBS.fuji.key,
    address: HUB_REGISTRY_ADDRESS.fuji,
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
const LOAN_MARKETS: LoanMarket[] = [
  // Arc Testnet — sprint-1 broadcast 2026-05-21 (canonical MorphoBlue
  // 0x65f435eB…, AdaptiveCurveIrm 0xBD583cc9…, LLTV 86%). Market IDs
  // resolved by the API from `~/coding-dojo/fx-telarana/docs/INTEGRATION_HANDOFF.md`.
  // EURC pair predates sprint-1 and is kept; AUDF flipped to live now
  // that the issuer token is deployed at 0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b.
  { id: "arc-usdc-eurc",   hub: "arc", loan: "USDC", coll: "EURC",   supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
  { id: "arc-eurc-usdc",   hub: "arc", loan: "EURC", coll: "USDC",   supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
  { id: "arc-usdc-mxnb",   hub: "arc", loan: "USDC", coll: "MXNB",   supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
  { id: "arc-mxnb-usdc",   hub: "arc", loan: "MXNB", coll: "USDC",   supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
  { id: "arc-usdc-qcad",   hub: "arc", loan: "USDC", coll: "QCAD",   supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
  { id: "arc-qcad-usdc",   hub: "arc", loan: "QCAD", coll: "USDC",   supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
  { id: "arc-usdc-cirbtc", hub: "arc", loan: "USDC", coll: "cirBTC", supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
  { id: "arc-cirbtc-usdc", hub: "arc", loan: "cirBTC", coll: "USDC", supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
  { id: "arc-audf-usdc",   hub: "arc", loan: "AUDF", coll: "USDC",   supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
  { id: "arc-usdc-audf",   hub: "arc", loan: "USDC", coll: "AUDF",   supply: null, borrow: null, util: null, lltv: null, tvl: null, status: "live", trend: "up" },
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

// Re-exported here for back-compat — every NEW call site should import
// directly from @bufi/location/hubs (chainIdByHubKey + hubKeyByChainId).
// Both forms point at the same single source of truth.
export const HUB_NAME_BY_CHAIN_ID: Record<number, HubKey> = {
  [HUBS.arc.chainId]: HUBS.arc.key,
  [HUBS.fuji.chainId]: HUBS.fuji.key,
};

/**
 * Look up the ERC-20 deployment for a (hub, symbol) pair via
 * @bufi/location/deployments — the SAME central table the wallet popover
 * reads. Used as a fallback in ActionCard / MarketRowBalance when the
 * selected market's `market.onchain` field hasn't been hydrated by the
 * /fx-telarana/markets feed yet. Without it, the BALANCE row read 0
 * even when the user clearly held 10M AUDF on Arc. The single source
 * of truth keeps the balance row and the wallet popover in sync.
 */
export function loanTokenDeployment(
  hub: string,
  symbol: string,
): { chainId: number; address: Address; decimals: number } | null {
  if (hub !== "arc" && hub !== "fuji") return null;
  const chainId = chainIdByHubKey(hub);
  // StableTokenType keys are uppercase ("CIRBTC", "MXNB", etc.) but the
  // loan-tab table emits user-facing mixed-case ("cirBTC") for display.
  // Uppercase here so the lookup hits regardless of casing in the row.
  const dep = getDeployment(chainId, symbol.toUpperCase() as StableTokenType);
  if (!dep) return null;
  return { chainId, address: dep.address as Address, decimals: dep.decimals };
}

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
  // chainId -> hub key. Defaults to "arc" only if the registry hands us
  // a market on an unknown chain — same behavior as before, made
  // explicit via the central helper.
  const hub = hubKeyByChainId(market.hubChainId) ?? "arc";
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
  // lands. Show 0 (not null) for TVL on empty markets — "$0" is honest
  // and useful (tells user no capital is locked yet).
  const tvl = hasState ? Number((supplyAssets - borrowAssets) / 10n ** 4n) / 100 : null;
  // LLTV is an immutable MarketParams field — the SDK fills it even when
  // the runtime state read fails, so it's safe to surface unconditionally.
  const lltv = market.lltv ? Number(BigInt(market.lltv) / 10n ** 14n) / 10_000 : null;
  // IrmMock: borrowAPR ≡ utilization (fraction). Convert to percentage
  // for the UI. Supply ≈ borrow × util (Morpho fee defaults to 0). When
  // the protocol swaps in the adaptive IRM, replace these two lines
  // with a real `borrowRateView(...)` call surfaced via the SDK.
  //
  // Edge case: when the market state is fetched successfully but BOTH
  // totalSupply and totalBorrow are 0, the market is completely empty —
  // no one has deposited or borrowed. Showing "0.00%" is misleading
  // because it implies "this market pays nothing forever"; in reality
  // the rate will emerge once liquidity + borrowing appear. Show null
  // ("—") for empty markets so the UI reads as "rate not yet established"
  // rather than "rate = zero". Once any supply enters and a borrow opens,
  // real utilization drives real rates.
  const isEmpty = hasState && supplyAssets === 0n && borrowAssets === 0n;
  const borrow = util != null && !isEmpty ? util * 100 : null;
  const supply = util != null && !isEmpty ? util * util * 100 : null;
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
  if (status === "pending") return <span className="lo-st lo-st-pending">Pending</span>;
  return null;
}

/**
 * Map a loan-market loan/collateral pair to the Pyth Benchmarks FX
 * symbol that feeds it AND whether the resulting candle stream needs
 * to be inverted (1/price) to express the market's true direction.
 *
 * Pyth only publishes canonical pairs (e.g. EUR/USD, USD/MXN), so the
 * reverse direction (USDC/EURC, MXNB/USDC) is the multiplicative
 * inverse of the upstream feed. Returning `invert: true` tells the
 * caller to apply `1/c` to every close so the spark for USDC/EURC
 * actually mirrors EURC/USDC instead of duplicating it.
 *
 * Returns null for markets where the two legs are both USD-pegged
 * (no meaningful price line) or where no upstream feed exists
 * (synthetic m-prefixed placeholders not yet wired to an issuer).
 */
const USD_PEGS = new Set(["USDC", "USDT", "DAI", "USD"]);

function normalizeFxCode(sym: string): string {
  const s = sym.toUpperCase();
  if (USD_PEGS.has(s)) return "USD";
  switch (s) {
    case "EURC":
      return "EUR";
    case "MXNB":
    case "MMXNB":
      return "MXN";
    case "MJPYC":
    case "JPYC":
      return "JPY";
    case "MAUDF":
    case "AUDF":
      return "AUD";
    case "MKRW1":
    case "KRW1":
      return "KRW";
    case "MZCHF":
    case "ZCHF":
      return "CHF";
    case "BRLA":
      return "BRL";
    default:
      return s;
  }
}

function loanMarketPythSymbol(
  market: LoanMarket,
): { feed: string; invert: boolean } | null {
  const loan = normalizeFxCode(market.loan);
  const coll = normalizeFxCode(market.coll);
  // Both legs USD-anchored → flat line, skip charting.
  if (loan === "USD" && coll === "USD") return null;
  // The non-USD currency determines which Pyth pair to read; the
  // direction (invert?) is decided by which side of the market is the
  // loan token. A chart for `loan/coll` shows "1 loan-token in coll-
  // token", so:
  //   • feed base === loan → use as-is
  //   • feed base === coll (i.e. feed quote === loan) → invert
  const nonUsd = loan === "USD" ? coll : loan;
  const CANONICAL: Record<string, string> = {
    EUR: "EUR/USD",
    MXN: "USD/MXN",
    JPY: "USD/JPY",
    AUD: "AUD/USD",
    KRW: "USD/KRW",
    CHF: "USD/CHF",
    BRL: "USD/BRL",
  };
  const feed = CANONICAL[nonUsd];
  if (!feed) return null;
  const [feedBase] = feed.split("/");
  const invert = feedBase !== loan;
  return { feed, invert };
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
  const feedSpec = loanMarketPythSymbol(market);
  const { data: resp, isLoading } = useMarketCandles({
    sym: feedSpec?.feed,
    tf: "1H",
    limit: 24,
  });

  if (!feedSpec) {
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

  // Pyth ships a single canonical pair per FX feed (e.g. EUR/USD). For
  // markets where the loan token sits on the quote side of the canonical
  // pair (USDC/EURC, MXNB/USDC, etc.), the displayed price moves OPPOSITE
  // to the raw feed, so we invert each close before charting.
  const closes = candles.map((c) =>
    feedSpec.invert && c.c !== 0 ? 1 / c.c : c.c,
  );
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
      aria-label={`${market.loan}/${market.coll} 24h sparkline (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`}
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
      <title>{`${market.loan}/${market.coll} · 24h ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}</title>
    </svg>
  );
}

function MarketsTable({
  market,
  markets,
  onSelect,
  positions,
}: {
  market: LoanMarket;
  markets: LoanMarket[];
  onSelect: (id: string) => void;
  /** User's open telarana positions — used to surface lent/borrowed
   *  amounts inline in the hover-expanded row detail. Empty array =
   *  not connected or no positions yet. */
  positions: TelaranaPositionSerialized[];
}) {
  const t = useI18n();
  const [hubFilter, setHubFilter] = useState("all");
  const visible = markets.filter((m) => hubFilter === "all" || m.hub === hubFilter);
  // Each row reads the user's wallet balance for the row's loan token on
  // the row's hub chain. This turns the table into a chain + token +
  // balance selector inline on the left of ActionCard — no popover.
  const { address: walletAddress } = useAccount();

  return (
    <div className="lo-table-wrap">
      <div className="lo-table-head">
        <span className="lo-eyebrow">{t('Lending.markets')}</span>
        <div className="lo-hub-filter">
          {["all", "arc", "fuji"].map((h) => (
            <button
              key={h}
              className={"lo-hub-btn " + (hubFilter === h ? "active" : "")}
              onClick={() => setHubFilter(h)}
            >
              {h === "all" ? t('Lending.all') : LOAN_HUBS[h as HubKey].short}
              <span className="lo-hub-btn-count">
                {h === "all" ? markets.length : markets.filter((m) => m.hub === h).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="lo-table">
        <div className="lo-table-thead">
          <div className="lo-table-thead-row">
            <span>{t('Lending.market')}</span>
            <span style={{ textAlign: "right" }}>{t('Lending.supply')}</span>
            <span style={{ textAlign: "right" }}>{t('Lending.borrow')}</span>
            <span style={{ textAlign: "right" }}>{t('Lending.util')}</span>
            <span style={{ textAlign: "right" }}>{t('Lending.tvl')}</span>
          </div>
          <span className="lo-table-thead-spark" aria-hidden="true">
            30d
          </span>
        </div>
        {visible.map((m) => {
          const sel = m.id === market.id;
          const hub = LOAN_HUBS[m.hub as HubKey];
          const disabled = m.status !== "live";
          // Find the user's open position in THIS market (if any), so the
          // hover-expanded detail can surface their lent/borrowed value.
          const pos = m.onchain
            ? positions.find(
                (p) =>
                  p.marketId.toLowerCase() === m.onchain!.marketId.toLowerCase() &&
                  p.hubChainId === m.onchain!.hubChainId,
              )
            : undefined;
          const supplyUsd = pos ? liveSupplyValueUsd(pos) : 0;
          const borrowUsd = pos ? liveBorrowValueUsd(pos) : 0;
          return (
            <button
              key={m.id}
              className={"lo-trow " + (sel ? "sel " : "") + (disabled ? "dim " : "")}
              onClick={() => onSelect(m.id)}
            >
              <div className="lo-trow-content">
              <div className="lo-trow-row">
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
                </div>
              </div>
              <span className="mono profit lo-trow-num">
                {m.supply == null ? (
                  "—"
                ) : (
                  <AnimatedNumber
                    value={m.supply}
                    currency="%"
                    maximumFractionDigits={2}
                    minimumFractionDigits={2}
                  />
                )}
              </span>
              <span className="mono loss lo-trow-num">
                {m.borrow == null ? (
                  "—"
                ) : (
                  <AnimatedNumber
                    value={m.borrow}
                    currency="%"
                    maximumFractionDigits={2}
                    minimumFractionDigits={2}
                  />
                )}
              </span>
              <span className="mono lo-trow-num">
                {m.util == null ? (
                  "—"
                ) : (
                  <AnimatedNumber
                    value={m.util * 100}
                    currency="%"
                    maximumFractionDigits={0}
                  />
                )}
              </span>
              <span className="mono lo-trow-num">
                {m.tvl == null ? (
                  "—"
                ) : (
                  <AnimatedNumber
                    value={m.tvl}
                    currency="USD"
                    maximumFractionDigits={m.tvl >= 1000 ? 0 : 2}
                  />
                )}
              </span>
              </div>
              {/* Sub line — hub · LLTV on the left, wallet balance on
                  the right, plus the 30-day sparkline docked at the
                  bottom-right corner of the row. Lives outside
                  `.lo-trow-row`'s 5-col grid so it can use the FULL row
                  width and place the spark where the user expects it
                  (corner of the dynamic island), not as just another
                  table column. */}
              <div className="lo-trow-sub">
                <span className="lo-trow-sub-l">
                  <HubPip hub={hub} size={14} />
                  <span className="lo-trow-hub-l">{hub.short}</span>
                  <span className="lo-trow-sep" aria-hidden="true">·</span>
                  <span className="lo-trow-lltv">
                    {fmtOrDash(m.lltv, (x) => `${Math.round(x * 100)}%`)} LLTV
                  </span>
                  <span className="lo-trow-sep" aria-hidden="true">·</span>
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
                </span>
                <MarketRowBalance
                  market={m}
                  walletAddress={walletAddress as Address | undefined}
                />
              </div>
              </div>
              {/* Sparkline lives in its own grid cell at the far right,
                  spanning the FULL height of the main row + sub-line —
                  the dynamic island's tall right edge. */}
              <span className="lo-trow-spark-corner">
                <MarketSpark market={m} />
              </span>
              {/* Hover-expanded detail. Always rendered; CSS collapses
                  it to height: 0 when the row is idle and reveals it on
                  hover or when the row is the selected market. */}
              <div className="lo-trow-detail" aria-hidden={!sel}>
                <div className="lo-trow-detail-item">
                  <span className="lo-trow-detail-l">Your supply</span>
                  <span className="lo-trow-detail-v mono profit">
                    {supplyUsd > 0 ? (
                      <AnimatedNumber
                        value={supplyUsd}
                        currency="USD"
                        maximumFractionDigits={2}
                      />
                    ) : (
                      "—"
                    )}
                  </span>
                </div>
                <div className="lo-trow-detail-item">
                  <span className="lo-trow-detail-l">Your borrow</span>
                  <span className="lo-trow-detail-v mono loss">
                    {borrowUsd > 0 ? (
                      <AnimatedNumber
                        value={borrowUsd}
                        currency="USD"
                        maximumFractionDigits={2}
                      />
                    ) : (
                      "—"
                    )}
                  </span>
                </div>
                <div className="lo-trow-detail-item">
                  <span className="lo-trow-detail-l">Earn at this APY</span>
                  <span className="lo-trow-detail-v mono">
                    {m.supply != null && supplyUsd > 0 ? (
                      <>
                        +
                        <AnimatedNumber
                          value={(supplyUsd * m.supply) / 100}
                          maximumFractionDigits={2}
                        />
                        /yr
                      </>
                    ) : m.supply != null ? (
                      <>
                        <AnimatedNumber
                          value={m.supply}
                          currency="%"
                          maximumFractionDigits={2}
                        />{" "}
                        idle
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                </div>
              </div>
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
  // Same fallback ladder as ActionCard: prefer live registry, but fall
  // back to the SPOKE_CHAINS deployment manifest so the table row's
  // balance matches what the wallet popover surfaces for the same
  // (hub, symbol) pair. Without the fallback, every "demo"-labelled
  // market hid the user's actual wallet balance.
  const fallback = onchain ? null : loanTokenDeployment(market.hub, market.loan);
  const tokenAddress = (onchain?.loanToken ?? fallback?.address) as
    | `0x${string}`
    | undefined;
  const tokenChainId = (onchain?.hubChainId ?? fallback?.chainId) as
    | 43113
    | 5042002
    | undefined;
  const tokenDecimals = onchain?.loanDecimals ?? fallback?.decimals ?? 6;
  const enabled = Boolean(walletAddress && tokenAddress && tokenChainId);
  const bal = useBalance({
    address: walletAddress,
    token: tokenAddress,
    chainId: tokenChainId,
    query: { enabled },
  });
  if (!walletAddress) {
    return (
      <span className="lo-trow-bal lo-trow-bal-muted mono" aria-label="connect a wallet">
        —
      </span>
    );
  }
  if (!tokenAddress) {
    return <span className="lo-trow-bal lo-trow-bal-muted mono">demo</span>;
  }
  if (bal.isLoading || !bal.data) {
    return <span className="lo-trow-bal lo-trow-bal-muted mono">…</span>;
  }
  const decimals = bal.data.decimals ?? tokenDecimals;
  const human = Number(formatUnits(bal.data.value, decimals));
  if (!Number.isFinite(human) || human === 0) {
    return <span className="lo-trow-bal lo-trow-bal-muted mono">0 {market.loan}</span>;
  }
  // Compact notation (10M, 1.2B) once balances cross 10k — otherwise a
  // 7-figure AUDF mint balance dominates the row's Market column and
  // squeezes the hub label out of view. Title attribute still carries
  // the full-precision value for hover inspection.
  const isHuge = human >= 10_000;
  return (
    <span
      className="lo-trow-bal mono"
      title={`${human.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${market.loan}`}
    >
      <AnimatedNumber
        value={human}
        currency={null}
        notation={isHuge ? "compact" : "standard"}
        maximumFractionDigits={isHuge ? 2 : human >= 1 ? 2 : 4}
      />
      <span style={{ marginLeft: 4, color: "var(--ink-3)", fontWeight: 600 }}>
        {market.loan}
      </span>
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
  /**
   * User's on-chain position in the currently-selected market. Drives
   * the action-specific BALANCE/MAX:
   *   withdraw → supplyAssets (what you can pull back)
   *   repay    → borrowAssets (what you owe)
   *   borrow   → collateral × LLTV − borrowAssets (max additional debt)
   * lend stays on the wallet balance.
   */
  activePosition?: TelaranaPositionSerialized | null;
  /** Optional alternative markets list for the flip-pair lookup. */
  marketsList?: LoanMarket[];
  /** Markets used by the Confirm popover (full live + seed). */
  popoverMarkets?: LoanMarket[];
  /** User's telarana positions, surfaced in the popover for withdraw/repay/borrow. */
  popoverPositions?: TelaranaPositionSerialized[];
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
  popoverMarkets,
  popoverPositions,
  activePosition,
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
  //
  // Resolution: prefer market.onchain when the live registry has
  // hydrated this row; fall back to the SPOKE_CHAINS deployment
  // manifest (the wallet popover's source) so a "demo"-labelled row
  // still gives a real balance to the user. Without the fallback, the
  // BALANCE row showed 0 AUDF on Arc even when the user clearly held
  // 10M — wallet popover and ActionCard must agree on the same number.
  const { address: walletAddress } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { toast } = useToast();
  const onchain = market.onchain;
  const fallback = onchain ? null : loanTokenDeployment(market.hub, market.loan);
  const tokenAddress = (onchain?.loanToken ?? fallback?.address) as
    | `0x${string}`
    | undefined;
  const tokenChainId = (onchain?.hubChainId ?? fallback?.chainId) as
    | 43113
    | 5042002
    | undefined;
  const tokenDecimals = onchain?.loanDecimals ?? fallback?.decimals ?? 6;
  const targetHubName = onchain
    ? hubByChainId(onchain.hubChainId)?.name ?? market.hub.toUpperCase()
    : market.hub.toUpperCase();
  const needsNetworkSwitch = Boolean(
    walletAddress && onchain && walletChainId !== onchain.hubChainId,
  );
  const walletBalance = useBalance({
    address: walletAddress,
    token: tokenAddress,
    chainId: tokenChainId,
    query: {
      enabled: Boolean(walletAddress && tokenAddress && tokenChainId),
    },
  });
  const walletBalanceFloat = walletBalance.data
    ? Number(formatUnits(walletBalance.data.value, walletBalance.data.decimals ?? tokenDecimals))
    : 0;

  // Action-specific balance. Drives the BALANCE label + the 25/50/75/MAX
  // chip math + the input's implicit cap. Each action operates against
  // a different "source":
  //   lend     → wallet balance of loan token (deposit from your wallet)
  //   withdraw → user's supplied assets in this market (pull back what's deposited)
  //   repay    → user's outstanding debt in this market (close out the loan)
  //   borrow   → max additional borrowable = collateral × price × LLTV − existing debt
  // borrow is the hairy one: needs collateral price + LLTV math in WAD.
  // When activePosition is missing (no position yet), withdraw/repay
  // default to 0 (nothing to act on); borrow defaults to 0 (no
  // collateral yet); lend keeps wallet balance.
  const positionSupplyFloat = activePosition
    ? Number(formatUnits(BigInt(activePosition.supplyAssets), tokenDecimals))
    : 0;
  const positionDebtFloat = activePosition
    ? Number(formatUnits(BigInt(activePosition.borrowAssets), tokenDecimals))
    : 0;
  const positionCollateralFloat = activePosition
    ? Number(activePosition.collateral) /
      10 ** (onchain?.collateralDecimals ?? 6)
    : 0;
  // collateralPriceE36 is the collateral→loan rate scaled by 1e36;
  // divide once to get loan-token-per-collateral-token in float space.
  const collateralLoanRate = activePosition?.collateralPriceE36
    ? Number(activePosition.collateralPriceE36) / 1e36
    : 0;
  const collateralLoanValue = positionCollateralFloat * collateralLoanRate;
  // market.lltv is a fraction (0.86 = 86%); derived from WAD in
  // toLoanMarket() via `BigInt(lltv) / 10^14 / 10_000`. Treat null
  // as 0 so borrow MAX falls to 0 when LLTV is missing.
  const lltvFraction = market.lltv ?? 0;
  const maxBorrowable = Math.max(
    0,
    collateralLoanValue * lltvFraction - positionDebtFloat,
  );
  const actionBalance =
    action === "withdraw"
      ? positionSupplyFloat
      : action === "repay"
        ? positionDebtFloat
        : action === "borrow"
          ? maxBorrowable
          : walletBalanceFloat; // lend (and any unknown action)
  const balance = balanceOverride ?? actionBalance;
  // Label that explains where the BALANCE number comes from for each
  // action — "BALANCE" alone was misleading on withdraw/repay/borrow.
  const balanceLabel =
    action === "withdraw"
      ? "SUPPLIED"
      : action === "repay"
        ? "DEBT"
        : action === "borrow"
          ? "MAX BORROW"
          : "BALANCE";
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
    if (rate == null) {
      // Market is empty or rate not yet established — can't project
      impactBig = "—";
      impactBigClass = "ink";
      impactMini1 = ["rate", "not yet established"];
      impactMini2 = ["", "supply to bootstrap"];
    } else {
      impactBig = "+$" + yearly.toFixed(2);
      impactBigClass = "profit";
      impactMini1 = ["per month", "+$" + monthly.toFixed(2)];
      impactMini2 = ["per day", "+$" + daily.toFixed(2)];
    }
  } else if (action === "borrow") {
    impactTitle = "You will pay";
    if (rate == null) {
      impactBig = "—";
      impactBigClass = "ink";
      impactMini1 = ["rate", "not yet established"];
      impactMini2 = ["", "awaiting liquidity"];
    } else {
      impactBig = "−$" + yearly.toFixed(2);
      impactBigClass = "loss";
      impactMini1 = ["per month", "−$" + monthly.toFixed(2)];
      impactMini2 = ["per day", "−$" + daily.toFixed(2)];
    }
  } else if (action === "withdraw") {
    // Lead with the asset amount (what actually lands in the wallet),
    // demote the USDC dollar value to the small line. Previous order
    // ($0.66 big + "1 AUDF" small) read as "you'll receive 66 cents" —
    // confusing when the user's input was "1 AUDF".
    impactTitle = "You will receive";
    impactBig = `${amt.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${loan.sym}`;
    impactBigClass = "ink";
    impactMini1 = ["≈ USDC", "$" + usd.toFixed(2)];
    impactMini2 = ["stops earning", "−$" + monthly.toFixed(2) + "/mo"];
  } else {
    // repay action — debt comes from telarana position read. No
    // fallback: when the parent doesn't know the user's debt yet (no
    // wallet connected, or position hasn't loaded), show the input as
    // "—" rather than fake numbers.
    const debt = liveDebt;
    impactTitle = "You will free";
    impactBig = `${amt.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${loan.sym}`;
    impactBigClass = "ink";
    impactMini1 = [
      "debt left",
      debt != null ? `−$${Math.max(0, debt - usd).toFixed(2)}` : "—",
    ];
    impactMini2 = ["≈ USDC", "$" + usd.toFixed(2)];
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
        {/* Restored: market picker moved to the quick-pick rail (below)
            per UX feedback. The head keeps the slim eyebrow + APY pill. */}
        <span className="lo-eyebrow">Action</span>
        <span
          className="lo-rate mono"
          style={{ color: A.side === "supply" ? "var(--profit-ink)" : "var(--loss-ink)" }}
        >
          {rate == null ? (
            "—"
          ) : (
            <AnimatedNumber
              value={rate}
              currency="%"
              maximumFractionDigits={2}
              minimumFractionDigits={2}
            />
          )}{" "}
          {rateLabel}
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

      {/* Quick-pick rail sits ABOVE the input and OUTSIDE its border —
          right-aligned, with the percent chips followed by MAX as the
          primary call to action. Keeping MAX rightmost keeps the muscle-
          memory consistent with most DeFi inputs (Aave, Compound). */}
      <div className="lo-amount-quick">
        {/* Market picker sits at the start of the row; quick-pick chips
            cluster to the right. justify-content: space-between on
            .lo-amount-quick handles the layout — picker hugs the left
            edge of the input, MAX hugs the right. */}
        <LoanMarketPicker
          selected={market}
          markets={marketsList ?? popoverMarkets ?? [market]}
          onSelect={(m) => onFlipMarket?.(m.id)}
        />
        <div className="lo-amount-quick-chips">
          <button onClick={() => setAmount(formatAmountForInput(balance / 4, tokenDecimals))}>25%</button>
          <button onClick={() => setAmount(formatAmountForInput(balance / 2, tokenDecimals))}>50%</button>
          <button onClick={() => setAmount(formatAmountForInput(balance * 0.75, tokenDecimals))}>75%</button>
          <button
            type="button"
            className="lo-amount-max"
            onClick={() => setAmount(formatAmountForInput(balance, tokenDecimals))}
            aria-label={`Use full balance of ${balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${loan.sym}`}
          >
            MAX
          </button>
        </div>
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
          {balanceLabel} <span className="mono">{balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} {loan.sym}</span>
          {/* "≈ $X" reflects the action-specific balance — wallet for
              lend, supplied for withdraw, debt for repay, max-borrow
              for borrow — so the user always sees the dollar value of
              whatever the MAX chip would fill in. */}
          <span className="lo-balance-usd mono">≈ ${(balance * loan.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </span>
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

      {onConfirm && (() => {
        const actionVerb =
          action === "lend"
            ? "Lend"
            : action === "withdraw"
            ? "Withdraw"
            : action === "borrow"
            ? "Borrow"
            : "Repay";
        const ctaLabel = submitting
          ? "Signing…"
          : needsNetworkSwitch
          ? `Switch to ${targetHubName} & ${actionVerb}`
          : submitLabelOverride ?? `Confirm ${actionVerb}`;
        const ctaTitle = !walletAddress
          ? "Connect a wallet"
          : !market.onchain
          ? "Pick a live market from the list on the left"
          : !(parseFloat(amount) > 0)
          ? "Enter an amount above"
          : needsNetworkSwitch
          ? `Wallet is on the wrong network. Click to switch to ${targetHubName} and ${actionVerb.toLowerCase()}.`
          : submitLabelOverride ?? `Confirm ${actionVerb}`;
        return (
          <div className="lo-confirm-row">
            <button
              type="button"
              className="lo-confirm-cta"
              onClick={async () => {
                if (!walletAddress) return;
                if (!market.onchain) return;
                const amt = parseFloat(amount);
                if (!Number.isFinite(amt) || amt <= 0) return;
                // Prompt the wallet to switch to the hub chain BEFORE any
                // contract reads (allowance) or signs fire. Without this,
                // viem hits the wrong-chain RPC, the loan token contract
                // doesn't exist there, and `allowance()` reverts with
                // "Internal error" — surfaced to the user as a misleading
                // "Signing failed" toast.
                const targetChainId = market.onchain.hubChainId;
                if (walletChainId !== targetChainId) {
                  try {
                    await switchChainAsync({ chainId: targetChainId });
                  } catch (err) {
                    toast({
                      title: "Wrong network",
                      description: `Switch your wallet to ${targetHubName} to ${actionVerb.toLowerCase()}.`,
                      variant: "destructive",
                    });
                    return;
                  }
                }
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
              title={ctaTitle}
            >
              {ctaLabel}
            </button>
          </div>
        );
      })()}
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

// Format a numeric balance for the amount input field. Strips floating-
// point noise (0.1 + 0.2 → 0.3, not 0.30000000000000004), caps precision
// at the token's on-chain decimals (so the parseUnits round-trip never
// loses bits), and removes trailing zeros / dots for a clean display
// (9999979 vs "9999979.000000"). Falls back to "" when the value isn't
// finite — keeps the input empty rather than showing "NaN".
function formatAmountForInput(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const cap = Math.max(0, Math.min(decimals, 8));
  const rounded = Number(value.toFixed(cap));
  if (Number.isInteger(rounded)) return rounded.toString();
  return rounded.toString();
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

export interface LoanTabIntent {
  marketId: string;
  action: "withdraw" | "repay";
}

export function LoanTab({ initialIntent }: { initialIntent?: LoanTabIntent | null }) {
  const { address } = useAccount();
  const { toast } = useToast();
  const { markets: liveMarkets, error: marketsError } = useMarkets();
  const { positions, refresh: refreshPositions } = usePositions(address as Address | undefined);
  const { submit: submitAction, loading: actionSubmitting } = useLendingAction();

  const [selectedId, setSelectedId] = useState("arc-usdc-eurc");
  const [actionId, setActionId] = useState("lend");
  const [amount, setAmount] = useState("");

  // Consume an external intent (e.g. from Positions tab Withdraw/Repay buttons).
  // When the intent changes, pre-select the target market and action tab.
  const consumedIntentRef = useRef<LoanTabIntent | null>(null);
  useEffect(() => {
    if (initialIntent && initialIntent !== consumedIntentRef.current) {
      consumedIntentRef.current = initialIntent;
      setSelectedId(initialIntent.marketId);
      setActionId(initialIntent.action);
      setAmount("");
    }
  }, [initialIntent]);

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
        title: result.approveTx ? "Approve + submit landed" : "Submitted on-chain",
        description: `${kind} tx ${result.tx.slice(0, 10)}… confirmed. Position will refresh on next poll.`,
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
          <MarketsTable
            market={market}
            markets={enrichedMarkets}
            onSelect={setSelectedId}
            positions={positions}
          />
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
          activePosition={onchainPositionForMarket}
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

