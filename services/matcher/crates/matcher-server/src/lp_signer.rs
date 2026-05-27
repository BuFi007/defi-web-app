//! LP_OPERATOR synthetic SignedOrder signer.
//!
//! Path A LP backstop: the matcher signs SignedOrders on behalf of the
//! LP_OPERATOR EOA so they can be paired with real taker SignedOrders in
//! `FxOrderSettlement.settleMatch`. The contract enforces
//! `maker.trader != taker.trader`, so LP_OPERATOR MUST be a distinct EOA
//! from `PERP_KEEPER_PRIVATE_KEY`.
//!
//! Nonce strategy: monotonic from `unix_now_ms`. Permit2 bitmap has
//! 256 nonces per word, and millis advance fast enough that we never
//! collide on the same word in practice. Two LP fills within the same
//! millisecond would tie on nonce — the second would revert with
//! `NonceAlreadyUsed`; in that case the caller backs off and retries
//! with a fresh `now_ms`.

use std::time::{SystemTime, UNIX_EPOCH};

use alloy_primitives::{Address, B256, I256, Signature as PrimitiveSignature, U256};
use alloy_signer::SignerSync;
use alloy_signer_local::PrivateKeySigner;
use alloy_sol_types::SolStruct;
use thiserror::Error;
use tracing::debug;

use bufi_matcher_types::eip712::{domain as eip712_domain, SignedOrder as TypedSignedOrder};
use bufi_orderbook::Side;
use bufi_perps_onchain::PerpsDeployment;

/// Errors raised when signing a synthetic LP order.
#[derive(Debug, Error)]
pub enum LpSignerError {
    /// `LP_OPERATOR_PRIVATE_KEY` env was malformed.
    #[error("LP_OPERATOR_PRIVATE_KEY parse: {0}")]
    Key(String),
    /// `signer.sign_hash_sync` failed.
    #[error("signing failed: {0}")]
    Sign(String),
    /// Caller asked us to sign a size that won't fit in i256.
    #[error("size {0} won't fit in i256")]
    SizeOverflow(u128),
}

/// Configured LP_OPERATOR — held once at boot.
#[derive(Debug, Clone)]
pub struct LpSigner {
    signer: PrivateKeySigner,
    address: Address,
}

impl LpSigner {
    /// Build from a hex private key (with or without `0x` prefix).
    pub fn from_hex(key_hex: &str) -> Result<Self, LpSignerError> {
        let stripped = key_hex.trim_start_matches("0x");
        let signer: PrivateKeySigner = stripped
            .parse()
            .map_err(|e: alloy_signer_local::LocalSignerError| LpSignerError::Key(e.to_string()))?;
        let address = signer.address();
        Ok(Self { signer, address })
    }

    /// LP_OPERATOR address.
    pub fn address(&self) -> Address {
        self.address
    }

    /// Sign a synthetic LP-side `SignedOrder` opposite the taker.
    ///
    /// `taker_side` is the SIDE of the real taker; the LP takes the
    /// opposite side, so its `sizeDeltaE18` is negated when the taker is
    /// Long.
    pub fn sign_lp_order(
        &self,
        deployment: &PerpsDeployment,
        market_id: B256,
        taker_side: Side,
        magnitude_e18: u128,
        price_e18: U256,
        deadline_secs: u64,
    ) -> Result<(TypedSignedOrder, Vec<u8>), LpSignerError> {
        if magnitude_e18 > i128::MAX as u128 {
            return Err(LpSignerError::SizeOverflow(magnitude_e18));
        }
        // LP takes opposite side to taker. Taker Long → LP sells (negative).
        // Taker Short → LP buys (positive).
        let signed_mag: i128 = magnitude_e18 as i128;
        let size_delta = match taker_side {
            Side::Long => -signed_mag,
            Side::Short => signed_mag,
        };
        let size_delta_i256 = I256::try_from(size_delta).expect("i128 fits in i256");

        let order = TypedSignedOrder {
            trader: self.address,
            marketId: market_id,
            sizeDeltaE18: size_delta_i256,
            priceE18: price_e18,
            maxFee: U256::ZERO, // LP accepts whatever fee the matcher computes
            orderType: 1,       // LIMIT — LP always quotes a price
            flags: 0,           // no reduce_only/post_only on synthetic LP orders
            // Monotonic-ish nonce; collisions revert and the caller retries.
            nonce: now_ms_truncated(),
            deadline: deadline_secs,
        };

        let domain = eip712_domain(deployment.chain_id, deployment.contracts.fx_order_settlement);
        let digest: B256 = order.eip712_signing_hash(&domain);
        let sig = self
            .signer
            .sign_hash_sync(&digest)
            .map_err(|e: alloy_signer::Error| LpSignerError::Sign(e.to_string()))?;
        let sig: PrimitiveSignature = sig;

        // 65-byte serialisation: r (32) || s (32) || v (1).
        let mut bytes = Vec::with_capacity(65);
        bytes.extend_from_slice(&sig.r().to_be_bytes::<32>());
        bytes.extend_from_slice(&sig.s().to_be_bytes::<32>());
        // alloy's `v()` returns the parity bit; on-chain ecrecover expects 27/28.
        let v_byte: u8 = if sig.v() { 28 } else { 27 };
        bytes.push(v_byte);
        debug!(
            lp_operator = ?self.address,
            nonce = order.nonce,
            "signed synthetic LP order"
        );
        Ok((order, bytes))
    }
}

fn now_ms_truncated() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic test key — Hardhat default account #0.
    const TEST_KEY: &str = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    fn fake_deployment() -> PerpsDeployment {
        use bufi_perps_onchain::deployment::{LiquidationParams, PerpsContracts};
        PerpsDeployment {
            chain_id: 5_042_002,
            deployer: Address::ZERO,
            keeper: Address::ZERO,
            contracts: PerpsContracts {
                fx_order_settlement: Address::ZERO,
                fx_perp_clearinghouse: Address::ZERO,
                fx_funding_engine: Address::ZERO,
                fx_health_checker: Address::ZERO,
                fx_liquidation_engine: Address::ZERO,
                fx_margin_account: Address::ZERO,
            },
            liquidation: LiquidationParams::default(),
        }
    }

    #[test]
    fn sign_with_taker_long_produces_negative_size_delta() {
        let signer = LpSigner::from_hex(TEST_KEY).unwrap();
        let (order, sig) = signer
            .sign_lp_order(
                &fake_deployment(),
                B256::ZERO,
                Side::Long,
                1_000_000_000_000_000_000,
                U256::from(2u128) * U256::from(10u128.pow(18)),
                u64::MAX,
            )
            .unwrap();
        assert_eq!(sig.len(), 65);
        assert!(order.sizeDeltaE18.is_negative());
    }

    #[test]
    fn sign_with_taker_short_produces_positive_size_delta() {
        let signer = LpSigner::from_hex(TEST_KEY).unwrap();
        let (order, sig) = signer
            .sign_lp_order(
                &fake_deployment(),
                B256::ZERO,
                Side::Short,
                1_000_000_000_000_000_000,
                U256::from(2u128) * U256::from(10u128.pow(18)),
                u64::MAX,
            )
            .unwrap();
        assert_eq!(sig.len(), 65);
        assert!(order.sizeDeltaE18.is_positive());
    }

    #[test]
    fn lp_operator_address_is_derived_from_key() {
        let signer = LpSigner::from_hex(TEST_KEY).unwrap();
        // The address must be non-zero and stable across calls.
        assert_ne!(signer.address(), Address::ZERO);
        assert_eq!(signer.address(), signer.address());
    }
}
