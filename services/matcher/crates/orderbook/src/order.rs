//! `Intent`, `Order`, `Fill` types — wire-compatible with
//! `FxOrderSettlement.SignedOrder` (fx-telarana).
//!
//! Field-for-field mapping vs the Solidity struct
//! (`contracts/src/perp/interfaces/IFxOrderSettlement.sol`):
//!
//! | Solidity           | Rust              | Notes |
//! |--------------------|-------------------|-------|
//! | `trader`           | `trader: [u8;20]` | Address. |
//! | `marketId`         | `market_id: [u8;32]` | bytes32 from `FxPerpClearinghouse._marketConfig`. |
//! | `sizeDeltaE18`     | `(side, magnitude)` | Sign → `Side`, magnitude → `Size`. Split at validator boundary. |
//! | `priceE18`         | `price: Price`    | 18-dec WAD. |
//! | `maxFee`           | `max_fee: u128`   | 18-dec USDC, 0 = uncapped. |
//! | `orderType`        | `order_type: OrderType` | 0=Market, 1=Limit (matches contract enum). |
//! | `flags`            | `flags: u8`       | Bit 0 = REDUCE_ONLY, Bit 1 = POST_ONLY. |
//! | `nonce`            | `nonce: u64`     | Permit2 bitmap index (NOT monotonic). |
//! | `deadline`         | `deadline_secs: u64` | Unix **seconds** (matches `block.timestamp`). |
//!
//! `tif` and `client_tag` are matcher-only — NOT covered by the EIP-712
//! typehash. The contract derives time-in-force from order behaviour alone.

use serde::{Deserialize, Serialize};

use crate::price::{Price, Size};

/// bytes32 market identifier (key into `FxPerpClearinghouse._marketConfig`).
/// Concrete ids documented in `references/.../fx-telarana/docs/BUFX_INTEGRATION.md`.
pub type MarketId = [u8; 32];

/// bytes32 intent identifier — deterministic keccak256 of the EIP-712-hashed
/// `SignedOrder`. Same value the contract uses to key `orderStatus`.
pub type IntentId = [u8; 32];

/// `flags` bit: maker/taker can only reduce an existing position, not flip or grow it.
pub const FLAG_REDUCE_ONLY: u8 = 1 << 0;

/// `flags` bit: order rejected if it would take liquidity (taker role). Maker-only orders.
pub const FLAG_POST_ONLY: u8 = 1 << 1;

/// Derived from the sign of `sizeDeltaE18` at the validator boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Side {
    /// `sizeDeltaE18 > 0` — buyer.
    Long,
    /// `sizeDeltaE18 < 0` — seller.
    Short,
}

impl Side {
    /// Opposite side.
    pub fn opposite(self) -> Side {
        match self {
            Side::Long => Side::Short,
            Side::Short => Side::Long,
        }
    }
}

/// Mirrors `FxOrderSettlement.ORDER_TYPE_{MARKET,LIMIT}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum OrderType {
    /// 0 — execute at any crossing price up to magnitude.
    Market = 0,
    /// 1 — execute only at or better than `price`.
    Limit = 1,
}

/// Time-in-force — matcher-only, NOT in EIP-712 typehash.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimeInForce {
    /// Rest residual on the book.
    GoodTilCancel,
    /// Drop residual after matching.
    ImmediateOrCancel,
    /// Reject if can't fully fill (peek-then-execute).
    FillOrKill,
}

/// A signed `SignedOrder` (per the contract) plus matcher-only fields.
///
/// Constructed by `matcher-server::intent_validator` from a verified proto
/// `SignedOrder`. The orderbook never sees the raw signed bytes or the
/// signature — by the time an `Intent` reaches `match_intent`, signature
/// recovery + nonce-bitmap check + deadline check have already passed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Intent {
    /// Deterministic id — keccak256 of the EIP-712 hashed payload.
    pub id: IntentId,
    /// Market id (bytes32).
    pub market_id: MarketId,
    /// Trader's 20-byte address.
    pub trader: [u8; 20],
    /// Derived from `sign(sizeDeltaE18)`.
    pub side: Side,
    /// `|sizeDeltaE18|` — taker's intended notional, E18.
    pub magnitude: Size,
    /// `priceE18`. Required for limit orders.
    pub price: Price,
    /// `maxFee` cap in USDC E18; 0 = uncapped.
    pub max_fee: u128,
    /// Market vs limit.
    pub order_type: OrderType,
    /// `flags` bitfield (FLAG_REDUCE_ONLY | FLAG_POST_ONLY).
    pub flags: u8,
    /// Permit2-style nonce — *bit* in `nonceBitmap[trader][nonce >> 8]`.
    pub nonce: u64,
    /// `block.timestamp` upper bound, unix **seconds**.
    pub deadline_secs: u64,
    /// Matcher-only time-in-force.
    pub tif: TimeInForce,
}

impl Intent {
    /// True iff `flags & FLAG_REDUCE_ONLY != 0`.
    pub fn is_reduce_only(&self) -> bool {
        self.flags & FLAG_REDUCE_ONLY != 0
    }

    /// True iff `flags & FLAG_POST_ONLY != 0`.
    pub fn is_post_only(&self) -> bool {
        self.flags & FLAG_POST_ONLY != 0
    }
}

/// A resting maker on the book — residual of a previously-matched `Intent`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Order {
    /// Originating intent id.
    pub id: IntentId,
    /// Trader.
    pub trader: [u8; 20],
    /// Side (maker-side; opposite of the taker that crosses it).
    pub side: Side,
    /// Resting price.
    pub price: Price,
    /// Magnitude remaining on the book.
    pub remaining: Size,
    /// `flags` carried forward (post-only acts as a hint to risk checks
    /// elsewhere; reduce-only stays meaningful for the maker's own account).
    pub flags: u8,
    /// `now_ms` at insertion. Internal matcher clock — passed in, never read.
    /// Used as a FIFO breadcrumb at the same price level.
    pub inserted_at_ms: u64,
}

impl Order {
    /// Build a resting order from an intent's residual after a partial fill.
    pub fn from_intent_residual(intent: &Intent, remaining: Size, now_ms: u64) -> Self {
        Self {
            id: intent.id,
            trader: intent.trader,
            side: intent.side,
            price: intent.price,
            remaining,
            flags: intent.flags,
            inserted_at_ms: now_ms,
        }
    }
}

/// A single maker × taker match.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fill {
    /// Deterministic fill id — hash of `(maker_intent_id, taker_intent_id, seq)`.
    pub fill_id: [u8; 32],
    /// Maker intent id.
    pub maker_intent_id: IntentId,
    /// Taker intent id.
    pub taker_intent_id: IntentId,
    /// Market.
    pub market_id: MarketId,
    /// Taker side.
    pub taker_side: Side,
    /// Fill price (= maker's resting price).
    pub price: Price,
    /// Fill magnitude, E18.
    pub size: Size,
    /// `now_ms` at match time. Source: matcher-server.
    pub timestamp_ms: u64,
    /// Phase 4+: true when the counter-party is the LP vault.
    pub is_lp_fill: bool,
}
