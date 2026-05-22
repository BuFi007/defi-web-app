//! Oracle snapshot reader — Phase 4 LP backstop oracle surface.
//!
//! `FxPerpClearinghouse._priceView` calls
//!   `ORACLE.getMid(config.baseToken, USDC) -> (midE18, publishedAt)`
//! internally. We replicate that two-step path here so the LP router has
//! a direct (mark, freshness) snapshot it can gate on (invariants 2 + 4).
//!
//! Address sources:
//!   - `baseToken` comes from `FxPerpClearinghouse.marketConfig(market_id).baseToken`.
//!   - `oracle` address lives in `FX_ORACLE_ADDRESS` env (sprint-1 broadcast
//!     doesn't include it in `perp-stack-{id}.json` yet; we'll move it to
//!     the JSON loader once the deployer publishes it there).
//!   - `usdc` address lives in `USDC_ADDRESS` env (defaults to Arc Testnet
//!     USDC: `0x3600000000000000000000000000000000000000`).

use std::env;

use alloy_network::EthereumWallet;
use alloy_primitives::{Address, B256, U256};
use alloy_provider::ProviderBuilder;
use alloy_signer_local::PrivateKeySigner;

use crate::bindings::{FxPerpClearinghouse, IFxOracle};
use crate::client::PerpsOnchain;
use crate::client::PerpsOnchainError;

/// Default Arc Testnet USDC (per `fx-telarana/docs/INTEGRATION_HANDOFF.md`).
pub const DEFAULT_ARC_USDC: &str = "0x3600000000000000000000000000000000000000";

/// `oracle_snapshot` return — read-only at one block.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OracleSnapshot {
    /// Market id used for the lookup (echo so the caller can correlate).
    pub market_id: B256,
    /// Mark price in 18-decimal WAD from `FxOracle.getMid`.
    pub mark_e18: U256,
    /// Unix seconds when the oracle was last published. Used for the
    /// freshness gate (invariant 4).
    pub published_at_secs: u64,
}

impl PerpsOnchain {
    /// Read `(mark_e18, published_at)` for `market_id` via the FxOracle path.
    pub async fn oracle_snapshot(&self, market_id: B256) -> Result<OracleSnapshot, PerpsOnchainError> {
        let oracle_address = oracle_address_from_env()?;
        let usdc_address = usdc_address_from_env()?;

        // Build the provider + clearinghouse + oracle handles together so a
        // single keeper signer + URL parse covers both calls.
        let signer: PrivateKeySigner = self
            .signer_key_hex()
            .parse()
            .map_err(|e: alloy_signer_local::LocalSignerError| {
                PerpsOnchainError::InvalidSignerKey(e.to_string())
            })?;
        let wallet = EthereumWallet::from(signer);
        let url: reqwest::Url = self
            .rpc_url()
            .parse()
            .map_err(|e: url::ParseError| PerpsOnchainError::InvalidRpcUrl(e.to_string()))?;
        let provider = ProviderBuilder::new().wallet(wallet).on_http(url);

        let clearinghouse = FxPerpClearinghouse::new(self.clearinghouse(), &provider);
        let cfg = clearinghouse
            .marketConfig(market_id)
            .call()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("marketConfig: {e}")))?
            ._0;

        let oracle = IFxOracle::new(oracle_address, &provider);
        let mid = oracle
            .getMid(cfg.baseToken, usdc_address)
            .call()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("FxOracle.getMid: {e}")))?;
        let mark_e18 = mid.midE18;
        let published_at: u64 = mid.publishedAt.try_into().unwrap_or(0);

        Ok(OracleSnapshot {
            market_id,
            mark_e18,
            published_at_secs: published_at,
        })
    }
}

fn oracle_address_from_env() -> Result<Address, PerpsOnchainError> {
    let raw = env::var("FX_ORACLE_ADDRESS").map_err(|_| {
        PerpsOnchainError::Rpc(
            "FX_ORACLE_ADDRESS env var not set (Arc sprint-1: 0xf9b0356A31BC7125e2eD0DADf8b5957860d42c78)".into(),
        )
    })?;
    raw.parse::<Address>()
        .map_err(|e| PerpsOnchainError::Rpc(format!("FX_ORACLE_ADDRESS parse: {e}")))
}

fn usdc_address_from_env() -> Result<Address, PerpsOnchainError> {
    let raw = env::var("USDC_ADDRESS").unwrap_or_else(|_| DEFAULT_ARC_USDC.to_string());
    raw.parse::<Address>()
        .map_err(|e| PerpsOnchainError::Rpc(format!("USDC_ADDRESS parse: {e}")))
}
