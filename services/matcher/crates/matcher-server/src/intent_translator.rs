//! `PerpIntent` (DB row) → `bufi_orderbook::Intent` (matchable) + EIP-712 verify.
//!
//! The translator does THREE things, in order:
//!
//!   1. Parse the string-encoded big-ints (`size_delta`, `price_e18`, `nonce`,
//!      `maxFee=0` by current keeper convention) into typed Rust ints.
//!   2. Build a `bufi_matcher_types::eip712::SignedOrder` (sol! struct) so we
//!      can compute the EIP-712 digest the contract will recover under.
//!   3. Recover the signer from `intent.signature` against that digest;
//!      reject if it doesn't equal `intent.trader`.
//!
//! Only after all three pass does it emit the matchable
//! `bufi_orderbook::Intent`. The matcher-server layer NEVER calls the
//! orderbook on an intent that hasn't passed signature verification.

use alloy_primitives::{Address, FixedBytes, PrimitiveSignature, B256, U256};
use alloy_sol_types::SolStruct;
use thiserror::Error;

use bufi_matcher_types::eip712::{domain as eip712_domain, SignedOrder as TypedSignedOrder};
use bufi_orderbook::{
    Intent, IntentId, MarketId, OrderType as ObOrderType, Side, Size, TimeInForce,
    FLAG_POST_ONLY, FLAG_REDUCE_ONLY,
};
use bufi_perps_db::{PerpIntent, PerpOrderType, PerpSide};
use bufi_perps_onchain::PerpsDeployment;

use crate::price::price_from_dec_string_e18;

/// Errors raised when a `PerpIntent` can't be translated to a matchable
/// `Intent`. A `Rejected` intent gets its DB status flipped to `rejected`
/// by the caller; never matched.
#[derive(Debug, Error)]
pub enum TranslateError {
    /// `size_delta` couldn't be parsed as a signed big-int.
    #[error("intent {intent_id}: invalid size_delta `{value}`")]
    InvalidSizeDelta {
        /// The intent that failed.
        intent_id: String,
        /// What we tried to parse.
        value: String,
    },
    /// `size_delta == 0` — zero-size orders are rejected pre-match.
    #[error("intent {intent_id}: size_delta is zero")]
    ZeroSize {
        /// The intent.
        intent_id: String,
    },
    /// `price_e18` couldn't be parsed.
    #[error("intent {intent_id}: invalid price_e18 `{value}`")]
    InvalidPrice {
        /// The intent.
        intent_id: String,
        /// What we tried.
        value: String,
    },
    /// `nonce` couldn't be parsed as a u64.
    #[error("intent {intent_id}: invalid nonce `{value}`")]
    InvalidNonce {
        /// The intent.
        intent_id: String,
        /// What we tried.
        value: String,
    },
    /// `intent.trader` couldn't be parsed as a 20-byte address.
    #[error("intent {intent_id}: invalid trader address `{value}`")]
    InvalidTrader {
        /// The intent.
        intent_id: String,
        /// What we tried.
        value: String,
    },
    /// `intent.market_id` couldn't be parsed as a 32-byte hash.
    #[error("intent {intent_id}: invalid market_id `{value}`")]
    InvalidMarketId {
        /// The intent.
        intent_id: String,
        /// What we tried.
        value: String,
    },
    /// `intent.intent_id` couldn't be parsed as a 32-byte hash.
    #[error("intent {intent_id}: invalid intent_id (not a 32-byte hex)")]
    InvalidIntentId {
        /// The intent.
        intent_id: String,
    },
    /// `intent.signature` couldn't be parsed as a 65-byte r||s||v.
    #[error("intent {intent_id}: invalid signature (expected 65 bytes hex)")]
    InvalidSignature {
        /// The intent.
        intent_id: String,
    },
    /// Recovered signer doesn't match `intent.trader`.
    #[error(
        "intent {intent_id}: signature recovers {recovered}, expected trader {trader}"
    )]
    SignerMismatch {
        /// The intent.
        intent_id: String,
        /// What the signature recovered to.
        recovered: String,
        /// What we expected.
        trader: String,
    },
}

