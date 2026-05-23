//! LP backstop primitives — pure types + math-only invariants.
//!
//! Per Phase 4a (`docs/lp-backstop-design.md`), this crate owns the
//! topology-agnostic primitives. The orderbook is and stays pure: no IO,
//! no clock, no RNG, no floats. Anything that requires reading on-chain
//! state, calling an RPC, or carrying mutable LP balances lives in
//! `crates/matcher-server/src/lp_router.rs`.
//!
//! The `LpStateView` trait abstracts the LP-state read surface so the
//! router can ship against either topology:
//!
//!   - **Path A** — synthetic in-matcher LP. `LpStateView` impl reads
//!     from the matcher's local `lp_positions` SQLite table + an
//!     in-memory snapshot.
//!   - **Path B** — on-chain `FxPerpLpVault`. `LpStateView` impl reads
//!     from `FxPerpLpVault.position(market_id)` via the alloy bindings.
//!
//! Path A ships first per the locked design (Option C hybrid). The swap
//! to Path B is intended to be one impl-change in matcher-server; no
//! orderbook changes.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::order::{MarketId, Side};
use crate::price::{Price, Size};

// ---------------------------------------------------------------------------
// Configuration — per-market, set at boot or via admin.
// ---------------------------------------------------------------------------

/// Per-market LP parameters. Defaults come from the locked Phase 4a
/// design decisions; per-market overrides land via `LpConfig::for_market`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LpConfig {
    /// `lp_delta_limit` as a fraction of LP TVL, in basis points.
    /// Locked default: **2500** (= 25%).
    pub delta_limit_bps: u32,
    /// `max_lp_fill_per_intent` as a fraction of LP TVL, in basis points.
    /// Locked default: **1000** (= 10%).
    pub max_fill_per_intent_bps: u32,
    /// Base LP spread in basis points of mark.
    /// Strawman default: **5** (= 0.05%).
    pub base_spread_bps: u32,
    /// Size penalty: extra bps per "size unit" where one unit is
    /// `avg_24h_volume_per_intent`. Tuned per market; default **3** bps/unit.
    pub size_penalty_bps_per_unit: u32,
    /// Insurance-fund burn floor in USDC quantums (6-dec). Loss events
    /// below this don't burn IF shares.
    /// Locked default: **10_000_000_000** (= 10_000 USDC at 6-dec).
    pub if_burn_floor_usdc_e6: u128,
    /// Reduce-only cap as a fraction of `delta_limit_bps`. When current
    /// `|lp_delta| >= reduce_only_threshold_bps × delta_limit / 10000`,
    /// LP serves only reduce-only fills. Locked default: **9500** (= 95%).
    pub reduce_only_threshold_bps: u32,
}

impl Default for LpConfig {
    fn default() -> Self {
        Self {
            delta_limit_bps: 2_500,
            max_fill_per_intent_bps: 1_000,
            base_spread_bps: 5,
            size_penalty_bps_per_unit: 3,
            if_burn_floor_usdc_e6: 10_000_000_000,
            reduce_only_threshold_bps: 9_500,
        }
    }
}

// ---------------------------------------------------------------------------
// State view — read-only abstraction the router consumes.
// ---------------------------------------------------------------------------

/// Snapshot of the LP's state for a single market at one instant.
/// Returned by `LpStateView::snapshot`. All values are 18-dec WAD
/// magnitudes; the LP's net delta is `long_e18 - short_e18`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LpSnapshot {
    /// Market this snapshot belongs to.
    pub market_id: MarketId,
    /// LP TVL in 6-dec USDC quantums.
    pub tvl_usdc_e6: u128,
    /// LP's long-side notional, 18-dec WAD.
    pub long_e18: u128,
    /// LP's short-side notional, 18-dec WAD.
    pub short_e18: u128,
    /// LP's average 24h per-intent volume in 18-dec WAD. Used to
    /// normalise the size-penalty spread.
    /// `0` means "no recent history" → the spread function falls back to
    /// `base_spread_bps` only.
    pub avg_intent_size_e18: u128,
    /// Whether the LP is currently enabled to take this market's flow.
    /// Wraps invariant 10 (market-status veto). Path A toggles this in
    /// `lp_positions`; Path B reads from `FxPerpLpVault.lpEnabled(market_id)`.
    pub enabled: bool,
}

