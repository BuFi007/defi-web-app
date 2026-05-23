//! Pure-compute LP gate.
//!
//! Phase 6 — refactors the pure parts of `matcher-server::lp_router` into
//! a deterministic function the orderbook crate can proptest. Combines
//! invariants 1, 3, 4, 5, 7, 8, 10 into a single pass that takes already-
//! materialised inputs (oracle snapshot, OI snapshot, LP snapshot) and
//! returns either a quoted fill price + the per-side delta the LP would
//! take, or a typed denial.
//!
//! The RPC reads (`query_oi`, `oracle_snapshot`) and the signing
//! (`lp_signer.sign_lp_order`) stay in `matcher-server` because they
//! touch the network / hold a private key. This function is the audit
//! surface for the in-process invariants.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::lp::{check_basic_gate, check_delta_cap, quote_price, spread_bps, LpConfig, LpDeny, LpSnapshot};
use crate::order::Side;
use crate::price::{Price, Size};

/// Oracle snapshot in pure-compute form — mirrors `bufi_perps_onchain::OracleSnapshot`
/// but with no `B256` dependency so the orderbook crate stays lean.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct OracleView {
    /// Mark price in 18-decimal WAD (cast to i128 — see Phase 2a widening note).
    pub mark_e18: i128,
    /// Unix seconds when the oracle was last published.
    pub published_at_secs: u64,
}

/// OI snapshot in pure-compute form — mirrors `bufi_perps_onchain::OiSnapshot`.
///
/// Unit note: the on-chain `FxPerpClearinghouse.openInterest{Long,Short}`
/// and `maxOpenInterest` are stored as **USDC notional in 6-decimal
/// quantums** (`notional = priceE18 * sizeDeltaE18 / 1e18` per
/// `FxPerpClearinghouse._applyIncrease`), NOT base-token WAD. The
/// earlier field names (`*_e18`) lied about this and caused the LP
/// gate's invariant 1 comparison to be off by ~1e12 — caught during
/// the Step 3 dogfood when a 0.1-EUR fill (1e17 base WAD) tripped a
/// 1000-USDC cap (1e9 quantums) as if it were 1e17 USDC notional.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct OiView {
    /// `openInterestLong`, USDC notional in 6-dec quantums.
    pub long_usdc_e6: u128,
    /// `openInterestShort`, USDC notional in 6-dec quantums.
    pub short_usdc_e6: u128,
    /// `maxOpenInterest`, USDC notional in 6-dec quantums.
    pub cap_usdc_e6: u128,
}

/// Maximum seconds the oracle may lag before invariant 4 trips. Locked at
/// 30s per `docs/lp-backstop-design.md` §Locked decisions.
pub const ORACLE_MAX_AGE_SECS: u64 = 30;

/// Typed denial reasons. Mirrors the in-process invariants the LP gate enforces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error, Serialize, Deserialize)]
pub enum LpGateDeny {
    /// Invariant 8 + 10 — LP disabled or per-intent size cap exceeded.
    #[error("basic gate: {0}")]
    Basic(#[from] LpDeny),
    /// Invariant 4 — `oracle.published_at_secs + ORACLE_MAX_AGE_SECS < now_secs`.
    #[error("oracle stale: published_at={published_at_secs} vs now={now_secs}")]
    OracleStale {
        /// When the oracle last published.
        published_at_secs: u64,
        /// The matcher clock.
        now_secs: u64,
    },
    /// Invariant 1 — adding `size` to the larger OI side breaches the cap.
    #[error("OI cap breach: max(long={long}, short={short}) + size={size} > cap={cap}")]
    OiCapBreach {
        /// `openInterestLong` snapshot.
        long: u128,
        /// `openInterestShort` snapshot.
        short: u128,
        /// Proposed fill magnitude.
        size: u128,
        /// Configured cap.
        cap: u128,
    },
}

/// Result of an accepted LP gate pass — the matcher-server then signs +
/// settles. All values are deterministic functions of the inputs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LpQuote {
    /// Price the LP quotes for this fill (in the taker-unfavourable direction).
    pub price: Price,
    /// Spread applied to mark, in basis points.
    pub spread_bps: u32,
}

