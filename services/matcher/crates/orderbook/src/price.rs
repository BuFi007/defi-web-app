//! Fixed-point price and size newtypes.
//!
//! `Price` is signed (i64) only because FX corridor markets occasionally
//! quote inverse rates that look negative in the matcher's internal frame.
//! In practice all resting prices are positive; the type just leaves room.
//!
//! `Size` is unsigned u128 — USDC at 6 decimals, no chance of overflow even
//! for institutional fills.

use serde::{Deserialize, Serialize};

/// Price decimals (18-decimal WAD, matches Solidity convention).
pub const PRICE_DECIMALS: u32 = 18;

/// Size decimals (6-decimal USDC quantums).
pub const SIZE_DECIMALS: u32 = 6;

/// Fixed-point price in 18-decimal WAD.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct Price(pub i64);

impl Price {
    /// Construct from raw fixed-point value.
    pub const fn new(raw: i64) -> Self {
        Self(raw)
    }

    /// Raw fixed-point representation.
    pub const fn raw(self) -> i64 {
        self.0
    }

    /// True when this price would cross against `other` for the given taker side.
    /// Buy crosses an ask when bid >= ask. Sell crosses a bid when ask <= bid.
    pub fn crosses(self, other: Price, taker: super::order::Side) -> bool {
        match taker {
            super::order::Side::Long => self.0 >= other.0,
            super::order::Side::Short => self.0 <= other.0,
        }
    }
}

/// Fixed-point size in 6-decimal USDC quantums.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct Size(pub u128);

impl Size {
    /// Construct from raw fixed-point value.
    pub const fn new(raw: u128) -> Self {
        Self(raw)
    }

    /// Raw fixed-point representation.
    pub const fn raw(self) -> u128 {
        self.0
    }

    /// True when size is zero.
    pub const fn is_zero(self) -> bool {
        self.0 == 0
    }

    /// Saturating subtraction.
    pub fn saturating_sub(self, rhs: Size) -> Size {
        Size(self.0.saturating_sub(rhs.0))
    }
}
