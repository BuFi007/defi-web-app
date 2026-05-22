//! Fixed-point price and size newtypes.
//!
//! Wire format mirrors `FxOrderSettlement.SignedOrder` (fx-telarana):
//!   - `priceE18`     uint256 18-dec → in-process `Price(i128)` (signed
//!     for inverse-quote symmetry; widened from i64 so FX cross rates with
//!     headroom for intermediate `price * size` math never overflow).
//!   - `sizeDeltaE18` int256  18-dec → in-process `Size(u128)` after the
//!     matcher-server splits the sign into `Side` at the validator boundary.
//!     u128 spans ~3.4e20 base units; ample for an institutional fill at
//!     18 decimals.
//!
//! Why widen `Price` from `i64` (spec original) to `i128`: most FX rates fit
//! in `i64` (EUR/USD ≈ 1.08e18, USD/JPY ≈ 150e18, all under
//! `i64::MAX ≈ 9.22e18`), but intermediate `price * size` products do not.
//! Spec doc amended in the same commit.

use serde::{Deserialize, Serialize};

/// Decimals on `Price` (18-dec WAD, matches contract `priceE18`).
pub const PRICE_DECIMALS: u32 = 18;

/// Decimals on `Size` (18-dec WAD, matches contract `sizeDeltaE18`).
pub const SIZE_DECIMALS: u32 = 18;

/// Fixed-point price in 18-decimal WAD.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct Price(pub i128);

impl Price {
    /// Construct from raw fixed-point value.
    pub const fn new(raw: i128) -> Self {
        Self(raw)
    }

    /// Raw fixed-point representation.
    pub const fn raw(self) -> i128 {
        self.0
    }

    /// True when `self` would cross against `other` for the given taker side.
    /// Long crosses an ask when `bid >= ask`. Short crosses a bid when `ask <= bid`.
    pub fn crosses(self, other: Price, taker: super::order::Side) -> bool {
        match taker {
            super::order::Side::Long => self.0 >= other.0,
            super::order::Side::Short => self.0 <= other.0,
        }
    }
}

/// Fixed-point size in 18-decimal WAD (magnitude of `sizeDeltaE18`).
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
