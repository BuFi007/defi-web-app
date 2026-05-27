//! Rust replacement for `apps/keeper-telarana-liquidator`.
//!
//! The loop pulls candidates from the BUFI API, re-checks each account's
//! health before sending, and calls `FxLiquidator.liquidate` on the candidate
//! hub. It intentionally keeps the API as the candidate source until Envio is
//! the canonical lending-position indexer.

use std::str::FromStr;
use std::time::Duration;

use alloy_network::EthereumWallet;
use alloy_primitives::{Address, Bytes, B256, U256};
use alloy_provider::ProviderBuilder;
use alloy_signer_local::PrivateKeySigner;
use alloy_sol_types::sol;
use serde::Deserialize;
use serde_json::Value;
use thiserror::Error;
use tokio::time::sleep;
use tracing::{debug, info, warn};

use crate::config::Config;

const WAD: U256 = U256::from_limbs([1_000_000_000_000_000_000, 0, 0, 0]);
const MAX_REPAY_ASSETS: U256 = U256::from_limbs([
    18_446_744_073_709_551_615,
    18_446_744_073_709_551_615,
    18_446_744_073_709_551_615,
    9_223_372_036_854_775_807,
]);

sol! {
    #[sol(rpc)]
    contract FxLiquidator {
        function liquidate(
            address loanToken,
            address collateralToken,
            address borrower,
            uint256 seizedAssets,
            uint256 repaidShares,
            uint256 maxRepayAssets,
            bool useVerified,
            bytes[] pythUpdate
        ) external payable returns (uint256 seized, uint256 repaid);
    }
}

#[derive(Debug, Error)]
pub enum TelaranaLiquidatorBootError {
    #[error("invalid TELARANA_API_URL: {0}")]
    InvalidApiUrl(String),
    #[error("invalid keeper signer key: {0}")]
    InvalidSignerKey(String),
}

#[derive(Debug, Error)]
enum TelaranaLiquidatorError {
    #[error("unsupported hub chain id {0}")]
    UnsupportedChain(u64),
    #[error("invalid RPC URL for chain {chain_id}: {reason}")]
    InvalidRpcUrl { chain_id: u64, reason: String },
    #[error("invalid liquidator address for chain {chain_id}: {reason}")]
    InvalidLiquidatorAddress { chain_id: u64, reason: String },
    #[error("api http: {0}")]
    ApiHttp(String),
    #[error("api parse: {0}")]
    ApiParse(String),
    #[error("on-chain: {0}")]
    Onchain(String),
}

#[derive(Debug, Clone)]
pub struct TelaranaLiquidator {
    api_url: String,
    chain_ids: Vec<u64>,
    interval: Duration,
    dry_run: bool,
    candidate_limit: usize,
    signer_key_hex: String,
    http: reqwest::Client,
}

impl TelaranaLiquidator {
    pub fn new(
        cfg: &Config,
        signer_key_hex: &str,
    ) -> Result<Option<Self>, TelaranaLiquidatorBootError> {
        if !cfg.telarana_liquidator_enabled {
            return Ok(None);
        }
        let api_url = normalize_api_url(&cfg.telarana_api_url)
            .map_err(TelaranaLiquidatorBootError::InvalidApiUrl)?;
        let _signer: PrivateKeySigner =
            signer_key_hex
                .parse()
                .map_err(|e: alloy_signer_local::LocalSignerError| {
                    TelaranaLiquidatorBootError::InvalidSignerKey(e.to_string())
                })?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("reqwest client builder");
        Ok(Some(Self {
            api_url,
            chain_ids: cfg.telarana_liquidator_chain_ids.clone(),
            interval: cfg.telarana_liquidator_interval,
            dry_run: cfg.telarana_liquidator_dry_run,
            candidate_limit: cfg.telarana_liquidator_candidate_limit.max(1),
            signer_key_hex: signer_key_hex.to_string(),
            http,
        }))
    }

    pub async fn run(self) {
        info!(
            api_url = %self.api_url,
            chain_ids = ?self.chain_ids,
            dry_run = self.dry_run,
            interval_ms = self.interval.as_millis() as u64,
            "telarana liquidator enabled"
        );
        loop {
            self.scan_all_hubs().await;
            sleep(self.interval).await;
        }
    }

