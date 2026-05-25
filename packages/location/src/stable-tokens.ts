/**
 * Icons are served as static URL strings from `apps/web/public/assets/
 * stable-tokens/`. Plain strings instead of bundler-resolved imports
 * because the location package is consumed by both Next.js (where SVG
 * imports work via the build loader) and by tsc --noEmit packages that
 * can't resolve them. Strings work in both worlds.
 *
 * Source of truth for the asset files lives in `packages/location/
 * assets/`; the apps/web build copies (or symlinks) them into public/.
 */

const ASSET_BASE = "/assets/stable-tokens";

/** Either a URL string (current shape) or a `StaticImageData`-shaped
 *  object — both accepted by `next/image` so consumers don't need to
 *  branch. */
export type StableImageSource =
  | string
  | {
      src: string;
      height: number;
      width: number;
      blurDataURL?: string;
    };

export type StableToken = {
  /** ISO 4217 currency code, e.g. "USD". */
  code: string;
  /** Unicode code-points for the country's flag emoji. */
  unicode: string;
  /** Country-flag glyph (rendered as Unicode). Source of truth for every
   *  in-app place that shows a flag next to the asset — wallet popover,
   *  loan tokens, action card, etc. */
  flag: string;
  /** Display name of the stablecoin. */
  name: string;
  /** Token symbol / on-chain ticker. */
  asset: StableTokenType;
  /** Public-path URL to the token icon. */
  icon: StableImageSource;
  /** Reference USD price used for client-side $-value previews ONLY
   *  (wallet trigger total, loan ActionCard projection). NOT a tradable
   *  quote — when a Pyth-backed FX feed is wired, replace with a live
   *  hook. Floats roughly equal to the published spot mid at the time
   *  these values were last reviewed. */
  usdPrice: number;
  /** True when the issuer contract is a placeholder (no funded liquidity,
   *  no live mints). UI surfaces still render the row but disable trading
   *  CTAs. False once the canonical issuer ships and the address gets
   *  wired into packages/location/src/deployments. */
  mock: boolean;
  /** Number of decimal places the UI rounds to when displaying a balance.
   *  ERC-20 decimals (atomic-unit precision) live with the deployment
   *  entry instead. */
  displayDecimals: number;
};

export type StableTokenType =
  | "USDC"
  | "EURC"
  | "AUDF"
  | "BRLA"
  | "CIRBTC"
  | "JPYC"
  | "KRW1"
  | "MXNB"
  | "PHPC"
  | "QCAD"
  | "ZARU";

// `usdPrice` values mirror the legacy `TOKEN_USD_PRICE` table in the
// stablecoin-balances component plus the `price` column on LOAN_TOKENS in
// trade-island/loan.tsx. Both tables now read FROM here. When a Pyth feed
// is wired for an asset, replace with a live hook at the call site; this
// table is fallback only.
const StableTokenMap: Record<StableTokenType, StableToken> = {
  USDC: {
    code: "USD", unicode: "U+1F1FA U+1F1F8", flag: "🇺🇸",
    name: "USD Coin", asset: "USDC",
    icon: `${ASSET_BASE}/usdc_token_icon.svg`,
    usdPrice: 1.0, mock: false, displayDecimals: 2,
  },
  EURC: {
    code: "EUR", unicode: "U+1F1EA U+1F1FA", flag: "🇪🇺",
    name: "Euro Coin", asset: "EURC",
    icon: `${ASSET_BASE}/eurc_token_icon.svg`,
    usdPrice: 1.084, mock: false, displayDecimals: 2,
  },
  AUDF: {
    code: "AUD", unicode: "U+1F1E6 U+1F1FA", flag: "🇦🇺",
    name: "Australian Dollar (AUDF)", asset: "AUDF",
    icon: `${ASSET_BASE}/audf_token_icon.svg`,
    usdPrice: 0.6648, mock: false, displayDecimals: 2,
  },
  BRLA: {
    code: "BRL", unicode: "U+1F1E7 U+1F1F7", flag: "🇧🇷",
    name: "Brazilian Real (BRLA)", asset: "BRLA",
    icon: `${ASSET_BASE}/brla_token_icon.png`,
    usdPrice: 0.1724, mock: false, displayDecimals: 2,
  },
  // cirBTC is Circle's wrapped-BTC test token on Arc — 8 dp on-chain
  // (matches BTC's satoshi precision; NOT 6 like the USD-pegged stables).
  // Icon is rendered via Lottie in token-icon.tsx (no static SVG yet);
  // `icon` here points at a placeholder that the chip swaps for the
  // animated source when `sym.toLowerCase() === 'cirbtc'`.
  CIRBTC: {
    code: "BTC", unicode: "U+20BF", flag: "₿",
    name: "Circle Bitcoin (cirBTC)", asset: "CIRBTC",
    icon: `${ASSET_BASE}/usdc_token_icon.svg`,
    usdPrice: 95000, mock: false, displayDecimals: 6,
  },
  JPYC: {
    code: "JPY", unicode: "U+1F1EF U+1F1F5", flag: "🇯🇵",
    name: "Japanese Yen Coin", asset: "JPYC",
    icon: `${ASSET_BASE}/jpyc_token_icon.png`,
    usdPrice: 0.00648, mock: false, displayDecimals: 0,
  },
  KRW1: {
    code: "KRW", unicode: "U+1F1F0 U+1F1F7", flag: "🇰🇷",
    name: "Korean Won (KRW1)", asset: "KRW1",
    icon: `${ASSET_BASE}/krw1_token_icon.png`,
    usdPrice: 0.000726, mock: false, displayDecimals: 0,
  },
  MXNB: {
    code: "MXN", unicode: "U+1F1F2 U+1F1FD", flag: "🇲🇽",
    name: "Mexican Peso (MXNB)", asset: "MXNB",
    icon: `${ASSET_BASE}/mxnb_token_icon.svg`,
    usdPrice: 0.0585, mock: false, displayDecimals: 2,
  },
  PHPC: {
    code: "PHP", unicode: "U+1F1F5 U+1F1ED", flag: "🇵🇭",
    name: "Philippine Peso Coin", asset: "PHPC",
    icon: `${ASSET_BASE}/phpc_token_icon.png`,
    usdPrice: 0.01754, mock: false, displayDecimals: 2,
  },
  QCAD: {
    code: "CAD", unicode: "U+1F1E8 U+1F1E6", flag: "🇨🇦",
    name: "Canadian Dollar (QCAD)", asset: "QCAD",
    icon: `${ASSET_BASE}/qcad_token_icon.png`,
    usdPrice: 0.7299, mock: false, displayDecimals: 2,
  },
  ZARU: {
    code: "ZAR", unicode: "U+1F1FF U+1F1E6", flag: "🇿🇦",
    name: "South African Rand (ZARU)", asset: "ZARU",
    icon: `${ASSET_BASE}/zaru_token_icon.png`,
    usdPrice: 0.0526, mock: false, displayDecimals: 2,
  },
};

export function getStableToken(asset: StableTokenType): StableToken {
  return StableTokenMap[asset];
}

export const STABLE_TOKEN_LIST = Object.values(StableTokenMap);

export default StableTokenMap;
