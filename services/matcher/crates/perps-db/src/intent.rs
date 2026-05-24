//! `PerpIntent` row type — mirrors the TS `PerpIntent` interface
//! (`packages/shared-types/src/index.ts:80-112`) and `perp_order_intents`
//! columns (`packages/db/src/index.ts:432-462`).

use serde::{Deserialize, Serialize};

/// Order side string in the DB. Matches the TS `PerpSide` literal type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PerpSide {
    /// Buyer.
    Long,
    /// Seller.
    Short,
}

impl PerpSide {
    /// SQL text representation.
    pub fn as_str(self) -> &'static str {
        match self {
            PerpSide::Long => "long",
            PerpSide::Short => "short",
        }
    }

    /// Parse from the SQL text representation.
    pub fn from_db_text(s: &str) -> Option<Self> {
        match s {
            "long" => Some(PerpSide::Long),
            "short" => Some(PerpSide::Short),
            _ => None,
        }
    }
}

/// Order type — matches the TS `"limit" | "market"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PerpOrderType {
    /// Limit.
    Limit,
    /// Market.
    Market,
}

impl PerpOrderType {
    /// SQL text representation.
    pub fn as_str(self) -> &'static str {
        match self {
            PerpOrderType::Limit => "limit",
            PerpOrderType::Market => "market",
        }
    }

    /// Parse from the SQL text representation.
    pub fn from_db_text(s: &str) -> Option<Self> {
        match s {
            "limit" => Some(PerpOrderType::Limit),
            "market" => Some(PerpOrderType::Market),
            _ => None,
        }
    }
}

/// Status enum — matches the TS literal union and the SQL `text` column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PerpIntentStatus {
    /// Awaiting a match. Set by the API on insert.
    Pending,
    /// Some fills landed; residual remains.
    PartiallyFilled,
    /// Fully filled.
    Filled,
    /// Rejected — typically a validation failure post-insert.
    Rejected,
    /// Past `deadline` at the time the matcher swept it.
    Expired,
    /// Cancelled by the trader before / between fills (CancelOrder
    /// gRPC, or future OrderCancelled event from the contract).
    /// Distinct from `Rejected` (validation failure) and `Expired`
    /// (deadline) so downstream consumers can tell apart the
    /// trader-initiated path from the matcher-initiated ones.
    Canceled,
}

impl PerpIntentStatus {
    /// SQL text representation.
    pub fn as_str(self) -> &'static str {
        match self {
            PerpIntentStatus::Pending => "pending",
            PerpIntentStatus::PartiallyFilled => "partially_filled",
            PerpIntentStatus::Filled => "filled",
            PerpIntentStatus::Rejected => "rejected",
            PerpIntentStatus::Expired => "expired",
            PerpIntentStatus::Canceled => "canceled",
        }
    }

    /// Parse from the SQL text representation.
    pub fn from_db_text(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(PerpIntentStatus::Pending),
            "partially_filled" => Some(PerpIntentStatus::PartiallyFilled),
            "filled" => Some(PerpIntentStatus::Filled),
            "rejected" => Some(PerpIntentStatus::Rejected),
            "expired" => Some(PerpIntentStatus::Expired),
            "canceled" => Some(PerpIntentStatus::Canceled),
            _ => None,
        }
    }
}

/// One row of `perp_order_intents`.
///
/// `size_delta`, `filled_size_delta`, `remaining_size_delta`, `size_usdc`,
/// `price_e18`, `limit_price`, `nonce` are bigints stored as text — same
/// as the TS adapter. Parse to `i128` / `u128` at the call site.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PerpIntent {
    /// `intent_id` primary key (32-byte hex string).
    pub intent_id: String,
    /// Source intent when this row is a residual replacement.
    pub replacement_of: Option<String>,
    /// Chain id (Arc Testnet = 5_042_002).
    pub chain_id: i64,
    /// 0x-prefixed 20-byte trader address.
    pub trader: String,
    /// Market id (bytes32 hex).
    pub market_id: String,
    /// Long / Short.
    pub side: PerpSide,
    /// Notional in USDC quantums (text-encoded bigint).
    pub size_usdc: String,
    /// Contract-native signed sizeDeltaE18 (text-encoded i256).
    pub size_delta: String,
    /// Cumulative filled, same sign as `size_delta`.
    pub filled_size_delta: String,
    /// Remaining, same sign as `size_delta`; 0 when fully filled.
    pub remaining_size_delta: String,
    /// Trader's chosen leverage (integer percent in TS — kept as i64).
    pub leverage: i64,
    /// Limit / Market.
    pub order_type: PerpOrderType,
    /// `priceE18` (text-encoded u256). 0 for market orders.
    pub price_e18: String,
    /// Optional UI limit-price echo. Distinct from `price_e18`.
    pub limit_price: Option<String>,
    /// Mirrors `flags & FLAG_REDUCE_ONLY != 0` (kept as boolean for query ergonomics).
    pub reduce_only: bool,
    /// Mirrors `flags & FLAG_POST_ONLY != 0`.
    pub post_only: bool,
    /// Raw `flags` bitfield, narrows to `uint8` on-chain.
    pub flags: i64,
    /// EIP-712 typed-data hash.
    pub digest: String,
    /// 65-byte signature hex.
    pub signature: String,
    /// Permit2 bitmap index (text-encoded bigint).
    pub nonce: String,
    /// Unix seconds upper bound.
    pub deadline: i64,
    /// Current status.
    pub status: PerpIntentStatus,
    /// Unix seconds.
    pub created_at: i64,
    /// Unix seconds.
    pub updated_at: i64,
}
