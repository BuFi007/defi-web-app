import audfIcon from "../assets/audf_token_icon.svg";
import brlaIcon from "../assets/brla_token_icon.png";
import eurcIcon from "../assets/eurc_token_icon.svg";
import jpycIcon from "../assets/jpyc_token_icon.png";
import krw1Icon from "../assets/krw1_token_icon.png";
import mxnbIcon from "../assets/mxnb_token_icon.svg";
import phpcIcon from "../assets/phpc_token_icon.png";
import qcadIcon from "../assets/qcad_token_icon.png";
import usdcIcon from "../assets/usdc_token_icon.svg";
import zaruIcon from "../assets/zaru_token_icon.png";

/**
 * Either a URL string (SVG static imports) or a `StaticImageData`-shaped
 * object (PNG static imports). Both forms are accepted by `next/image`.
 */
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
  /** Bundler-resolved icon source. Hand straight to `<Image src=...>`. */
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
    icon: usdcIcon,
  },
  EURC: {
    code: "EUR",
    unicode: "U+1F1EA U+1F1FA",
    name: "Euro Coin",
    asset: "EURC",
    icon: eurcIcon,
  },
  AUDF: {
    code: "AUD",
    unicode: "U+1F1E6 U+1F1FA",
    name: "Australian Dollar (AUDF)",
    asset: "AUDF",
    icon: audfIcon,
  },
  BRLA: {
    code: "BRL",
    unicode: "U+1F1E7 U+1F1F7",
    name: "Brazilian Real (BRLA)",
    asset: "BRLA",
    icon: brlaIcon,
  },
  JPYC: {
    code: "JPY",
    unicode: "U+1F1EF U+1F1F5",
    name: "Japanese Yen Coin",
    asset: "JPYC",
    icon: jpycIcon,
  },
  KRW1: {
    code: "KRW",
    unicode: "U+1F1F0 U+1F1F7",
    name: "Korean Won (KRW1)",
    asset: "KRW1",
    icon: krw1Icon,
  },
  MXNB: {
    code: "MXN",
    unicode: "U+1F1F2 U+1F1FD",
    name: "Mexican Peso (MXNB)",
    asset: "MXNB",
    icon: mxnbIcon,
  },
  PHPC: {
    code: "PHP",
    unicode: "U+1F1F5 U+1F1ED",
    name: "Philippine Peso Coin",
    asset: "PHPC",
    icon: phpcIcon,
  },
  QCAD: {
    code: "CAD",
    unicode: "U+1F1E8 U+1F1E6",
    name: "Canadian Dollar (QCAD)",
    asset: "QCAD",
    icon: qcadIcon,
  },
  ZARU: {
    code: "ZAR",
    unicode: "U+1F1FF U+1F1E6",
    name: "South African Rand (ZARU)",
    asset: "ZARU",
    icon: zaruIcon,
  },
};

export function getStableToken(asset: StableTokenType): StableToken {
  return StableTokenMap[asset];
}

export const STABLE_TOKEN_LIST = Object.values(StableTokenMap);

export default StableTokenMap;