    async fn scan_all_hubs(&self) {
        for chain_id in &self.chain_ids {
            if let Err(e) = self.scan_hub(*chain_id).await {
                warn!(chain_id, error = ?e, "telarana liquidator scan failed");
            }
        }
    }

    async fn scan_hub(&self, chain_id: u64) -> Result<(), TelaranaLiquidatorError> {
        let mut candidates = self.fetch_candidates(chain_id).await?;
        if candidates.is_empty() {
            debug!(chain_id, "telarana liquidator: no candidates");
            return Ok(());
        }
        candidates.sort_by(|a, b| a.health_factor_e18.cmp(&b.health_factor_e18));

        let mut liquidated = 0usize;
        let mut skipped = 0usize;
        let mut failed = 0usize;
        for candidate in candidates {
            match self.process_candidate(candidate).await {
                Ok(CandidateOutcome::Liquidated(tx)) => {
                    liquidated += 1;
                    info!(chain_id, tx = ?tx, "telarana liquidator: liquidation submitted");
                }
                Ok(CandidateOutcome::DryRun) | Ok(CandidateOutcome::Skipped) => {
                    skipped += 1;
                }
                Err(e) => {
                    failed += 1;
                    warn!(chain_id, error = ?e, "telarana liquidator candidate failed");
                }
            }
        }

        info!(
            chain_id,
            liquidated, skipped, failed, "telarana liquidator scan complete"
        );
        Ok(())
    }

    async fn fetch_candidates(
        &self,
        chain_id: u64,
    ) -> Result<Vec<LiquidationCandidate>, TelaranaLiquidatorError> {
        let url = format!(
            "{}/fx-telarana/liquidations/candidates?hubChainId={chain_id}&limit={}",
            self.api_url, self.candidate_limit
        );
        let res = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| TelaranaLiquidatorError::ApiHttp(format!("send {url}: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(TelaranaLiquidatorError::ApiHttp(format!(
                "status {status}: {body}"
            )));
        }
        let envelope: CandidatesEnvelope = res
            .json()
            .await
            .map_err(|e| TelaranaLiquidatorError::ApiParse(e.to_string()))?;
        Ok(envelope
            .candidates
            .into_iter()
            .filter_map(|raw| LiquidationCandidate::from_raw(raw).ok())
            .filter(|candidate| candidate.hub_chain_id == chain_id)
            .filter(is_still_liquidatable)
            .collect())
    }

    async fn process_candidate(
        &self,
        candidate: LiquidationCandidate,
    ) -> Result<CandidateOutcome, TelaranaLiquidatorError> {
        let fresh = self
            .fetch_position(
                candidate.hub_chain_id,
                candidate.account,
                candidate.market_id,
            )
            .await?;
        let Some(fresh) = fresh else {
            return Ok(CandidateOutcome::Skipped);
        };
        if !is_still_liquidatable(&fresh) {
            return Ok(CandidateOutcome::Skipped);
        }

        let market = self
            .fetch_market(candidate.hub_chain_id, candidate.market_id)
            .await?;
        if self.dry_run {
            info!(
                chain_id = candidate.hub_chain_id,
                account = ?candidate.account,
                market_id = ?candidate.market_id,
                health_factor = %fresh.health_factor_e18,
                collateral = %fresh.collateral,
                "telarana liquidator dry-run candidate"
            );
            return Ok(CandidateOutcome::DryRun);
        }

        let tx = self
            .submit_liquidation(candidate.hub_chain_id, market, fresh)
            .await?;
        Ok(CandidateOutcome::Liquidated(tx))
    }

    async fn fetch_position(
        &self,
        chain_id: u64,
        account: Address,
        market_id: B256,
    ) -> Result<Option<LiquidationCandidate>, TelaranaLiquidatorError> {
        let url = format!(
            "{}/fx-telarana/positions/{account:#x}/{market_id:#x}?hubChainId={chain_id}",
            self.api_url
        );
        let res = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| TelaranaLiquidatorError::ApiHttp(format!("send {url}: {e}")))?;
        if res.status().as_u16() == 404 {
            return Ok(None);
        }
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(TelaranaLiquidatorError::ApiHttp(format!(
                "position status {status}: {body}"
            )));
        }
        let envelope: PositionEnvelope = res
            .json()
            .await
            .map_err(|e| TelaranaLiquidatorError::ApiParse(e.to_string()))?;
        let candidate = LiquidationCandidate::from_raw(envelope.position)?;
        Ok(Some(candidate))
    }

    async fn fetch_market(
        &self,
        chain_id: u64,
        market_id: B256,
    ) -> Result<TelaranaMarket, TelaranaLiquidatorError> {
        let url = format!(
            "{}/fx-telarana/markets/{chain_id}/{market_id:#x}",
            self.api_url
        );
        let res = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| TelaranaLiquidatorError::ApiHttp(format!("send {url}: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(TelaranaLiquidatorError::ApiHttp(format!(
                "market status {status}: {body}"
            )));
        }
        let envelope: MarketEnvelope = res
            .json()
            .await
            .map_err(|e| TelaranaLiquidatorError::ApiParse(e.to_string()))?;
        Ok(envelope.market)
    }

    async fn submit_liquidation(
        &self,
        chain_id: u64,
        market: TelaranaMarket,
        position: LiquidationCandidate,
    ) -> Result<B256, TelaranaLiquidatorError> {
        let liquidator = liquidator_address_for_chain(chain_id)?;
        let rpc_url = rpc_url_for_chain(chain_id)?;
        let signer: PrivateKeySigner =
            self.signer_key_hex
                .parse()
                .map_err(|e: alloy_signer_local::LocalSignerError| {
                    TelaranaLiquidatorError::Onchain(format!("invalid signer: {e}"))
                })?;
        let wallet = EthereumWallet::from(signer);
        let provider = ProviderBuilder::new()
            .wallet(wallet)
            .connect_http(rpc_url);
        let contract = FxLiquidator::new(liquidator, &provider);
        let pending = contract
            .liquidate(
                market.loan_token,
                market.collateral_token,
                position.account,
                position.collateral,
                U256::ZERO,
                MAX_REPAY_ASSETS,
                true,
                Vec::<Bytes>::new(),
            )
            .send()
            .await
            .map_err(|e| TelaranaLiquidatorError::Onchain(format!("liquidate send: {e}")))?;
        let receipt = pending
            .get_receipt()
            .await
            .map_err(|e| TelaranaLiquidatorError::Onchain(format!("liquidate receipt: {e}")))?;
        let tx = receipt.transaction_hash;
        if !receipt.status() {
            return Err(TelaranaLiquidatorError::Onchain(format!(
                "liquidate reverted (tx {tx:#x})"
            )));
        }
        Ok(tx)
    }
}

