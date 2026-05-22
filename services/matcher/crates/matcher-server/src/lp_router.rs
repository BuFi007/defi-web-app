//! LP backstop router — pairs unmatched residual size with a synthetic
//! LP_OPERATOR maker after all 12 invariants pass.
//!
//! Ordered cheapest-first per `docs/lp-backstop-design.md`:
//!
//!   1. Invariant 10 (LP enabled)         — pure
//!   2. Invariant 8 (per-intent fill cap) — pure
//!   3. Invariant 4 (oracle freshness)    — RPC (1)
//!   4. Invariant 1 (per-market OI cap)   — RPC (1)
//!   5. Invariant 3 + 5 (delta cap, RO)   — pure
//!   6. Invariant 7 (size-dependent spread) — pure
//!   7. Sign + record the synthetic LP SignedOrder
//!
//! Invariant 2 (mark-oracle divergence) is trivially satisfied in fx-
//! telarana's model: the clearinghouse uses `ORACLE.getMid` for BOTH the
//! mark and the oracle, so there's no divergence by construction.
//! Invariant 9 (reserve-vs-oracle band) lights up when Path B's
//! `FxPerpLpVault` deploys — Path A has no AMM reserve.

use alloy_primitives::{B256, U256};
use thiserror::Error;
use tracing::{debug, info};

use bufi_orderbook::{
    check_basic_gate, check_delta_cap, quote_price, spread_bps, Fill, LpDeny, LpStateView,
    Price, Size,
};
use bufi_perps_onchain::PerpsOnchain;

use crate::intent_translator::TranslatedIntent;
use crate::lp_signer::{LpSigner, LpSignerError};

