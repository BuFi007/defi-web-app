//! Runtime client: alloy provider + signer + typed contract bindings.
//!
//! `PerpsOnchain` stores the rpc URL, signer key, and deployment as plain
//! data; the alloy `Provider` is built on each call. reqwest pools HTTP
//! connections internally, so per-call construction is cheap (~1 µs) and
//! avoids spelling out the generic filler stack at every API boundary.

use alloy_network::EthereumWallet;
use alloy_primitives::{Address, Bytes, B256, U256};
use alloy_provider::ProviderBuilder;
use alloy_signer_local::PrivateKeySigner;
use thiserror::Error;

#[allow(unused_imports)] // alloy_contract::CallBuilder is in scope via the macro
use alloy_contract as _;

use crate::bindings::{FxOrderSettlement, FxPerpClearinghouse, SignedOrder};
use crate::deployment::{DeploymentLoadError, PerpsDeployment};
use crate::env::{arc_rpc_url, keeper_private_key, ARC_CHAIN_ID};

/// Snapshot of one market's OI state — the defence-in-depth gate consumes this.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OiSnapshot {
    /// `openInterestLong(marketId)`, USDC quantums (6-dec).
    pub long: U256,
    /// `openInterestShort(marketId)`, USDC quantums (6-dec).
    pub short: U256,
    /// `maxOpenInterest(marketId)` — contract-enforced ceiling.
    pub cap: U256,
}

/// Errors surfaced by the on-chain client.
#[derive(Debug, Error)]
pub enum PerpsOnchainError {
    /// Couldn't load the deployment manifest.
    #[error("deployment load: {0}")]
    Deployment(#[from] DeploymentLoadError),
    /// No keeper signer was configured.
    #[error("no keeper signer found: set PERP_KEEPER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY")]
    NoSigner,
    /// Keeper key was malformed.
    #[error("invalid keeper signer key: {0}")]
    InvalidSignerKey(String),
    /// Bad RPC URL.
    #[error("invalid RPC URL: {0}")]
    InvalidRpcUrl(String),
    /// alloy returned a transport / RPC error.
    #[error("rpc: {0}")]
    Rpc(String),
    /// `settleMatch` reverted or the receipt was not successful.
    #[error("settleMatch reverted (tx {tx})")]
    SettlementReverted {
        /// Transaction hash that reverted.
        tx: B256,
    },
}

/// Stored config — provider is built per call.
#[derive(Debug, Clone)]
pub struct PerpsOnchain {
    rpc_url: String,
    signer_key_hex: String,
    deployment: PerpsDeployment,
}

impl PerpsOnchain {
    /// Build from explicit pieces.
    pub fn new(
        rpc_url: &str,
        signer_key_hex: &str,
        deployment: PerpsDeployment,
    ) -> Result<Self, PerpsOnchainError> {
        // Validate the URL + signer at construction so misconfig fails fast.
        let _: reqwest::Url = rpc_url
            .parse()
            .map_err(|e: url::ParseError| PerpsOnchainError::InvalidRpcUrl(e.to_string()))?;
        let _signer: PrivateKeySigner = signer_key_hex
            .parse()
            .map_err(|e: alloy_signer_local::LocalSignerError| {
                PerpsOnchainError::InvalidSignerKey(e.to_string())
            })?;
        Ok(Self {
            rpc_url: rpc_url.to_string(),
            signer_key_hex: signer_key_hex.to_string(),
            deployment,
        })
    }

    /// Convenience: load via env. Defaults to Arc Testnet.
    pub fn from_env() -> Result<Self, PerpsOnchainError> {
        Self::from_env_for_chain(ARC_CHAIN_ID)
    }

    /// `from_env` for a specific chain id.
    pub fn from_env_for_chain(chain_id: u64) -> Result<Self, PerpsOnchainError> {
        let deployment = PerpsDeployment::load_from_env(chain_id)?;
        let rpc = arc_rpc_url();
        let key = keeper_private_key().ok_or(PerpsOnchainError::NoSigner)?;
        Self::new(&rpc, &key, deployment)
    }

    /// The loaded deployment.
    pub fn deployment(&self) -> &PerpsDeployment {
        &self.deployment
    }

    /// FxOrderSettlement address.
    pub fn order_settlement(&self) -> Address {
        self.deployment.contracts.fx_order_settlement
    }

    /// FxPerpClearinghouse address.
    pub fn clearinghouse(&self) -> Address {
        self.deployment.contracts.fx_perp_clearinghouse
    }

    /// Read `(openInterestLong, openInterestShort, maxOpenInterest)` for a market.
    pub async fn query_oi(&self, market_id: B256) -> Result<OiSnapshot, PerpsOnchainError> {
        let signer: PrivateKeySigner = self.parse_signer()?;
        let wallet = EthereumWallet::from(signer);
        let url = self.parse_url()?;
        let provider = ProviderBuilder::new().wallet(wallet).on_http(url);
        let clearinghouse = FxPerpClearinghouse::new(self.clearinghouse(), &provider);
        let long = clearinghouse
            .openInterestLong(market_id)
            .call()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("openInterestLong: {e}")))?
            ._0;
        let short = clearinghouse
            .openInterestShort(market_id)
            .call()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("openInterestShort: {e}")))?
            ._0;
        let cap = clearinghouse
            .maxOpenInterest(market_id)
            .call()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("maxOpenInterest: {e}")))?
            ._0;
        Ok(OiSnapshot { long, short, cap })
    }

    /// Submit `settleMatch` and wait for the receipt. Returns the tx hash.
    pub async fn submit_settle_match(
        &self,
        maker: SignedOrder,
        maker_sig: Bytes,
        taker: SignedOrder,
        taker_sig: Bytes,
        fill_size_e18: U256,
        fill_price_e18: U256,
    ) -> Result<B256, PerpsOnchainError> {
        let signer: PrivateKeySigner = self.parse_signer()?;
        let wallet = EthereumWallet::from(signer);
        let url = self.parse_url()?;
        let provider = ProviderBuilder::new().wallet(wallet).on_http(url);
        let order_settlement = FxOrderSettlement::new(self.order_settlement(), &provider);
        let pending = order_settlement
            .settleMatch(
                maker,
                maker_sig,
                taker,
                taker_sig,
                fill_size_e18,
                fill_price_e18,
            )
            .send()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("settleMatch send: {e}")))?;

        let receipt = pending
            .get_receipt()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("settleMatch receipt: {e}")))?;
        let tx_hash = receipt.transaction_hash;
        if !receipt.status() {
            return Err(PerpsOnchainError::SettlementReverted { tx: tx_hash });
        }
        Ok(tx_hash)
    }

    /// Accessor used by sibling modules (e.g. `oracle.rs`) that need to
    /// rebuild a provider with the same signer/url.
    pub(crate) fn signer_key_hex(&self) -> &str {
        &self.signer_key_hex
    }

    /// Accessor used by sibling modules.
    pub(crate) fn rpc_url(&self) -> &str {
        &self.rpc_url
    }

    fn parse_signer(&self) -> Result<PrivateKeySigner, PerpsOnchainError> {
        self.signer_key_hex.parse().map_err(
            |e: alloy_signer_local::LocalSignerError| {
                PerpsOnchainError::InvalidSignerKey(e.to_string())
            },
        )
    }

    fn parse_url(&self) -> Result<reqwest::Url, PerpsOnchainError> {
        self.rpc_url
            .parse::<reqwest::Url>()
            .map_err(|e| PerpsOnchainError::InvalidRpcUrl(e.to_string()))
    }
}