/// Pure-compute LP gate. No IO, no clock — inputs in, outcome out.
/// Caller materialises `oracle` and `oi` from RPC; the rest is pure.
pub fn pure_check(
    snapshot: &LpSnapshot,
    cfg: &LpConfig,
    oracle: &OracleView,
    oi: &OiView,
    taker_side: Side,
    residual_size: Size,
    now_secs: u64,
) -> Result<LpQuote, LpGateDeny> {
    // 1. Invariant 10 (disabled) + 8 (per-intent cap).
    check_basic_gate(snapshot, cfg, residual_size)?;

    // 2. Invariant 4 (oracle freshness).
    if oracle.published_at_secs + ORACLE_MAX_AGE_SECS < now_secs {
        return Err(LpGateDeny::OracleStale {
            published_at_secs: oracle.published_at_secs,
            now_secs,
        });
    }

    // 3. Invariant 1 (OI cap). The on-chain `openInterest{Long,Short}`
    // and `maxOpenInterest` are stored as USDC notional in 6-dec
    // quantums — the matcher's `residual_size` is base-token WAD
    // (18-dec). Convert the residual to USDC notional using the
    // oracle mark before comparing.
    let mark_u128: u128 = oracle.mark_e18.max(0) as u128;
    let fill_notional_usdc_e6 = base_wad_to_usdc_e6(residual_size.raw(), mark_u128);
    let larger = oi.long_usdc_e6.max(oi.short_usdc_e6);
    if larger.saturating_add(fill_notional_usdc_e6) > oi.cap_usdc_e6 {
        return Err(LpGateDeny::OiCapBreach {
            long: oi.long_usdc_e6,
            short: oi.short_usdc_e6,
            size: fill_notional_usdc_e6,
            cap: oi.cap_usdc_e6,
        });
    }

    // 4. Invariant 3 + 5 (delta cap + reduce-only).
    check_delta_cap(snapshot, cfg, taker_side, residual_size)?;

    // 5. Invariant 7 (size-dependent spread). Computes the quote.
    let bps = spread_bps(snapshot, cfg, residual_size);
    let price = quote_price(Price::new(oracle.mark_e18), taker_side, bps);

    Ok(LpQuote {
        price,
        spread_bps: bps,
    })
}