/// Read-only abstraction. The router consumes this trait; Path A + Path B
/// each provide an impl.
#[allow(async_fn_in_trait)]
pub trait LpStateView {
    /// Read the current LP snapshot for `market_id`. May perform IO
    /// (matcher-server impls). Returns `None` if the market has no LP
    /// configured.
    async fn snapshot(&self, market_id: MarketId) -> Option<LpSnapshot>;

    /// Per-market config. Pure read; should NOT perform IO on the hot
    /// path (cache at boot).
    fn config(&self, market_id: MarketId) -> LpConfig;
}

// ---------------------------------------------------------------------------
// Pure invariants — math only, no IO, no clock.
// ---------------------------------------------------------------------------

/// Reasons an LP quote can be denied. The router maps these to
/// per-invariant rejection reasons in its outer error type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error, Serialize, Deserialize)]
pub enum LpDeny {
    /// Invariant 10 — LP disabled / market paused for LP.
    #[error("LP disabled for this market")]
    Disabled,
    /// Invariant 8 — fill exceeds the per-intent size cap.
    #[error("fill {requested_e18} > per-intent cap {cap_e18}")]
    FillSizeCap {
        /// Requested fill magnitude, E18.
        requested_e18: u128,
        /// Configured cap, E18.
        cap_e18: u128,
    },
    /// Invariant 3 — fill would push `|lp_delta|` over the cap.
    #[error(
        "LP delta cap breach: predicted_abs={predicted_abs_e18} > limit={limit_e18}"
    )]
    DeltaCap {
        /// Post-fill `|long - short|`, E18.
        predicted_abs_e18: u128,
        /// Configured limit, E18.
        limit_e18: u128,
    },
    /// Invariant 5 — LP is in reduce-only mode and this fill grows
    /// rather than reduces the position.
    #[error("LP in reduce-only mode; fill would grow position")]
    ReduceOnlyBreach,
}

/// Multiply a USDC-6dec TVL by a `bps` fraction, then convert to a
/// quantity expressed in 18-dec WAD. Used to derive E18 caps from
/// `tvl_usdc_e6` config knobs.
///
/// Conversion: `tvl_usdc_e6 × 10^12 = tvl_in_e18` (USDC quantums to WAD).
/// Then `× bps / 10_000` for the fraction.
fn bps_of_tvl_in_e18(tvl_usdc_e6: u128, bps: u32) -> u128 {
    // u128 holds the full intermediate even at tvl=u64::MAX × 1e12.
    tvl_usdc_e6
        .saturating_mul(1_000_000_000_000u128)
        .saturating_mul(bps as u128)
        / 10_000u128
}

/// Invariant 10 + 8: cheap pre-quote gate. Pure compute, no state read.
pub fn check_basic_gate(
    snapshot: &LpSnapshot,
    cfg: &LpConfig,
    requested_e18: Size,
) -> Result<(), LpDeny> {
    if !snapshot.enabled {
        return Err(LpDeny::Disabled);
    }
    let cap_e18 = bps_of_tvl_in_e18(snapshot.tvl_usdc_e6, cfg.max_fill_per_intent_bps);
    if requested_e18.raw() > cap_e18 {
        return Err(LpDeny::FillSizeCap {
            requested_e18: requested_e18.raw(),
            cap_e18,
        });
    }
    Ok(())
}

