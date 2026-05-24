/**
 * Static pair catalogue for the /swap widget.
 *
 * The K3 API (`POST /spot/quote`) accepts a 4-symbol enum
 * (`"EURC" | "JPYC" | "MXNB" | "CHFC"`) and pins source = Fuji (43113),
 * destination = Arc (5042002). Each row here mirrors one of those
 * routes plus the spoke-side input leg (USDC on Fuji) so the widget can
 * render a meaningful in/out token preview.
 *
 * If/when K4 (`GET /spot/pools`) lands, this list becomes the fallback
 * for chains the API doesn't know about yet — but the API will be the
 * source of truth. Marked TODO inline so the follow-up swap is obvious.
 *
 * Currency codes here MUST stay in sync with `SpotFxSymbol` in
 * `@bufi/contracts`. Anything outside that union throws inside
 * `buildVenueSpotIntent`.
 */
import { getStableToken, type StableToken } from "@bufi/location";

export type SpotPairSymbol = "EURC" | "JPYC" | "MXNB" | "CHFC";

export interface SpotPair {
  /** Same value passed as `symbol` to POST /spot/quote. */
  symbol: SpotPairSymbol;
  /** UI label shown in the picker ("USDC → EURC"). */
  label: string;
  /** Spoke chain id where the user signs (Fuji). */
  sourceChainId: 43113;
  /** Hub chain id where the venue executes (Arc). */
  destinationChainId: 5042002;
  /** Input leg metadata (always USDC on Fuji today). */
  inputToken: StableToken;
  /** Output leg metadata (EURC / JPYC / MXNB / CHFC). */
  outputToken: StableToken;
  /** Pyth-anchored indicative price (units: output per 1 unit input) —
   *  derived from the StableToken `usdPrice` table; replaced by a live
   *  feed once K4 streams a router-quoted price field. */
  indicativeRate: number;
}

function buildPair(symbol: SpotPairSymbol): SpotPair {
  // USDC is always the input leg for Wave-L3. The /spot/quote endpoint
  // doesn't take input-token as a parameter — it's pinned per route.
  const inputToken = getStableToken("USDC");
  // SpotPairSymbol is a 1:1 superset of StableTokenType for these 4 codes,
  // so the cast is sound.
  const outputToken = getStableToken(symbol as Parameters<typeof getStableToken>[0]);
  // indicativeRate ≈ how many output tokens for 1 input token. With
  // USDC = $1 by definition this is just 1 / output.usdPrice when the
  // output token's usdPrice represents its value in USD. Guard the
  // divide so unconfigured assets don't NaN out the UI.
  const indicativeRate = outputToken.usdPrice > 0 ? 1 / outputToken.usdPrice : 0;
  return {
    symbol,
    label: `${inputToken.asset} → ${outputToken.asset}`,
    sourceChainId: 43113,
    destinationChainId: 5042002,
    inputToken,
    outputToken,
    indicativeRate,
  };
}

// TODO(K4): replace this static catalogue with `GET /spot/pools` once
// that endpoint lands. The 4 entries here are the ones K3 actually
// supports today — adding a fifth here without a backing route makes
// /spot/quote throw 424 "venue router not configured".
export const SPOT_PAIRS: readonly SpotPair[] = [
  buildPair("EURC"),
  buildPair("MXNB"),
  buildPair("JPYC"),
  buildPair("CHFC"),
];

export function getSpotPair(symbol: SpotPairSymbol): SpotPair {
  const hit = SPOT_PAIRS.find((p) => p.symbol === symbol);
  if (!hit) throw new Error(`unknown spot pair symbol: ${symbol}`);
  return hit;
}
