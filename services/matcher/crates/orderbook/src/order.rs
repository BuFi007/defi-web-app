//! Order, Intent, and Fill types.

use serde::{Deserialize, Serialize};

use crate::price::{Price, Size};

/// bytes32 market identifier (matches Solidity `FxMarketRegistry` id).
pub type MarketId = [u8; 32];

/// bytes32 intent identifier (deterministic hash of the signed intent payload).
pub type IntentId = [u8; 32];

/// Taker side for an intent or maker side for a resting order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Side {
    /// Long = buyer of the perp.
    Long,
    /// Short = seller of the perp.
    Short,
}

impl Side {
    /// The opposite side.
    pub fn opposite(self) -> Side {
        match self {
            Side::Long => Side::Short,
            Side::Short => Side::Long,
        }
    }
}

/// Limit vs market order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderType {
    /// Limit at the given price.
    Limit,
    /// Market — execute at the best available price up to size.
    Market,
}

/// Time-in-force policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimeInForce {
    /// Rest on the book if not fully filled.
    GoodTilCancel,
    /// Drop residual after matching.
    ImmediateOrCancel,
    /// Reject if can't fully fill (validated via `peek_match`).
    FillOrKill,
}

/// A signed intent submitted by a trader.
///
/// Field order matches `proto/matcher.v1.proto` `SignedIntent` for byte-stable
/// serde round-trips in golden tests.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Intent {
    /// Deterministic id derived from the signed payload hash.
    pub id: IntentId,
    /// The market this intent targets.
    pub market_id: MarketId,
    /// Taker side.
    pub side: Side,
    /// Limit vs market.
    pub order_type: OrderType,
    /// Total intended quote-asset size (USDC quantums).
    pub size: Size,
    /// Limit price (ignored for market orders).
    pub limit_price: Price,
    /// Time-in-force policy.
    pub tif: TimeInForce,
    /// Trader address (20 bytes).
    pub account: [u8; 20],
    /// Per-account monotonic nonce, used for replay protection.
    pub nonce: u64,
    /// Unix-ms expiry. The matcher rejects expired intents.
    pub expires_at_ms: u64,
}

/// A resting order on the book.
///
/// Has more fields than `Intent` because it tracks partial-fill state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Order {
    /// Originating intent id.
    pub id: IntentId,
    /// Owning trader.
    pub account: [u8; 20],
    /// Side of the order on the book.
    pub side: Side,
    /// Resting price.
    pub price: Price,
    /// Size remaining on the book.
    pub remaining: Size,
    /// `now_ms` at insertion; used purely for tiebreaks within a price level
    /// (FIFO is the primary order, this is just a stored breadcrumb).
    pub inserted_at_ms: u64,
}

impl Order {
    /// Create a resting order from an intent's residual after a partial match.
    pub fn from_intent_residual(intent: &Intent, remaining: Size, now_ms: u64) -> Self {
        Self {
            id: intent.id,
            account: intent.account,
            side: intent.side,
            price: intent.limit_price,
            remaining,
            inserted_at_ms: now_ms,
        }
    }
}

/// A single match between a maker and a taker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fill {
    /// Deterministic fill id — hash of (maker_intent_id, taker_intent_id, seq).
    pub fill_id: [u8; 32],
    /// Maker side intent id (resting order).
    pub maker_intent_id: IntentId,
    /// Taker side intent id (incoming).
    pub taker_intent_id: IntentId,
    /// Market.
    pub market_id: MarketId,
    /// Taker's side.
    pub taker_side: Side,
    /// Fill price (maker's resting price).
    pub price: Price,
    /// Fill size in quote quantums.
    pub size: Size,
    /// Match timestamp.
    pub timestamp_ms: u64,
    /// Whether the counter-party is the LP vault (Phase 4+).
    pub is_lp_fill: bool,
}
