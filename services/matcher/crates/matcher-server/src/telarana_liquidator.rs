//! Rust replacement for `apps/keeper-telarana-liquidator`.
//!
//! The loop pulls candidates from the BUFI API, re-checks each account's
//! health before sending, and calls `FxLiquidator.liquidate` on the candidate
//! hub. It intentionally keeps the API as the candidate source until Envio is
//! the canonical lending-position indexer.

use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use alloy_primitives::{Address, Bytes, B256, U256};
use alloy_signer_local::PrivateKeySigner;
use alloy_sol_types::sol;
use serde::Deserialize;
use serde_json::Value;
use thiserror::Error;
use tokio::time::sleep;
use tracing::{debug, info, warn};

use crate::config::Config;
use crate::tx_submitter::{TxSubmitter, TxSubmitterRegistry};

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
    #[error("no tx_submitter registered for chain {0}")]
    NoTxSubmitter(u64),
    #[error("invalid liquidator address for chain {chain_id}: {reason}")]
    InvalidLiquidatorAddress { chain_id: u64, reason: String },
    #[error("api http: {0}")]
    ApiHttp(String),
    #[error("api parse: {0}")]
    ApiParse(String),
    #[error("on-chain: {0}")]
    Onchain(String),
}

#[derive(Clone)]
pub struct TelaranaLiquidator {
    api_url: String,
    chain_ids: Vec<u64>,
    interval: Duration,
    dry_run: bool,
    candidate_limit: usize,
    tx_submitters: TxSubmitterRegistry,
    http: reqwest::Client,
}

impl TelaranaLiquidator {
    pub fn new(
        cfg: &Config,
        signer_key_hex: &str,
        tx_submitters: TxSubmitterRegistry,
    ) -> Result<Option<Self>, TelaranaLiquidatorBootError> {
        if !cfg.telarana_liquidator_enabled {
            return Ok(None);
        }
        let api_url = normalize_api_url(&cfg.telarana_api_url)
            .map_err(TelaranaLiquidatorBootError::InvalidApiUrl)?;
        // Validate the signer key matches what tx_submitter already
        // initialised. tx_submitter owns the actual signing; we just
        // fail-fast here if the caller hands us garbage.
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
            tx_submitters,
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
        let submitter = self
            .tx_submitters
            .get(chain_id)
            .ok_or(TelaranaLiquidatorError::NoTxSubmitter(chain_id))?;
        let tx_request = build_liquidate_request(
            &submitter,
            liquidator,
            market,
            position,
        );
        submitter
            .submit_tx(tx_request, "telarana.liquidate")
            .await
            .map_err(|e| TelaranaLiquidatorError::Onchain(e.to_string()))
    }
}

/// Build the `liquidate(...)` transaction request using the shared
/// provider attached to `submitter`. Goes through `into_transaction_request`
/// so the submitter can stamp `nonce` + `from` and serialise the send.
fn build_liquidate_request(
    submitter: &Arc<TxSubmitter>,
    liquidator: Address,
    market: TelaranaMarket,
    position: LiquidationCandidate,
) -> alloy_rpc_types_eth::TransactionRequest {
    let contract = FxLiquidator::new(liquidator, submitter.provider());
    contract
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
        .into_transaction_request()
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
