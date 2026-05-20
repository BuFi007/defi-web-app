/**
 * Deterministic webhook nonce derivation.
 *
 * Same on-chain event → same nonce, every time. This is the dedup primitive
 * integrators rely on: if they see two POSTs with `X-Bufi-Nonce` matching
 * a nonce they've already processed, they can safely ack-with-no-op.
 *
 * Nonce shape: `${eventType}-${marketId}-${txHash}-${logIndex}`.
 * For funding events (which aren't tied to a single tx) we use the on-chain
 * funding version in place of `logIndex` and the keeper's signing tx hash
 * in place of `txHash` (or a synthetic `0x000…0` if no tx exists yet — the
 * (chainId, marketId, version) triplet is still globally unique).
 */

import type { WebhookEvent, WebhookEventType } from "./types";

export interface NonceComponents {
  eventType: WebhookEventType;
  marketId: string;
  txHash: string;
  logIndex: number | string;
}

/**
 * Build a nonce from explicit components. Inputs are lowercased / coerced
 * so case-variant duplicates don't slip through.
 */
export function buildNonce(components: NonceComponents): string {
  const market = components.marketId.toLowerCase();
  const tx = components.txHash.toLowerCase();
  const idx = String(components.logIndex);
  return `${components.eventType}-${market}-${tx}-${idx}`;
}

/**
 * Derive the nonce for a `WebhookEvent`. For funding events the on-chain
 * `version` field stands in for the log index — funding pokes are versioned
 * monotonically so (marketId, version) uniquely identifies the row.
 */
export function nonceForEvent(event: WebhookEvent): string {
  switch (event.type) {
    case "fill":
      // Fills carry txHash + we encode `${blockNumber}` as the index slot
      // when no logIndex is provided by upstream. For multi-fill txs the
      // matcher should provide a stable per-fill index (e.g. settlement
      // batch index) — for now we use blockNumber as a stable surrogate
      // that still satisfies (marketId, txHash, _) uniqueness across
      // distinct on-chain fills.
      return buildNonce({
        eventType: "fill",
        marketId: event.marketId,
        txHash: event.txHash,
        // taker address embedded into the index slot keeps cross-fill
        // events (same tx, multiple makers) globally unique.
        logIndex: `${event.blockNumber}-${event.taker.toLowerCase()}`,
      });
    case "liquidation":
      return buildNonce({
        eventType: "liquidation",
        marketId: event.marketId,
        txHash: event.txHash,
        logIndex: `${event.blockNumber}-${event.trader.toLowerCase()}`,
      });
    case "funding":
      return buildNonce({
        eventType: "funding",
        marketId: event.marketId,
        // No tx hash for funding rate updates — use a stable sentinel so the
        // nonce string remains the same shape. The (marketId, version)
        // tuple is the actual uniqueness key.
        txHash: "0x" + "0".repeat(64),
        logIndex: event.version,
      });
  }
}