/// Invariant 3 + 5: post-fill delta cap check + reduce-only enforcement.
/// `taker_side` is the taker's side; the LP takes the OPPOSITE side.
pub fn check_delta_cap(
    snapshot: &LpSnapshot,
    cfg: &LpConfig,
    taker_side: Side,
    fill_size_e18: Size,
) -> Result<(), LpDeny> {
    let limit_e18 = bps_of_tvl_in_e18(snapshot.tvl_usdc_e6, cfg.delta_limit_bps);
    let reduce_only_threshold_e18 =
        limit_e18.saturating_mul(cfg.reduce_only_threshold_bps as u128) / 10_000u128;

    // Current LP signed delta (long - short). Positive = LP is net long.
    let cur_long = snapshot.long_e18 as i128;
    let cur_short = snapshot.short_e18 as i128;
    let cur_delta: i128 = cur_long - cur_short;
    let cur_abs: u128 = cur_delta.unsigned_abs();

    // LP takes opposite side to taker.
    let lp_takes = taker_side.opposite();
    let fill = fill_size_e18.raw() as i128;
    let delta_change: i128 = match lp_takes {
        Side::Long => fill,
        Side::Short => -fill,
    };
    let new_delta = cur_delta + delta_change;
    let new_abs: u128 = new_delta.unsigned_abs();

    // Reduce-only check (invariant 5).
    let reduce_only_active = cur_abs >= reduce_only_threshold_e18;
    let reduces = new_abs < cur_abs;
    if reduce_only_active && !reduces {
        return Err(LpDeny::ReduceOnlyBreach);
    }

    // Delta cap (invariant 3).
    if new_abs > limit_e18 {
        return Err(LpDeny::DeltaCap {
            predicted_abs_e18: new_abs,
            limit_e18,
        });
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Invariant 7 — size-dependent LP spread.
// ---------------------------------------------------------------------------

/// Compute the LP's quoted spread (in basis points of mark) for a fill of
/// `fill_size_e18`. The function is pure: identical inputs → identical
/// outputs, no clock, no state outside the snapshot.
///
/// Formula:
///   spread_bps = base_spread_bps + size_penalty_bps_per_unit × (fill / avg_intent_size)
///
/// `avg_intent_size_e18 == 0` (no history) collapses to `base_spread_bps`.
pub fn spread_bps(snapshot: &LpSnapshot, cfg: &LpConfig, fill_size_e18: Size) -> u32 {
    if snapshot.avg_intent_size_e18 == 0 {
        return cfg.base_spread_bps;
    }
    let units_x100 = fill_size_e18
        .raw()
        .saturating_mul(100)
        .checked_div(snapshot.avg_intent_size_e18)
        .unwrap_or(0);
    // size_penalty_bps_per_unit × units, where units_x100 / 100 = units.
    let extra = (cfg.size_penalty_bps_per_unit as u128)
        .saturating_mul(units_x100)
        / 100u128;
    let extra_u32: u32 = extra.try_into().unwrap_or(u32::MAX);
    cfg.base_spread_bps.saturating_add(extra_u32)
}

/// Apply a spread (in bps) to `mark` to produce the LP's quoted price for
/// the given taker side. LP quotes WORSE than mark for the taker — i.e.,
/// higher than mark when taker is Long, lower when taker is Short.
pub fn quote_price(mark: Price, taker_side: Side, spread_bps: u32) -> Price {
    let mark_raw = mark.raw();
    // signed: positive when LP charges more (taker buys at higher), negative when LP charges less.
    let delta = mark_raw
        .saturating_mul(spread_bps as i128)
        / 10_000i128;
    match taker_side {
        Side::Long => Price::new(mark_raw.saturating_add(delta)),
        Side::Short => Price::new(mark_raw.saturating_sub(delta)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::order::Side;

    fn snap(tvl_usdc: u128, long: u128, short: u128, enabled: bool) -> LpSnapshot {
        LpSnapshot {
            market_id: [0; 32],
            tvl_usdc_e6: tvl_usdc,
            long_e18: long,
            short_e18: short,
            avg_intent_size_e18: 10 * E18,
            enabled,
        }
    }

    const E18: u128 = 1_000_000_000_000_000_000;
    /// 1_000_000 USDC at 6-dec quantums.
    const TVL_1M: u128 = 1_000_000 * 1_000_000;
    /// 10% of 1M USDC TVL, in 18-dec WAD = 100_000e18.
    const TEN_PCT_E18: u128 = 100_000 * E18;
    /// 25% of 1M USDC TVL, in 18-dec WAD = 250_000e18.
    const TWENTY_FIVE_PCT_E18: u128 = 250_000 * E18;

    #[test]
    fn bps_of_tvl_matches_locked_defaults() {
        assert_eq!(bps_of_tvl_in_e18(TVL_1M, 2_500), TWENTY_FIVE_PCT_E18);
        assert_eq!(bps_of_tvl_in_e18(TVL_1M, 1_000), TEN_PCT_E18);
    }

    #[test]
    fn basic_gate_blocks_disabled() {
        let s = snap(TVL_1M, 0, 0, false);
        let r = check_basic_gate(&s, &LpConfig::default(), Size::new(1));
        assert!(matches!(r, Err(LpDeny::Disabled)));
    }

    #[test]
    fn basic_gate_blocks_over_per_intent_cap() {
        let s = snap(TVL_1M, 0, 0, true);
        // Locked default cap = 10% of 1M USDC = 100k_e18. Try 100k_e18 + 1.
        let r = check_basic_gate(&s, &LpConfig::default(), Size::new(TEN_PCT_E18 + 1));
        assert!(matches!(r, Err(LpDeny::FillSizeCap { .. })));
    }

    #[test]
    fn basic_gate_accepts_at_exact_cap() {
        let s = snap(TVL_1M, 0, 0, true);
        let r = check_basic_gate(&s, &LpConfig::default(), Size::new(TEN_PCT_E18));
        assert!(r.is_ok());
    }

    #[test]
    fn delta_cap_blocks_growing_past_limit() {
        // LP is already at the cap; growing further must reject.
        let s = snap(TVL_1M, TWENTY_FIVE_PCT_E18, 0, true);
        let cfg = LpConfig::default();
        // Taker Short → LP takes Long → would push LP delta from +25% to >25%.
        let r = check_delta_cap(&s, &cfg, Side::Short, Size::new(E18));
        assert!(matches!(r, Err(LpDeny::ReduceOnlyBreach) | Err(LpDeny::DeltaCap { .. })));
    }

    #[test]
    fn delta_cap_allows_reducing_when_in_reduce_only() {
        // LP at 96% of cap → reduce-only active (threshold 95%).
        let near_cap = (TWENTY_FIVE_PCT_E18 * 96) / 100;
        let s = snap(TVL_1M, near_cap, 0, true);
        let cfg = LpConfig::default();
        // Taker Long → LP takes Short → reduces LP long delta.
        let r = check_delta_cap(&s, &cfg, Side::Long, Size::new(E18));
        assert!(r.is_ok(), "reduce-only must allow reducing fills");
    }

    #[test]
    fn delta_cap_blocks_growing_when_in_reduce_only() {
        let near_cap = (TWENTY_FIVE_PCT_E18 * 96) / 100;
        let s = snap(TVL_1M, near_cap, 0, true);
        let cfg = LpConfig::default();
        // Taker Short → LP takes Long → grows LP long delta further.
        let r = check_delta_cap(&s, &cfg, Side::Short, Size::new(E18));
        assert!(matches!(r, Err(LpDeny::ReduceOnlyBreach)));
    }

    #[test]
    fn spread_base_only_when_no_history() {
        let mut s = snap(TVL_1M, 0, 0, true);
        s.avg_intent_size_e18 = 0;
        let cfg = LpConfig::default();
        assert_eq!(spread_bps(&s, &cfg, Size::new(E18)), cfg.base_spread_bps);
    }

    #[test]
    fn spread_grows_with_size() {
        let s = snap(TVL_1M, 0, 0, true);
        let cfg = LpConfig::default();
        let small = spread_bps(&s, &cfg, Size::new(E18));
        let big = spread_bps(&s, &cfg, Size::new(100 * E18));
        assert!(big > small, "size-penalty must widen spread monotonically");
    }

    #[test]
    fn quote_price_walks_against_taker() {
        let mark = Price::new(2 * E18 as i128);
        // Taker Long pays MORE than mark.
        let q_long = quote_price(mark, Side::Long, 100); // 1% spread
        // Taker Short receives LESS than mark.
        let q_short = quote_price(mark, Side::Short, 100);
        assert!(q_long.raw() > mark.raw());
        assert!(q_short.raw() < mark.raw());
    }
}
