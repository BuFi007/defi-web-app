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
  /** Display name of the stablecoin. */
  name: string;
  /** Token symbol / on-chain ticker. */
  asset: StableTokenType;
  /** Public-path URL to the token icon. */
  icon: StableImageSource;
};

export type StableTokenType =
  | "USDC"
  | "EURC"
  | "AUDF"
  | "BRLA"
  | "JPYC"
  | "KRW1"
  | "MXNB"
  | "PHPC"
  | "QCAD"
  | "ZARU";

const StableTokenMap: Record<StableTokenType, StableToken> = {
  USDC: {
    code: "USD",
    unicode: "U+1F1FA U+1F1F8",
    name: "USD Coin",
    asset: "USDC",
    icon: `${ASSET_BASE}/usdc_token_icon.svg`,
  },
  EURC: {
    code: "EUR",
    unicode: "U+1F1EA U+1F1FA",
    name: "Euro Coin",
    asset: "EURC",
    icon: `${ASSET_BASE}/eurc_token_icon.svg`,
  },
  AUDF: {
    code: "AUD",
    unicode: "U+1F1E6 U+1F1FA",
    name: "Australian Dollar (AUDF)",
    asset: "AUDF",
    icon: `${ASSET_BASE}/audf_token_icon.svg`,
  },
  BRLA: {
    code: "BRL",
    unicode: "U+1F1E7 U+1F1F7",
    name: "Brazilian Real (BRLA)",
    asset: "BRLA",
    icon: `${ASSET_BASE}/brla_token_icon.png`,
  },
  JPYC: {
    code: "JPY",
    unicode: "U+1F1EF U+1F1F5",
    name: "Japanese Yen Coin",
    asset: "JPYC",
    icon: `${ASSET_BASE}/jpyc_token_icon.png`,
  },
  KRW1: {
    code: "KRW",
    unicode: "U+1F1F0 U+1F1F7",
    name: "Korean Won (KRW1)",
    asset: "KRW1",
    icon: `${ASSET_BASE}/krw1_token_icon.png`,
  },
  MXNB: {
    code: "MXN",
    unicode: "U+1F1F2 U+1F1FD",
    name: "Mexican Peso (MXNB)",
    asset: "MXNB",
    icon: `${ASSET_BASE}/mxnb_token_icon.svg`,
  },
  PHPC: {
    code: "PHP",
    unicode: "U+1F1F5 U+1F1ED",
    name: "Philippine Peso Coin",
    asset: "PHPC",
    icon: `${ASSET_BASE}/phpc_token_icon.png`,
  },
  QCAD: {
    code: "CAD",
    unicode: "U+1F1E8 U+1F1E6",
    name: "Canadian Dollar (QCAD)",
    asset: "QCAD",
    icon: `${ASSET_BASE}/qcad_token_icon.png`,
  },
  ZARU: {
    code: "ZAR",
    unicode: "U+1F1FF U+1F1E6",
    name: "South African Rand (ZARU)",
    asset: "ZARU",
    icon: `${ASSET_BASE}/zaru_token_icon.png`,
  },
};

export function getStableToken(asset: StableTokenType): StableToken {
  return StableTokenMap[asset];
}

export const STABLE_TOKEN_LIST = Object.values(StableTokenMap);

export default StableTokenMap;