/// A translated intent ready for the matcher core + everything we need to
/// settle it on-chain later.
#[derive(Debug, Clone)]
pub struct TranslatedIntent {
    /// The orderbook-facing intent (used by `match_intent`).
    pub orderbook_intent: Intent,
    /// The on-the-wire SignedOrder bytes (used by `settleMatch`).
    pub signed_order: TypedSignedOrder,
    /// 65-byte EIP-712 signature.
    pub signature: Vec<u8>,
    /// The original DB row id (kept so the settlement step can `record_fill`).
    pub db_intent_id: String,
    /// Cumulative fills already on this intent in the DB. Used at residual
    /// resting time so the orderbook sees the magnitude that's still live.
    /// (Not consumed yet — Phase 3c carries it for forward use.)
    #[allow(dead_code)]
    pub already_filled_abs: u128,
}

/// Translate + verify a single `PerpIntent`. Pure synchronous — no clock, no IO.
pub fn translate(
    intent: &PerpIntent,
    deployment: &PerpsDeployment,
) -> Result<TranslatedIntent, TranslateError> {
    // ---------- 1. Parse fields ----------
    let size_delta: i128 = intent.size_delta.parse().map_err(|_| {
        TranslateError::InvalidSizeDelta {
            intent_id: intent.intent_id.clone(),
            value: intent.size_delta.clone(),
        }
    })?;
    if size_delta == 0 {
        return Err(TranslateError::ZeroSize {
            intent_id: intent.intent_id.clone(),
        });
    }
    let already_filled: i128 = intent.filled_size_delta.parse().unwrap_or(0);
    let remaining: i128 = size_delta - already_filled;
    if remaining == 0 {
        return Err(TranslateError::ZeroSize {
            intent_id: intent.intent_id.clone(),
        });
    }

    let price = price_from_dec_string_e18(&intent.price_e18).ok_or_else(|| {
        TranslateError::InvalidPrice {
            intent_id: intent.intent_id.clone(),
            value: intent.price_e18.clone(),
        }
    })?;

    let nonce: u64 = intent
        .nonce
        .parse()
        .map_err(|_| TranslateError::InvalidNonce {
            intent_id: intent.intent_id.clone(),
            value: intent.nonce.clone(),
        })?;

    let trader = parse_address(&intent.trader).ok_or_else(|| TranslateError::InvalidTrader {
        intent_id: intent.intent_id.clone(),
        value: intent.trader.clone(),
    })?;
    let trader_bytes: [u8; 20] = trader.into();

    let market_id_b256 =
        parse_b256(&intent.market_id).ok_or_else(|| TranslateError::InvalidMarketId {
            intent_id: intent.intent_id.clone(),
            value: intent.market_id.clone(),
        })?;
    let market_id: MarketId = market_id_b256.into();

    let intent_id_b256 =
        parse_b256(&intent.intent_id).ok_or_else(|| TranslateError::InvalidIntentId {
            intent_id: intent.intent_id.clone(),
        })?;
    let intent_id_bytes: IntentId = intent_id_b256.into();

    // Side derived from sign of the FULL size_delta (NOT remaining — that's
    // just a fill-progress quantity; the original sign is the order side).
    let side = if size_delta > 0 { Side::Long } else { Side::Short };
    let magnitude_abs: u128 = remaining.unsigned_abs();
    let magnitude = Size::new(magnitude_abs);

    let order_type = match intent.order_type {
        PerpOrderType::Limit => ObOrderType::Limit,
        PerpOrderType::Market => ObOrderType::Market,
    };

    // PerpIntent flags vs orderbook flags: PerpSide is informational here;
    // the on-the-wire flags integer is what we carry forward bit-for-bit.
    let mut flags: u8 = 0;
    if intent.reduce_only {
        flags |= FLAG_REDUCE_ONLY;
    }
    if intent.post_only {
        flags |= FLAG_POST_ONLY;
    }
    debug_assert!(
        (intent.flags as u8 & !(FLAG_REDUCE_ONLY | FLAG_POST_ONLY)) == 0
            || flags == intent.flags as u8,
        "DB.flags bitfield diverges from reduce_only/post_only columns"
    );
    if intent.flags != 0 {
        // Trust the bitfield column over the bool columns when they
        // disagree — the bitfield is the EIP-712-signed truth.
        flags = intent.flags as u8;
    }
    // Sanity check: side derived from size_delta MUST agree with the DB
    // `side` text column.
    debug_assert_eq!(
        side,
        match intent.side {
            PerpSide::Long => Side::Long,
            PerpSide::Short => Side::Short,
        },
        "DB.side text column disagrees with sign(size_delta)"
    );

    // ---------- 2. Build SignedOrder (sol! struct for hashing) ----------
    let signed_order = TypedSignedOrder {
        trader,
        marketId: market_id_b256,
        sizeDeltaE18: alloy_primitives::I256::try_from(size_delta).expect("i128 fits in i256"),
        priceE18: U256::from_str_radix(intent.price_e18.trim_start_matches('-'), 10)
            .unwrap_or(U256::ZERO),
        // Today the keeper hard-codes maxFee=0 on settleMatch (uncapped).
        // The matcher mirrors this until the order schema gains a maxFee field.
        maxFee: U256::ZERO,
        orderType: match intent.order_type {
            PerpOrderType::Market => 0,
            PerpOrderType::Limit => 1,
        },
        flags,
        nonce,
        deadline: intent.deadline as u64,
    };

    // ---------- 3. Verify signature ----------
    let signature_bytes = parse_signature_bytes(&intent.signature).ok_or_else(|| {
        TranslateError::InvalidSignature {
            intent_id: intent.intent_id.clone(),
        }
    })?;
    let domain = eip712_domain(deployment.chain_id, deployment.contracts.fx_order_settlement);
    let digest: B256 = signed_order.eip712_signing_hash(&domain);
    let recovered = recover_signer(&signature_bytes, &digest).map_err(|_| {
        TranslateError::InvalidSignature {
            intent_id: intent.intent_id.clone(),
        }
    })?;
    if recovered != trader {
        return Err(TranslateError::SignerMismatch {
            intent_id: intent.intent_id.clone(),
            recovered: format!("{recovered:#x}"),
            trader: format!("{trader:#x}"),
        });
    }

    // ---------- 4. Build the orderbook Intent ----------
    let orderbook_intent = Intent {
        id: intent_id_bytes,
        market_id,
        trader: trader_bytes,
        side,
        magnitude,
        price,
        max_fee: 0,
        order_type,
        flags,
        nonce,
        deadline_secs: intent.deadline as u64,
        // Matcher-only TIF: the DB schema doesn't carry it explicitly today;
        // every keeper-submitted intent is GTC unless post_only (which is
        // a maker hint, not a TIF). Match the TS keeper behaviour.
        tif: TimeInForce::GoodTilCancel,
    };

    Ok(TranslatedIntent {
        orderbook_intent,
        signed_order,
        signature: signature_bytes,
        db_intent_id: intent.intent_id.clone(),
        already_filled_abs: already_filled.unsigned_abs(),
    })
}

// ---------------------------------------------------------------------------
// hex helpers
// ---------------------------------------------------------------------------

fn parse_address(s: &str) -> Option<Address> {
    s.parse::<Address>().ok()
}

fn parse_b256(s: &str) -> Option<FixedBytes<32>> {
    s.parse::<FixedBytes<32>>().ok()
}

fn parse_signature_bytes(s: &str) -> Option<Vec<u8>> {
    let stripped = s.strip_prefix("0x").unwrap_or(s);
    if stripped.len() != 130 {
        return None;
    }
    let mut out = Vec::with_capacity(65);
    for i in (0..130).step_by(2) {
        out.push(u8::from_str_radix(&stripped[i..i + 2], 16).ok()?);
    }
    Some(out)
}

fn recover_signer(sig_bytes: &[u8], digest: &B256) -> Result<Address, alloy_primitives::SignatureError> {
    let sig = PrimitiveSignature::try_from(sig_bytes)?;
    sig.recover_address_from_prehash(digest)
        .map_err(|e| alloy_primitives::SignatureError::FromBytes(e.to_string().leak()))
}
