/**
 * FX market symbol → Pyth feed id manifest.
 *
 * The on-chain `PYTH_FEED_IDS` in `@bufi/contracts` only carries the four
 * fiats the protocol actually settles against on-chain (EUR/JPY/MXN/CHF).
 * The Trade Island UI also surfaces GBP/AUD/CAD/NZD/USD-pairs for the
 * Pyth Hermes live tick stream — those aren't tradeable yet, but the
 * mark price still ticks on the chart. We keep their IDs here (canonical
 * mainnet IDs, which Hermes serves identically across mainnet and Pythnet)
 * rather than polluting the on-chain contracts manifest.
 *
 * Source: Pyth Network — https://www.pyth.network/developers/price-feed-ids
 * Cross-checked against Hermes /v2/updates/price/latest responses.
 */

import { PYTH_FEED_IDS } from "@bufi/contracts";
import type { Hex } from "viem";

/**
 * Pyth Hermes serves the same feed id across mainnet + Pythnet for any
 * given price feed. Hermes is the public REST/WS endpoint — feed ids are
 * a global namespace, not chain-scoped.
 */
export const PYTH_FX_FEEDS = {
  // From `@bufi/contracts` PYTH_FEED_IDS (already used by FxOracle reads).
  "EUR/USD": PYTH_FEED_IDS.eurUsd,
  "USD/JPY": PYTH_FEED_IDS.jpyUsd,
  "USD/MXN": PYTH_FEED_IDS.mxnUsd,
  "USD/CHF": PYTH_FEED_IDS.chfUsd,
  // Additional FX pairs shown in the Trade-Island market picker but not yet
  // settled on-chain. Canonical Pyth mainnet feed ids.
  "GBP/USD": "0x84c2dde9633d93d1bcad84e7dc41c9d56578b7ec52fabedc1f335d673df0a7c1",
  "AUD/USD": "0x67a6f93030420c1c9e3fe37c1ab6b77966af82f995944a9fefce357a22854a80",
  "USD/CAD": "0x3112b03a41c910ed446852aacf67118cb1bec67b2cd0b9a214c58cc0eaa2ecca",
  "NZD/USD": "0x92eea8ba1b00078cdc2ef6f64f091f262e8c7d0576ee4677572f314ebfafa4c7",
} as const satisfies Record<string, Hex>;

export type PythFxSymbol = keyof typeof PYTH_FX_FEEDS;

export function pythFeedForFxSymbol(symbol: string): Hex | null {
  return (PYTH_FX_FEEDS as Record<string, Hex>)[symbol] ?? null;
}

/**
 * Some Pyth feeds are inverted relative to the symbol the UI shows.
 *
 * Convention: Pyth publishes most cross-USD pairs as `<CCY>/USD` — i.e. the
 * raw `price` is "1 unit of <ccy> = $price". For `USD/<CCY>` markets the UI
 * wants the inverse (e.g. USD/JPY = 1 / (JPY/USD)).
 *
 * - EUR/USD → publishes as EUR/USD directly       → NOT inverted
 * - USD/JPY → Pyth feed is JPY/USD                → INVERTED
 * - USD/MXN → Pyth feed is MXN/USD                → INVERTED
 * - USD/CHF → Pyth feed is CHF/USD                → INVERTED
 * - GBP/USD → publishes directly                  → NOT inverted
 * - AUD/USD → publishes directly                  → NOT inverted
 * - USD/CAD → Pyth feed is CAD/USD                → INVERTED
 * - NZD/USD → publishes directly                  → NOT inverted
 *
 * The mark price the chart paints must match the symbol orientation (Trade
 * Island's `USD/JPY` reads ~150, the raw JPY/USD feed reads ~0.0067). We
 * invert at the consumer (the React hook) so the WS client itself stays
 * symbol-agnostic.
 */
export function isFxFeedInverted(symbol: string): boolean {
  return symbol.startsWith("USD/");
}