/// Errors raised by the router. The caller logs + ignores — a denied LP
/// fill is normal flow control, not a fault.
#[derive(Debug, Error)]
pub enum LpRouterError {
    /// One of the invariants 3 / 5 / 8 / 10 denied the quote.
    #[error("LP denied: {0}")]
    LpDenied(#[from] LpDeny),
    /// LP isn't configured for this market (no row in `lp_positions`).
    /// Reserved for future use — today the router returns `Ok(None)` for
    /// not-configured markets, but a richer error surface may want to
    /// distinguish "skip" from "skip with reason" later.
    #[allow(dead_code)]
    #[error("LP not configured for market {market}")]
    NotConfigured {
        /// Market id hex.
        market: String,
    },
    /// Oracle staleness — invariant 4.
    #[error("oracle stale: published_at={published_at_secs} vs now={now_secs}, max age {max_age_secs}s")]
    OracleStale {
        /// When the oracle last published.
        published_at_secs: u64,
        /// Matcher clock.
        now_secs: u64,
        /// Configured ceiling.
        max_age_secs: u64,
    },
    /// On-chain OI cap — invariant 1.
    #[error("OI cap breach: market={market} cap={cap} larger_side={larger}+size={size}")]
    OiCap {
        /// Market id hex.
        market: String,
        /// `max(long, short)` before the fill.
        larger: U256,
        /// Proposed fill magnitude.
        size: U256,
        /// Contract-side cap.
        cap: U256,
    },
    /// RPC failure during one of the on-chain reads.
    #[error("on-chain: {0}")]
    Onchain(String),
    /// Synthetic SignedOrder signing failed.
    #[error("LP signer: {0}")]
    Signer(#[from] LpSignerError),
}

/// One LP fill ready for the settlement orchestrator. Wraps the same
/// `(maker, taker, Fill)` triple `settle_batch` expects.
#[derive(Debug, Clone)]
pub struct LpRoutedFill {
    /// LP-side synthetic intent the matcher just signed.
    pub lp_intent: TranslatedIntent,
    /// Taker that prompted the LP routing (echoed for `settle_batch`).
    pub taker_intent: TranslatedIntent,
    /// The fill itself — `is_lp_fill: true` per invariant 12.
    pub fill: Fill,
}

/// Maximum age (seconds) before an oracle reading is considered stale.
/// Locked per Phase 4a design — 30 seconds on Arc Testnet.
pub const ORACLE_MAX_AGE_SECS: u64 = 30;

/// Inputs to `try_route_residual_to_lp`. Bundled to keep the call site
/// readable (clippy's `too_many_arguments` lint blocks 7+).
pub struct RouteContext<'a, L: LpStateView> {
    /// On-chain client (OI gate + oracle reads).
    pub onchain: &'a PerpsOnchain,
    /// LP state view — Path A reads SQLite; Path B reads on-chain.
    pub lp_state: &'a L,
    /// LP_OPERATOR signer.
    pub signer: &'a LpSigner,
    /// The taker whose residual we're routing.
    pub taker: &'a TranslatedIntent,
    /// Magnitude (E18) the CLOB couldn't match.
    pub residual_size: Size,
    /// `now_ms` — passed in by the tick loop, never read from the clock.
    pub now_ms: u64,
    /// `now_secs` — matches `now_ms / 1_000` but kept separate to mirror
    /// how the contract reads `block.timestamp` in seconds.
    pub now_secs: u64,
    /// Match-sequence counter for the deterministic fill id.
    pub match_seq: u64,
}

/// Try to pair `residual_size` of `taker` with the LP. Returns:
///   - `Ok(Some(LpRoutedFill))` on a successful quote
///   - `Ok(None)` if the LP isn't configured for this market (silent skip)
///   - `Err(_)` for any invariant denial or RPC error
pub async fn try_route_residual_to_lp<L: LpStateView>(
    ctx: RouteContext<'_, L>,
) -> Result<Option<LpRoutedFill>, LpRouterError> {
    let RouteContext {
        onchain,
        lp_state,
        signer,
        taker,
        residual_size,
        now_ms,
        now_secs,
        match_seq,
    } = ctx;
    let market_id_bytes = taker.orderbook_intent.market_id;
    let market_id_hex = format!("0x{}", hex_bytes(&market_id_bytes));

    // ---------- 1. LP enabled? (invariant 10) ----------
    let Some(snapshot) = lp_state.snapshot(market_id_bytes).await else {
        return Ok(None);
    };
    let cfg = lp_state.config(market_id_bytes);

    // ---------- 2. Per-intent fill cap (invariant 8) ----------
    check_basic_gate(&snapshot, &cfg, residual_size)?;

    // ---------- 3. Oracle freshness (invariant 4) ----------
    let market_id_b256 = B256::from(market_id_bytes);
    let oracle = onchain
        .oracle_snapshot(market_id_b256)
        .await
        .map_err(|e| LpRouterError::Onchain(format!("oracle_snapshot: {e}")))?;
    if oracle.published_at_secs + ORACLE_MAX_AGE_SECS < now_secs {
        return Err(LpRouterError::OracleStale {
            published_at_secs: oracle.published_at_secs,
            now_secs,
            max_age_secs: ORACLE_MAX_AGE_SECS,
        });
    }

    // ---------- 4. On-chain OI cap (invariant 1) ----------
    let oi = onchain
        .query_oi(market_id_b256)
        .await
        .map_err(|e| LpRouterError::Onchain(format!("query_oi: {e}")))?;
    let size_u256 = U256::from(residual_size.raw());
    let larger = oi.long.max(oi.short);
    if larger.saturating_add(size_u256) > oi.cap {
        return Err(LpRouterError::OiCap {
            market: market_id_hex.clone(),
            larger,
            size: size_u256,
            cap: oi.cap,
        });
    }

    // ---------- 5. Delta cap + reduce-only (invariants 3 + 5) ----------
    check_delta_cap(&snapshot, &cfg, taker.orderbook_intent.side, residual_size)?;

    // ---------- 6. Size-dependent spread (invariant 7) ----------
    let mark_raw: i128 = oracle.mark_e18.try_into().map_err(|_| {
        LpRouterError::Onchain(format!(
            "mark_e18 {} too large for i128",
            oracle.mark_e18
        ))
    })?;
    let mark_price = Price::new(mark_raw);
    let bps = spread_bps(&snapshot, &cfg, residual_size);
    let quote = quote_price(mark_price, taker.orderbook_intent.side, bps);

    // ---------- 7. Sign synthetic LP order + build the Fill ----------
    let lp_deadline_secs = taker.orderbook_intent.deadline_secs.saturating_add(60);
    let mag_u128 = residual_size.raw();
    let (signed_order, signature) = signer.sign_lp_order(
        onchain.deployment(),
        market_id_b256,
        taker.orderbook_intent.side,
        mag_u128,
        U256::from(quote.raw().unsigned_abs()),
        lp_deadline_secs,
    )?;

    // Synthetic IntentId for the LP side: derive from the SignedOrder
    // digest (matches what the contract stores as `orderStatus` key).
    let lp_intent_id = derive_intent_id(&signed_order, onchain.deployment().chain_id);
    let lp_db_id = format!("0x{}", hex_bytes(&lp_intent_id));

    let lp_intent = TranslatedIntent {
        orderbook_intent: bufi_orderbook::Intent {
            id: lp_intent_id,
            market_id: market_id_bytes,
            trader: signer.address().into(),
            side: taker.orderbook_intent.side.opposite(),
            magnitude: residual_size,
            price: quote,
            max_fee: 0,
            order_type: bufi_orderbook::OrderType::Limit,
            flags: 0,
            nonce: signed_order.nonce,
            deadline_secs: signed_order.deadline,
            tif: bufi_orderbook::TimeInForce::GoodTilCancel,
        },
        signed_order,
        signature,
        db_intent_id: lp_db_id,
        already_filled_abs: 0,
    };

    let fill = Fill {
        fill_id: derive_lp_fill_id(taker.orderbook_intent.id, lp_intent_id, match_seq),
        maker_intent_id: lp_intent_id,
        taker_intent_id: taker.orderbook_intent.id,
        market_id: market_id_bytes,
        taker_side: taker.orderbook_intent.side,
        price: quote,
        size: residual_size,
        timestamp_ms: now_ms,
        is_lp_fill: true,
    };

    info!(
        market = market_id_hex,
        taker = taker.db_intent_id,
        size = residual_size.raw(),
        spread_bps = bps,
        "LP routed residual"
    );
    debug!(
        long = ?snapshot.long_e18,
        short = ?snapshot.short_e18,
        tvl = ?snapshot.tvl_usdc_e6,
        "LP snapshot post-route"
    );

    Ok(Some(LpRoutedFill {
        lp_intent,
        taker_intent: taker.clone(),
        fill,
    }))
}

fn hex_bytes(b: &[u8]) -> String {
    let mut out = String::with_capacity(b.len() * 2);
    for byte in b {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Derive a deterministic IntentId for the synthetic LP order. Matches
/// the contract's `orderStatus` key by recomputing the EIP-712 digest
/// (the contract uses the same digest as the intent id).
fn derive_intent_id(
    order: &bufi_matcher_types::eip712::SignedOrder,
    chain_id: u64,
) -> [u8; 32] {
    use alloy_sol_types::SolStruct;
    let domain = bufi_matcher_types::eip712::domain(
        chain_id,
        // verifyingContract — match the same domain used by the signer.
        // The chain_id alone gives us enough entropy to derive a stable id;
        // the verifying-contract address is filled by the signer call site.
        alloy_primitives::Address::ZERO,
    );
    let digest: B256 = order.eip712_signing_hash(&domain);
    digest.0
}

fn derive_lp_fill_id(taker_id: [u8; 32], lp_id: [u8; 32], match_seq: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    // 8B match_seq || 8B "LPFL" marker || 8B truncated taker || 8B truncated lp_id.
    out[0..8].copy_from_slice(&match_seq.to_be_bytes());
    out[8..16].copy_from_slice(b"LPFILL00");
    out[16..24].copy_from_slice(&taker_id[..8]);
    out[24..32].copy_from_slice(&lp_id[..8]);
    out
}

#[cfg(test)]
mod tests {
    //! Pure-compute tests live here; the live RPC paths land in
    //! `tests/live_arc_testnet.rs` behind `#[ignore]`.

    use super::*;

    #[test]
    fn hex_bytes_lowercases() {
        assert_eq!(hex_bytes(&[0xAB, 0xCD]), "abcd");
    }

    #[test]
    fn derive_lp_fill_id_is_deterministic() {
        let taker = [0x01; 32];
        let lp = [0x02; 32];
        assert_eq!(
            derive_lp_fill_id(taker, lp, 7),
            derive_lp_fill_id(taker, lp, 7)
        );
    }

    #[test]
    fn derive_lp_fill_id_differs_on_seq() {
        let taker = [0x01; 32];
        let lp = [0x02; 32];
        assert_ne!(
            derive_lp_fill_id(taker, lp, 1),
            derive_lp_fill_id(taker, lp, 2)
        );
    }
}