enum CandidateOutcome {
    Liquidated(B256),
    DryRun,
    Skipped,
}

#[derive(Debug, Deserialize)]
struct CandidatesEnvelope {
    #[serde(default)]
    candidates: Vec<Value>,
}

#[derive(Debug, Deserialize)]
struct PositionEnvelope {
    position: Value,
}

#[derive(Debug, Deserialize)]
struct MarketEnvelope {
    market: TelaranaMarket,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TelaranaMarket {
    loan_token: Address,
    collateral_token: Address,
}

#[derive(Debug, Clone)]
struct LiquidationCandidate {
    market_id: B256,
    hub_chain_id: u64,
    account: Address,
    collateral: U256,
    health_factor_e18: U256,
}

impl LiquidationCandidate {
    fn from_raw(raw: Value) -> Result<Self, TelaranaLiquidatorError> {
        let market_id = parse_b256(raw.get("marketId"))
            .ok_or_else(|| TelaranaLiquidatorError::ApiParse("candidate.marketId".into()))?;
        let hub_chain_id = raw
            .get("hubChainId")
            .and_then(parse_u64_value)
            .ok_or_else(|| TelaranaLiquidatorError::ApiParse("candidate.hubChainId".into()))?;
        let account = parse_address(raw.get("account"))
            .ok_or_else(|| TelaranaLiquidatorError::ApiParse("candidate.account".into()))?;
        let collateral = parse_u256(raw.get("collateral"))
            .ok_or_else(|| TelaranaLiquidatorError::ApiParse("candidate.collateral".into()))?;
        let health_factor_e18 = parse_u256(raw.get("healthFactorE18"))
            .ok_or_else(|| TelaranaLiquidatorError::ApiParse("candidate.healthFactorE18".into()))?;
        Ok(Self {
            market_id,
            hub_chain_id,
            account,
            collateral,
            health_factor_e18,
        })
    }
}

fn is_still_liquidatable(candidate: &LiquidationCandidate) -> bool {
    candidate.health_factor_e18 < WAD && candidate.collateral > U256::ZERO
}

fn normalize_api_url(raw: &str) -> Result<String, String> {
    let parsed: reqwest::Url = raw.parse().map_err(|e: url::ParseError| e.to_string())?;
    let mut out = parsed.to_string();
    while out.ends_with('/') {
        out.pop();
    }
    Ok(out)
}

fn rpc_url_for_chain(chain_id: u64) -> Result<reqwest::Url, TelaranaLiquidatorError> {
    let raw = match chain_id {
        43113 => std::env::var("TELARANA_FUJI_RPC_URL")
            .or_else(|_| std::env::var("PONDER_RPC_URL_AVAX_FUJI"))
            .or_else(|_| std::env::var("FUJI_RPC_URL"))
            .unwrap_or_else(|_| "https://avalanche-fuji.gateway.tenderly.co".to_string()),
        5042002 => std::env::var("TELARANA_ARC_RPC_URL")
            .or_else(|_| std::env::var("PONDER_RPC_URL_ARC_TESTNET"))
            .or_else(|_| std::env::var("ARC_RPC_URL"))
            .unwrap_or_else(|_| "https://rpc.testnet.arc.network".to_string()),
        other => return Err(TelaranaLiquidatorError::UnsupportedChain(other)),
    };
    raw.parse::<reqwest::Url>()
        .map_err(|e| TelaranaLiquidatorError::InvalidRpcUrl {
            chain_id,
            reason: e.to_string(),
        })
}

fn liquidator_address_for_chain(chain_id: u64) -> Result<Address, TelaranaLiquidatorError> {
    let env_name = format!("TELARANA_LIQUIDATOR_ADDRESS_{chain_id}");
    let raw = std::env::var(&env_name)
        .or_else(|_| std::env::var("TELARANA_LIQUIDATOR_ADDRESS"))
        .unwrap_or_else(|_| match chain_id {
            43113 => "0x2900599ff0e6dd057493d62fac856e5a8f93c6eb".to_string(),
            5042002 => "0xa50f7D4D4a1A0D3CF418515973545b80E037B379".to_string(),
            _ => String::new(),
        });
    Address::from_str(&raw).map_err(|e| TelaranaLiquidatorError::InvalidLiquidatorAddress {
        chain_id,
        reason: e.to_string(),
    })
}

fn parse_b256(value: Option<&Value>) -> Option<B256> {
    value
        .and_then(Value::as_str)
        .and_then(|s| B256::from_str(s).ok())
}

fn parse_address(value: Option<&Value>) -> Option<Address> {
    value
        .and_then(Value::as_str)
        .and_then(|s| Address::from_str(s).ok())
}

fn parse_u256(value: Option<&Value>) -> Option<U256> {
    match value? {
        Value::String(s) => U256::from_str(s.trim()).ok(),
        Value::Number(n) => U256::from_str(&n.to_string()).ok(),
        _ => None,
    }
}

fn parse_u64_value(value: &Value) -> Option<u64> {
    match value {
        Value::String(s) => s.parse().ok(),
        Value::Number(n) => n.as_u64(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_stringified_candidate_numbers() {
        let raw = json!({
            "marketId": "0x1111111111111111111111111111111111111111111111111111111111111111",
            "hubChainId": "43113",
            "account": "0x00000000000000000000000000000000000000aA",
            "collateral": "42",
            "healthFactorE18": "999999999999999999"
        });

        let candidate = LiquidationCandidate::from_raw(raw).unwrap();
        assert_eq!(candidate.hub_chain_id, 43113);
        assert_eq!(candidate.collateral, U256::from(42));
        assert!(is_still_liquidatable(&candidate));
    }

    #[test]
    fn rejects_healthy_candidate() {
        let candidate = LiquidationCandidate {
            market_id: B256::ZERO,
            hub_chain_id: 43113,
            account: Address::ZERO,
            collateral: U256::from(1),
            health_factor_e18: WAD,
        };
        assert!(!is_still_liquidatable(&candidate));
    }

    #[test]
    fn normalizes_api_url_without_trailing_slash() {
        assert_eq!(
            normalize_api_url("http://localhost:3002/").unwrap(),
            "http://localhost:3002"
        );
    }
}
