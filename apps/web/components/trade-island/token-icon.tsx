"use client";

/**
 * Real-asset token icons for the Trade Island.
 *
 * The legacy `FlagPair` / `FxChip` rendered country emoji flags. This
 * module replaces them with the bundler-resolved token artwork from
 * `@bufi/location/stable-tokens` — the same source the Loan/Borrow
 * wallet popover already uses.
 *
 * Symbol-to-icon resolution layers (first match wins):
 *
 *   1. Exact match in STABLE_TOKEN_LIST (USDC, EURC, MXNB, AUDF, JPYC,
 *      KRW1, BRLA, PHPC, QCAD, ZARU).
 *
 *   2. SYNTHETIC_TO_STABLE — the `m`-prefixed mocks the Loan/Borrow
 *      table still surfaces while the protocol on-ramps the real
 *      issuer contracts. mAUDF → AUDF, mJPYC → JPYC, etc. This keeps
 *      the synthetic markets visually consistent with what they'll be
 *      once Bitso / Coinbase / etc. ship their real testnet contracts.
 *
 *   3. FIAT_TO_STABLE — bare ISO currency codes from older Market
 *      rows ("EUR", "USD", "MXN") get mapped to the closest stable
 *      icon. This is a UI convenience for the chart header where the
 *      Market type still carries `base: "EUR", quote: "USD"`.
 *
 *   4. Fallback monogram: first 1-2 letters in a coloured pill.
 *
 * No data is hardcoded here — only icon decoration that has no
 * on-chain analogue. The icon imports are static assets bundled
 * alongside the stable-tokens registry.
 */

import Image from "next/image";

import {
  STABLE_TOKEN_LIST,
  type StableToken,
  type StableTokenType,
} from "@bufi/location/stable-tokens";

import { LottieWrapper } from "@/components/ui/lottie-wrapper";

// cirBTC has no static SVG / PNG yet — Circle ships the brand as a
// Lottie loop on their Webflow CDN. Until we ingest a frozen still
// into @bufi/location/stable-tokens, render the live loop in place
// of the monogram fallback. The lottie-react child fetches + caches
// the JSON via the browser HTTP cache, so repeat renders in a market
// table only pay the parse + mount cost.
const CIRBTC_LOTTIE_URL =
  "https://cdn.prod.website-files.com/67116d0daddc92483c812e88/69cd233087350813462cfeea_cirBTC_Loop.json";

const STABLE_BY_ASSET: Readonly<Record<StableTokenType, StableToken>> =
  Object.fromEntries(
    STABLE_TOKEN_LIST.map((t) => [t.asset, t] as const),
  ) as Readonly<Record<StableTokenType, StableToken>>;

// Synthetic placeholder tokens (still in LOAN_TOKENS for demo markets that
// haven't been ported to issuer-controlled contracts) map to their real
// canonical icons. Once a synthetic is replaced by a live issuer contract
// the row drops the `m` prefix and resolves directly via STABLE_BY_ASSET.
const SYNTHETIC_TO_STABLE: Readonly<Record<string, StableTokenType>> = {
  mAUDF: "AUDF",
  mBRLA: "BRLA",
  mJPYC: "JPYC",
  mKRW1: "KRW1",
  mMXNB: "MXNB",
  mPHPC: "PHPC",
  mQCAD: "QCAD",
  mZARU: "ZARU",
};

// ISO fiat codes that older Market rows still carry. The Trade tab chart
// header passes the bare base/quote of a forex pair (EUR/USD) — map to
// the closest stable icon for the visual until those Market rows migrate
// to stablecoin-anchored symbols.
const FIAT_TO_STABLE: Readonly<Record<string, StableTokenType>> = {
  USD: "USDC",
  EUR: "EURC",
  AUD: "AUDF",
  BRL: "BRLA",
  JPY: "JPYC",
  KRW: "KRW1",
  MXN: "MXNB",
  PHP: "PHPC",
  CAD: "QCAD",
  ZAR: "ZARU",
};

const NATIVE_CRYPTO_LABELS: Readonly<Record<string, string>> = {
  BTC: "₿",
  ETH: "Ξ",
  SOL: "◎",
};

const iconUrl = (icon: StableToken["icon"]): string =>
  typeof icon === "string" ? icon : icon.src;

