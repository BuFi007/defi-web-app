//! Defence-in-depth open-interest gate.
//!
//! Phase 3 decision (locked 2026-05-22): the matcher reads
//! `FxPerpClearinghouse.openInterestLong / openInterestShort /
//! maxOpenInterest` for the target market and rejects a fill that would
//! cross the cap. The contract enforces the same cap on `settleMatch` —
//! this gate just stops us from wasting a tx that would revert.
//!
//! Each fill increases BOTH `openInterestLong` AND `openInterestShort` by
//! the same magnitude (the taker takes one side; the maker held the other
//! side from the prior intent insert). So the post-fill OI ceiling check is
//!
//!   max(long + size, short + size) ≤ cap
//!
//! which simplifies to `max(long, short) + size ≤ cap`.

use alloy_primitives::{B256, U256};
use thiserror::Error;

use bufi_orderbook::Size;
use bufi_perps_onchain::{OiSnapshot, PerpsOnchain, PerpsOnchainError};

/// Errors raised by the OI gate.
#[derive(Debug, Error)]
pub enum OiGateError {
    /// The clearinghouse read itself failed (RPC error).
    #[error("query_oi: {0}")]
    Rpc(#[from] PerpsOnchainError),
    /// Fill rejected — would breach the per-market cap.
    #[error(
        "OI cap breach on market {market}: max(long={long}, short={short}) + size={size} > cap={cap}"
    )]
    CapBreach {
        /// Market id hex.
        market: String,
        /// Long OI in E18.
        long: U256,
        /// Short OI in E18.
        short: U256,
        /// Proposed fill magnitude in E18.
        size: U256,
        /// Configured cap.
        cap: U256,
    },
}

/// Convert an orderbook `Size` (u128, 18-dec) into the `U256` the
/// clearinghouse view returns.
pub fn size_to_u256(size: Size) -> U256 {
    U256::from(size.raw())
}

/// Read OI and reject if a `size`-sized fill would push either side over the cap.
pub async fn check_fill_would_fit(
    onchain: &PerpsOnchain,
    market_id: B256,
    size: Size,
) -> Result<OiSnapshot, OiGateError> {
    let snapshot = onchain.query_oi(market_id).await?;
    let size_u256 = size_to_u256(size);
    let larger = snapshot.long.max(snapshot.short);
    if larger.saturating_add(size_u256) > snapshot.cap {
        return Err(OiGateError::CapBreach {
            market: format!("{market_id:#x}"),
            long: snapshot.long,
            short: snapshot.short,
            size: size_u256,
            cap: snapshot.cap,
        });
    }
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    //! Unit tests for the pure math; the RPC call lives behind the
    //! `live_arc_testnet` integration test.

    use super::*;

    fn snapshot(long: u128, short: u128, cap: u128) -> OiSnapshot {
        OiSnapshot {
            long: U256::from(long),
            short: U256::from(short),
            cap: U256::from(cap),
        }
    }

    fn would_breach(s: OiSnapshot, fill: u128) -> bool {
        let larger = s.long.max(s.short);
        larger.saturating_add(U256::from(fill)) > s.cap
    }

    #[test]
    fn under_cap_passes() {
        assert!(!would_breach(snapshot(100, 50, 1_000), 100));
    }

    #[test]
    fn fill_to_exactly_the_cap_passes() {
        assert!(!would_breach(snapshot(900, 0, 1_000), 100));
    }

    #[test]
    fn one_over_cap_breaches() {
        assert!(would_breach(snapshot(901, 0, 1_000), 100));
    }

    #[test]
    fn larger_side_drives_the_check() {
        // Long is below cap by 50; short is below cap by 150. The larger
        // side (long) is the binding constraint.
        assert!(would_breach(snapshot(950, 850, 1_000), 60));
    }
}
