//! Oracle snapshot reader — Phase 4 LP backstop oracle surface.
//!
//! `FxPerpClearinghouse._priceView` calls
//!   `ORACLE.getMid(config.baseToken, USDC) -> (midE18, publishedAt)`
//! internally. We replicate that two-step path here so the LP router has
//! a direct (mark, freshness) snapshot it can gate on (invariants 2 + 4).
//!
//! Address sources:
//!   - `baseToken` comes from `FxPerpClearinghouse.marketConfig(market_id).baseToken`.
//!   - `oracle` address: env `FX_ORACLE_ADDRESS` wins. If unset, fall back to
//!     `fx-telarana/deployments/perp-oracle-{chainId}.json` (Phase 6 — sprint-1
//!     began publishing this file; env override is kept for staging/forks).
//!   - `usdc` address lives in `USDC_ADDRESS` env (defaults to Arc Testnet
//!     USDC: `0x3600000000000000000000000000000000000000`).

use std::env;
use std::fs;
use std::path::Path;

use alloy_network::EthereumWallet;
use alloy_primitives::{Address, B256, U256};
use alloy_provider::ProviderBuilder;
use alloy_signer_local::PrivateKeySigner;
use serde::Deserialize;

use crate::bindings::{FxPerpClearinghouse, IFxOracle};
use crate::client::PerpsOnchain;
use crate::client::PerpsOnchainError;
use crate::env::fx_telarana_deployments_dir;

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
    /// Read `FxOracle.pythFeedOf(token)` for the given token address.
    /// Phase 7.2 — the pyth_pusher uses this at boot to build the set of
    /// Hermes feed ids it needs to refresh for every configured market.
    pub async fn pyth_feed_of(&self, token: Address) -> Result<B256, PerpsOnchainError> {
        let oracle_address = resolve_oracle_address(self.deployment().chain_id)?;
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
        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(url);
        let oracle = crate::bindings::IFxOracle::new(oracle_address, &provider);
        let feed = oracle
            .pythFeedOf(token)
            .call()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("pythFeedOf: {e}")))?;
        Ok(feed._0)
    }

    /// Read `(mark_e18, published_at)` for `market_id` via the FxOracle path.
    pub async fn oracle_snapshot(&self, market_id: B256) -> Result<OracleSnapshot, PerpsOnchainError> {
        let oracle_address = resolve_oracle_address(self.deployment().chain_id)?;
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
        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(url);

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

/// Resolve the oracle address for `chain_id`. Order:
///   1. `FX_ORACLE_ADDRESS` env (override path — used for staging + forks)
///   2. `perp-oracle-{chain_id}.json` under `FX_TELARANA_DEPLOYMENTS`
///   3. error
pub(crate) fn resolve_oracle_address(chain_id: u64) -> Result<Address, PerpsOnchainError> {
    if let Ok(raw) = env::var("FX_ORACLE_ADDRESS") {
        return raw
            .parse::<Address>()
            .map_err(|e| PerpsOnchainError::Rpc(format!("FX_ORACLE_ADDRESS parse: {e}")));
    }
    let dir = fx_telarana_deployments_dir();
    let path = dir.join(format!("perp-oracle-{chain_id}.json"));
    load_oracle_address_from_json(&path).ok_or_else(|| {
        PerpsOnchainError::Rpc(format!(
            "no FxOracle address: set FX_ORACLE_ADDRESS env OR drop a {} \
             (FX_TELARANA_DEPLOYMENTS={})",
            path.display(),
            dir.display(),
        ))
    })
}

fn load_oracle_address_from_json(path: &Path) -> Option<Address> {
    let raw = fs::read_to_string(path).ok()?;
    let parsed: PerpOracleManifest = serde_json::from_str(&raw).ok()?;
    parsed.fx_oracle.parse::<Address>().ok()
}

/// Minimal slice of `perp-oracle-{chainId}.json`. `pyth` is the on-chain
/// `IPyth` contract the matcher's pyth_pusher pushes Hermes payloads to.
/// `maxConfidenceBps`, `maxDeviationBps`, and `maxOracleAge` are used by
/// the liquidator keeper, not the matcher — captured here for future use.
#[derive(Debug, Deserialize)]
struct PerpOracleManifest {
    #[serde(rename = "FxOracle")]
    fx_oracle: String,
    #[serde(default, rename = "pyth")]
    pyth: Option<String>,
}

/// Resolve the on-chain `IPyth` address for `chain_id`. Order:
///   1. `PYTH_ADDRESS` env (override path)
///   2. `perp-oracle-{chain_id}.json` `pyth` field
///   3. error
pub fn resolve_pyth_address(chain_id: u64) -> Result<Address, PerpsOnchainError> {
    if let Ok(raw) = env::var("PYTH_ADDRESS") {
        return raw
            .parse::<Address>()
            .map_err(|e| PerpsOnchainError::Rpc(format!("PYTH_ADDRESS parse: {e}")));
    }
    let dir = fx_telarana_deployments_dir();
    let path = dir.join(format!("perp-oracle-{chain_id}.json"));
    load_pyth_address_from_json(&path).ok_or_else(|| {
        PerpsOnchainError::Rpc(format!(
            "no Pyth address: set PYTH_ADDRESS env OR add `pyth` to {} \
             (FX_TELARANA_DEPLOYMENTS={})",
            path.display(),
            dir.display(),
        ))
    })
}

fn load_pyth_address_from_json(path: &Path) -> Option<Address> {
    let raw = fs::read_to_string(path).ok()?;
    let parsed: PerpOracleManifest = serde_json::from_str(&raw).ok()?;
    parsed.pyth?.parse::<Address>().ok()
}

fn usdc_address_from_env() -> Result<Address, PerpsOnchainError> {
    let raw = env::var("USDC_ADDRESS").unwrap_or_else(|_| DEFAULT_ARC_USDC.to_string());
    raw.parse::<Address>()
        .map_err(|e| PerpsOnchainError::Rpc(format!("USDC_ADDRESS parse: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn write_temp(contents: &str, name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        path.push(format!("bufi-oracle-test-{stamp}-{name}"));
        std::fs::write(&path, contents).unwrap();
        path
    }

    const ARC_ORACLE_JSON: &str = r#"{
  "FxOracle": "0xf9b0356A31BC7125e2eD0DADf8b5957860d42c78",
  "chainId": 5042002,
  "deployer": "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  "maxConfidenceBps": 30,
  "maxDeviationBps": 50,
  "maxOracleAge": 300,
  "pyth": "0x2880aB155794e7179c9eE2e38200202908C17B43"
}"#;

    #[test]
    fn json_loader_parses_canonical_arc_manifest() {
        let path = write_temp(ARC_ORACLE_JSON, "perp-oracle-5042002.json");
        let addr = load_oracle_address_from_json(&path).expect("parse");
        assert_eq!(
            format!("{:#x}", addr).to_lowercase(),
            "0xf9b0356a31bc7125e2ed0dadf8b5957860d42c78"
        );
    }

    #[test]
    fn json_loader_returns_none_on_missing_file() {
        let path = PathBuf::from("/nonexistent/perp-oracle-5042002.json");
        assert!(load_oracle_address_from_json(&path).is_none());
    }

    #[test]
    fn json_loader_parses_pyth_address_from_canonical_arc_manifest() {
        let path = write_temp(ARC_ORACLE_JSON, "perp-oracle-pyth-5042002.json");
        let addr = load_pyth_address_from_json(&path).expect("pyth field");
        assert_eq!(
            format!("{:#x}", addr).to_lowercase(),
            "0x2880ab155794e7179c9ee2e38200202908c17b43"
        );
    }

    #[test]
    fn json_loader_returns_none_for_pyth_when_field_missing() {
        let no_pyth = r#"{"FxOracle":"0xf9b0356A31BC7125e2eD0DADf8b5957860d42c78"}"#;
        let path = write_temp(no_pyth, "perp-oracle-nopyth.json");
        assert!(load_pyth_address_from_json(&path).is_none());
    }
}