export function resolveTokenIcon(sym: string | undefined | null): {
  url: string;
  label: string;
} | null {
  if (!sym) return null;
  const trimmed = sym.trim();
  if (!trimmed) return null;
  // Exact stable match (USDC, EURC, MXNB, ...).
  const exact = STABLE_BY_ASSET[trimmed as StableTokenType];
  if (exact) return { url: iconUrl(exact.icon), label: exact.asset };
  // Synthetic m-prefixed placeholders.
  const synth = SYNTHETIC_TO_STABLE[trimmed];
  if (synth) {
    const ref = STABLE_BY_ASSET[synth];
    if (ref) return { url: iconUrl(ref.icon), label: synth };
  }
  // Bare ISO currency code from legacy Market rows.
  const fiat = FIAT_TO_STABLE[trimmed.toUpperCase()];
  if (fiat) {
    const ref = STABLE_BY_ASSET[fiat];
    if (ref) return { url: iconUrl(ref.icon), label: fiat };
  }
  return null;
}

const MONOGRAM_HUE: Readonly<Record<string, number>> = {
  BTC: 36,
  ETH: 232,
  SOL: 287,
};

function monogramFor(sym: string): { text: string; hue: number } {
  const cleaned = sym.replace(/-PERP$/i, "").toUpperCase();
  const native = NATIVE_CRYPTO_LABELS[cleaned];
  if (native) {
    return { text: native, hue: MONOGRAM_HUE[cleaned] ?? 270 };
  }
  const head = cleaned.slice(0, 3) || "?";
  // Deterministic hue per symbol so the same monogram keeps the same
  // colour across renders / tabs.
  let hash = 0;
  for (const ch of cleaned) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return { text: head, hue: Math.abs(hash) % 360 };
}

export function TokenIcon({
  sym,
  size = 22,
  title,
}: {
  sym: string;
  size?: number;
  title?: string;
}) {
  // cirBTC: render the Webflow-hosted Lottie loop. Matches any
  // casing the loan/markets tables emit ("cirBTC", "CIRBTC", "cirbtc").
  if (sym.trim().toLowerCase() === "cirbtc") {
    return (
      <span
        title={title ?? "cirBTC"}
        aria-label={title ?? "cirBTC"}
        style={{
          display: "inline-block",
          width: size,
          height: size,
          borderRadius: "50%",
          overflow: "hidden",
          flexShrink: 0,
          lineHeight: 0,
        }}
      >
        <LottieWrapper
          animationData={CIRBTC_LOTTIE_URL}
          width=""
          height=""
          style={{ width: size, height: size }}
          ariaLabel="cirBTC"
        />
      </span>
    );
  }

  const icon = resolveTokenIcon(sym);
  if (icon) {
    return (
      <Image
        src={icon.url}
        alt={icon.label}
        width={size}
        height={size}
        title={title ?? icon.label}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          display: "block",
        }}
        unoptimized
      />
    );
  }
  const m = monogramFor(sym);
  return (
    <span
      className="token-icon-monogram"
      title={title ?? sym}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        background: `hsl(${m.hue}, 55%, 88%)`,
        color: `hsl(${m.hue}, 45%, 28%)`,
        fontWeight: 800,
        fontSize: Math.round(size * 0.42),
        letterSpacing: "-0.02em",
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {m.text}
    </span>
  );
}

/**
 * Two overlapping token icons. Drop-in visual replacement for the
 * legacy `FlagPair`. Take the canonical base/quote symbols (e.g.
 * `base="EURC" quote="USDC"`) — the resolver handles synthetic and
 * fiat fallback automatically.
 */
export function TokenIconPair({
  base,
  quote,
  size = 22,
}: {
  base: string;
  quote: string;
  size?: number;
}) {
  // Overlap by ~30% — same visual rhythm as the legacy FlagPair so
  // CSS/layout assumptions don't shift.
  const overlap = Math.max(4, Math.round(size * 0.3));
  return (
    <span
      className="token-icon-pair"
      style={{
        display: "inline-flex",
        alignItems: "center",
        position: "relative",
        width: size * 2 - overlap,
        height: size,
        flexShrink: 0,
      }}
    >
      <span style={{ position: "relative", zIndex: 2, lineHeight: 0 }}>
        <TokenIcon sym={base} size={size} />
      </span>
      <span
        style={{
          position: "relative",
          marginLeft: -overlap,
          zIndex: 1,
          lineHeight: 0,
        }}
      >
        <TokenIcon sym={quote} size={size} />
      </span>
    </span>
  );
}
