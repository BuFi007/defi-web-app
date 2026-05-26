//! Runtime client: alloy provider + signer + typed contract bindings.
//!
//! `PerpsOnchain` stores the rpc URL, signer key, and deployment as plain
//! data; the alloy `Provider` is built on each call. reqwest pools HTTP
//! connections internally, so per-call construction is cheap (~1 µs) and
//! avoids spelling out the generic filler stack at every API boundary.

use alloy_network::EthereumWallet;
use alloy_primitives::{Address, Bytes, B256, I256, U256};
use alloy_provider::ProviderBuilder;
use alloy_signer_local::PrivateKeySigner;
use thiserror::Error;

#[allow(unused_imports)] // alloy_contract::CallBuilder is in scope via the macro
use alloy_contract as _;

use crate::bindings::{
    FxFundingEngine, FxHealthChecker, FxOrderSettlement, FxPerpClearinghouse, IPyth,
    LiquidationRouter, SignedOrder,
};
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
    /// A non-settlement keeper transaction reverted or the receipt was not successful.
    #[error("{action} reverted (tx {tx})")]
    TransactionReverted {
        /// Keeper action name.
        action: &'static str,
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

    /// FxFundingEngine address (Phase 5 funding poker target).
    pub fn funding_engine(&self) -> Address {
        self.deployment.contracts.fx_funding_engine
    }

    /// FxHealthChecker address.
    pub fn health_checker(&self) -> Address {
        self.deployment.contracts.fx_health_checker
    }

    /// Read `lastUpdate` (unix seconds) for `market_id` from `FxFundingEngine`.
    /// Phase 5 funding poker uses this to decide whether the on-chain
    /// state has already advanced past our throttle.
    pub async fn funding_last_update_secs(
        &self,
        market_id: B256,
    ) -> Result<u64, PerpsOnchainError> {
        let signer: PrivateKeySigner = self.signer_key_hex.parse().map_err(
            |e: alloy_signer_local::LocalSignerError| {
                PerpsOnchainError::InvalidSignerKey(e.to_string())
            },
        )?;
        let wallet = EthereumWallet::from(signer);
        let url: reqwest::Url = self
            .rpc_url
            .parse()
            .map_err(|e| PerpsOnchainError::InvalidRpcUrl(format!("{e}")))?;
        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(url);
        let engine = FxFundingEngine::new(self.funding_engine(), &provider);
        let state = engine
            .fundingState(market_id)
            .call()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("fundingState: {e}")))?;
        Ok(state.lastUpdate.try_into().unwrap_or(0))
    }

    /// Submit `FxFundingEngine.pokeFundingRate(market_id)` and wait for
    /// the receipt. Returns the tx hash on success.
    pub async fn submit_poke_funding(
        &self,
        market_id: B256,
    ) -> Result<B256, PerpsOnchainError> {
        let signer: PrivateKeySigner = self.parse_signer()?;
        let wallet = EthereumWallet::from(signer);
        let url = self.parse_url()?;
        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(url);
        let engine = FxFundingEngine::new(self.funding_engine(), &provider);
        let pending = engine
            .pokeFundingRate(market_id)
            .send()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("pokeFundingRate send: {e}")))?;
        let receipt = pending
            .get_receipt()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("pokeFundingRate receipt: {e}")))?;
        let tx_hash = receipt.transaction_hash;
        if !receipt.status() {
            return Err(PerpsOnchainError::SettlementReverted { tx: tx_hash });
        }
        Ok(tx_hash)
    }

    /// Read `(openInterestLong, openInterestShort, maxOpenInterest)` for a market.
    pub async fn query_oi(&self, market_id: B256) -> Result<OiSnapshot, PerpsOnchainError> {
        let signer: PrivateKeySigner = self.parse_signer()?;
        let wallet = EthereumWallet::from(signer);
        let url = self.parse_url()?;
        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(url);
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

    /// Read the non-strict liquidation gate from `FxHealthChecker`.
    ///
    /// The state-changing liquidation still goes through `LiquidationRouter`
    /// and the engine's strict RedStone-verified path. This read is a cheap
    /// pre-filter so the keeper avoids sending obviously hopeless txs.
    pub async fn is_liquidatable(
        &self,
        market_id: B256,
        trader: Address,
    ) -> Result<bool, PerpsOnchainError> {
        let signer: PrivateKeySigner = self.parse_signer()?;
        let wallet = EthereumWallet::from(signer);
        let url = self.parse_url()?;
        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(url);
        let health = FxHealthChecker::new(self.health_checker(), &provider);
        let result = health
            .isLiquidatable(market_id, trader)
            .call()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("isLiquidatable: {e}")))?;
        Ok(result._0)
    }

    /// Read the latest on-chain position size and return its absolute value.
    pub async fn position_size_abs(
        &self,
        market_id: B256,
        trader: Address,
    ) -> Result<U256, PerpsOnchainError> {
        let signer: PrivateKeySigner = self.parse_signer()?;
        let wallet = EthereumWallet::from(signer);
        let url = self.parse_url()?;
        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(url);
        let clearinghouse = FxPerpClearinghouse::new(self.clearinghouse(), &provider);
        let position = clearinghouse
            .position(market_id, trader)
            .call()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("position: {e}")))?
            ._0;
        Ok(i256_abs_u256(position.sizeE18))
    }

    /// Submit `LiquidationRouter.liquidateAtomic` and wait for the receipt.
    pub async fn submit_liquidation_router_atomic(
        &self,
        router_address: Address,
        market_id: B256,
        trader: Address,
        max_size_to_close_abs_e18: U256,
    ) -> Result<B256, PerpsOnchainError> {
        let signer: PrivateKeySigner = self.parse_signer()?;
        let wallet = EthereumWallet::from(signer);
        let url = self.parse_url()?;
        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(url);
        let router = LiquidationRouter::new(router_address, &provider);
        let pending = router
            .liquidateAtomic(market_id, trader, max_size_to_close_abs_e18)
            .send()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("liquidateAtomic send: {e}")))?;
        let receipt = pending
            .get_receipt()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("liquidateAtomic receipt: {e}")))?;
        let tx_hash = receipt.transaction_hash;
        if !receipt.status() {
            return Err(PerpsOnchainError::TransactionReverted {
                action: "liquidateAtomic",
                tx: tx_hash,
            });
        }
        Ok(tx_hash)
    }

    /// Phase 7.2 — push fresh Pyth update VAAs on-chain.
    ///
    /// Calls `IPyth.updatePriceFeeds{value: fee}(updateData)` after reading
    /// `IPyth.getUpdateFee(updateData)`. `pyth_address` is resolved by the
    /// caller (typically via `oracle::resolve_pyth_address(chain_id)`) so
    /// the client stays stateless about which Pyth deployment it's talking
    /// to. Returns the tx hash on success.
    pub async fn submit_pyth_update(
        &self,
        pyth_address: Address,
        update_data: Vec<Bytes>,
    ) -> Result<B256, PerpsOnchainError> {
        let signer: PrivateKeySigner = self.parse_signer()?;
        let wallet = EthereumWallet::from(signer);
        let url = self.parse_url()?;
        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(url);
        let pyth = IPyth::new(pyth_address, &provider);
        let fee = pyth
            .getUpdateFee(update_data.clone())
            .call()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("getUpdateFee: {e}")))?
            .feeAmount;
        let pending = pyth
            .updatePriceFeeds(update_data)
            .value(fee)
            .send()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("updatePriceFeeds send: {e}")))?;
        let receipt = pending
            .get_receipt()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("updatePriceFeeds receipt: {e}")))?;
        let tx_hash = receipt.transaction_hash;
        if !receipt.status() {
            return Err(PerpsOnchainError::SettlementReverted { tx: tx_hash });
        }
        Ok(tx_hash)
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
        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(url);
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
    /// Accessor used by sibling modules + matcher-server (pyth_pusher
    /// needs to construct a fresh provider for read-only paths). Returns
    /// the hex-encoded private key with no `0x` prefix.
    pub fn signer_key_hex(&self) -> &str {
        &self.signer_key_hex
    }

    /// Accessor used by sibling modules.
    /// Accessor — same rationale as `signer_key_hex`. Returns the JSON-RPC URL.
    pub fn rpc_url(&self) -> &str {
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

fn i256_abs_u256(value: I256) -> U256 {
    let raw = value.to_be_bytes::<32>();
    if raw[0] & 0x80 == 0 {
        return U256::from_be_bytes(raw);
    }

    let mut magnitude = raw;
    for byte in &mut magnitude {
        *byte = !*byte;
    }
    for byte in magnitude.iter_mut().rev() {
        let (next, carry) = byte.overflowing_add(1);
        *byte = next;
        if !carry {
            break;
        }
    }
    U256::from_be_bytes(magnitude)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn i256_abs_handles_positive_values() {
        let value = I256::try_from(123_i128).unwrap();
        assert_eq!(i256_abs_u256(value), U256::from(123_u64));
    }

    #[test]
    fn i256_abs_handles_negative_values() {
        let value = I256::try_from(-123_i128).unwrap();
        assert_eq!(i256_abs_u256(value), U256::from(123_u64));
    }
}