/// Convert a base-token magnitude in 18-dec WAD + a mark price in 18-dec
/// WAD into USDC notional in 6-dec quantums:
///
///   `notional_usdc_e6 = size_e18 * mark_e18 / 1e30`
///
/// (`/ 1e18` to consume the mark's WAD scaling, then `/ 1e12` to drop
/// from 18-dec to 6-dec USDC.)
///
/// We can't `size * mark` directly into u128 — the product overflows
/// above ~3.4e8 USDC notional. Split each operand by 1e15 first so the
/// intermediate product stays in u128. The precision floor is 1e-3 of
/// a base unit × 1e-3 of the mark, which is well below USDC's own 1e-6
/// precision — no meaningful loss for any realistic intent size.
///
/// Saturating semantics — overflow returns `u128::MAX` and trips the
/// OI cap, which is the conservative direction (block the fill rather
/// than silently shrink it). Matches `FxPerpClearinghouse._applyIncrease`'s
/// `notional = priceE18 * sizeDeltaE18 / 1e18` (then USDC-rounded).
fn base_wad_to_usdc_e6(size_e18: u128, mark_e18: u128) -> u128 {
    let s = size_e18 / 1_000_000_000_000_000u128; // /1e15
    let m = mark_e18 / 1_000_000_000_000_000u128; // /1e15
    s.saturating_mul(m)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    const E18: u128 = 1_000_000_000_000_000_000;
    const TVL_1M_USDC: u128 = 1_000_000 * 1_000_000;

    fn snap(long: u128, short: u128, enabled: bool) -> LpSnapshot {
        LpSnapshot {
            market_id: [0; 32],
            tvl_usdc_e6: TVL_1M_USDC,
            long_e18: long,
            short_e18: short,
            avg_intent_size_e18: 10 * E18,
            enabled,
        }
    }

    fn oi(long: u128, short: u128, cap: u128) -> OiView {
        OiView {
            long_usdc_e6: long,
            short_usdc_e6: short,
            cap_usdc_e6: cap,
        }
    }

    const USDC: u128 = 1_000_000; // 6-dec USDC quantums

    fn fresh_oracle() -> OracleView {
        OracleView {
            mark_e18: E18 as i128, // 1.0 WAD
            published_at_secs: 1_700_000_000,
        }
    }

    const NOW: u64 = 1_700_000_000;

    // With fresh_oracle (mark=1.0 WAD) the conversion is:
    //   notional_usdc_e6 = size_e18 / 1e12 = 1 USDC quantum per 1e12 base WAD
    // So 1 unit base (1e18 WAD) → 1_000_000 quantums = 1 USDC notional.

    #[test]
    fn fresh_path_accepts() {
        let r = pure_check(
            &snap(0, 0, true),
            &LpConfig::default(),
            &fresh_oracle(),
            &oi(0, 0, 100 * USDC), // 100 USDC cap
            Side::Long,
            Size::new(E18), // 1 unit base @ mark 1.0 = 1 USDC notional
            NOW,
        );
        assert!(r.is_ok(), "expected accept; got {r:?}");
    }

    #[test]
    fn stale_oracle_rejects() {
        let mut o = fresh_oracle();
        o.published_at_secs = NOW - 1_000;
        let r = pure_check(
            &snap(0, 0, true),
            &LpConfig::default(),
            &o,
            &oi(0, 0, 100 * USDC),
            Side::Long,
            Size::new(E18),
            NOW,
        );
        assert!(matches!(r, Err(LpGateDeny::OracleStale { .. })));
    }

    #[test]
    fn oi_cap_breach_rejects() {
        let r = pure_check(
            &snap(0, 0, true),
            &LpConfig::default(),
            &fresh_oracle(),
            // Cap 100 USDC, 99 USDC long already, adding 2 USDC → 101 > 100.
            &oi(99 * USDC, 0, 100 * USDC),
            Side::Long,
            Size::new(2 * E18),
            NOW,
        );
        assert!(matches!(r, Err(LpGateDeny::OiCapBreach { .. })));
    }

    #[test]
    fn base_wad_to_usdc_e6_at_unit_mark() {
        // mark=1.0 (1e18 WAD), 1 base unit (1e18) → 1 USDC (1e6 quantums).
        assert_eq!(base_wad_to_usdc_e6(E18, E18), USDC);
        // 0.1 base @ 1.0 → 0.1 USDC.
        assert_eq!(base_wad_to_usdc_e6(E18 / 10, E18), USDC / 10);
    }

    #[test]
    fn base_wad_to_usdc_e6_at_non_unit_mark() {
        // mark=1.15 EUR/USD, 100 EUR → 115 USDC notional.
        let mark_115 = 1_150_000_000_000_000_000u128; // 1.15 WAD
        assert_eq!(base_wad_to_usdc_e6(100 * E18, mark_115), 115 * USDC);
    }

    proptest! {
        /// Determinism: same inputs ⇒ same outputs, always.
        #[test]
        fn pure_check_is_deterministic(
            long_e18 in 0u128..(10 * E18),
            short_e18 in 0u128..(10 * E18),
            fill_e18 in 1u128..(100_000 * E18),
            mark_e18 in (E18 / 10)..(10 * E18),
            now_secs in 0u64..(u64::MAX / 2),
            // Constrain oracle age to be well within the 30s gate by default;
            // we test the stale-rejection path separately.
            oracle_age in 0u64..ORACLE_MAX_AGE_SECS,
        ) {
            let snapshot = snap(long_e18, short_e18, true);
            let oracle = OracleView {
                mark_e18: mark_e18 as i128,
                published_at_secs: now_secs.saturating_sub(oracle_age),
            };
            let oi_view = oi(long_e18, short_e18, u128::MAX);
            let cfg = LpConfig::default();
            let r1 = pure_check(&snapshot, &cfg, &oracle, &oi_view, Side::Long, Size::new(fill_e18), now_secs);
            let r2 = pure_check(&snapshot, &cfg, &oracle, &oi_view, Side::Long, Size::new(fill_e18), now_secs);
            prop_assert_eq!(r1, r2);
        }

        /// Invariant 7 (spread monotone in size) — independent property
        /// confirming the spread function is well-behaved over a random
        /// range of inputs the LP gate consumes.
        #[test]
        fn spread_monotone_in_size(
            small in 1u128..(E18),
            extra in 1u128..(100 * E18),
        ) {
            let s = snap(0, 0, true);
            let cfg = LpConfig::default();
            let spread_small = spread_bps(&s, &cfg, Size::new(small));
            let spread_big = spread_bps(&s, &cfg, Size::new(small.saturating_add(extra)));
            prop_assert!(spread_big >= spread_small);
        }

        /// Invariant 4 (oracle freshness gate) trips precisely at the
        /// boundary — `age == max` accepts, `age == max + 1` rejects.
        #[test]
        fn oracle_freshness_boundary(
            now_secs in (ORACLE_MAX_AGE_SECS + 1)..(u64::MAX / 2),
        ) {
            let snapshot = snap(0, 0, true);
            let cfg = LpConfig::default();
            let oi_view = oi(0, 0, u128::MAX);

            let at_edge = OracleView {
                mark_e18: E18 as i128,
                published_at_secs: now_secs - ORACLE_MAX_AGE_SECS,
            };
            let just_over = OracleView {
                mark_e18: E18 as i128,
                published_at_secs: now_secs - ORACLE_MAX_AGE_SECS - 1,
            };
            let r_edge = pure_check(&snapshot, &cfg, &at_edge, &oi_view, Side::Long, Size::new(E18), now_secs);
            let r_over = pure_check(&snapshot, &cfg, &just_over, &oi_view, Side::Long, Size::new(E18), now_secs);
            prop_assert!(r_edge.is_ok(), "edge case (age == max) must accept");
            let stale = matches!(r_over, Err(LpGateDeny::OracleStale { .. }));
            prop_assert!(stale);
        }
    }
}
