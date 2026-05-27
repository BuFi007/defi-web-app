//! Rust replacement for `apps/keeper-spot`.
//!
//! The role discovers live SPOT_FX route ids from the API, reads prepared
//! Gateway contexts via the `/graph` Envio gateway, waits until the destination
//! hook state is `MINTED`, and submits `FxSpotExecutor.executeSpotFx(requestId)`
//! after re-checking the executor has not already handled the request.

use std::collections::BTreeSet;
use std::str::FromStr;
use std::time::Duration;

use alloy_network::EthereumWallet;
use alloy_primitives::{Address, B256};
use alloy_provider::ProviderBuilder;
use alloy_signer_local::PrivateKeySigner;
use alloy_sol_types::sol;
use serde::Deserialize;
use serde_json::{json, Value};
use thiserror::Error;
use tokio::time::sleep;
use tracing::{debug, info, warn};

use crate::config::Config;

const ARC_CHAIN_ID: u64 = 5_042_002;
const DEFAULT_ARC_RPC_URL: &str = "https://rpc.testnet.arc.network";
const DEFAULT_EXECUTOR: &str = "0x4e7372108529C0e7cb3aa0fF92B1c52e06e9e72f";
const FALLBACK_SPOT_ROUTE_IDS: [&str; 3] = [
    "0x4b50d101784ab33ee4adc9ca42080b10cdd2b23d71004a34a9625f3554e97f19",
    "0xda73657812ef2aa4a59ca67e8d757ac98155cf6aac04e6c0a1723b6f2799a47b",
    "0x4e26b194dd0f03e769ec58a34bcd4bbbe88f27d2aa1c502eb50dc20d4569512c",
];

const OPEN_SPOT_REQUESTS_QUERY: &str = r#"
query SpotExecutorOpenRequests($limit: Int!) {
  TelaranaGatewayContext(
    limit: $limit
    where: { gatewayAction: { _eq: 1 } }
  ) {
    id
    telaranaGatewayHook
    spotRouteId
  }
}
"#;

sol! {
    #[sol(rpc)]
    contract FxSpotExecutorContract {
        function executeSpotFx(bytes32 requestId) external returns (uint256 amountOut);
        function executed(bytes32 requestId) external view returns (bool);
    }

    #[sol(rpc)]
    contract TelaranaGatewayHubHookReadContract {
        function gatewayRequestState(bytes32 requestId) external view returns (uint8 state);
    }
}

#[derive(Debug, Error)]
pub enum SpotExecutorBootError {
    #[error("invalid BUFI_API_URL/TELARANA_API_URL: {0}")]
    InvalidApiUrl(String),
    #[error("invalid keeper signer key: {0}")]
    InvalidSignerKey(String),
    #[error("invalid FxSpotExecutor address: {0}")]
    InvalidExecutorAddress(String),
}

#[derive(Debug, Error)]
enum SpotExecutorError {
    #[error("api http: {0}")]
    ApiHttp(String),
    #[error("api graphql: {0}")]
    ApiGraphql(String),
    #[error("api parse: {0}")]
    ApiParse(String),
    #[error("invalid RPC URL: {0}")]
    InvalidRpcUrl(String),
    #[error("on-chain: {0}")]
    Onchain(String),
}

pub struct SpotExecutor {
    api_url: String,
    chain_id: u64,
    executor: Address,
    interval: Duration,
    dry_run: bool,
    candidate_limit: usize,
    signer_key_hex: String,
    http: reqwest::Client,
}

impl SpotExecutor {
    pub fn new(cfg: &Config, signer_key_hex: &str) -> Result<Option<Self>, SpotExecutorBootError> {
        if !cfg.spot_executor_enabled {
            return Ok(None);
        }

        let api_url = normalize_api_url(&cfg.telarana_api_url)
            .map_err(SpotExecutorBootError::InvalidApiUrl)?;
        let _signer: PrivateKeySigner =
            signer_key_hex
                .parse()
                .map_err(|e: alloy_signer_local::LocalSignerError| {
                    SpotExecutorBootError::InvalidSignerKey(e.to_string())
                })?;
        let executor = std::env::var("SPOT_EXECUTOR_ADDRESS")
            .unwrap_or_else(|_| DEFAULT_EXECUTOR.to_string())
            .parse::<Address>()
            .map_err(|e| SpotExecutorBootError::InvalidExecutorAddress(e.to_string()))?;
        let interval = Duration::from_millis(env_u64("SPOT_EXECUTOR_INTERVAL_MS", 5_000));
        let dry_run = env_bool("SPOT_EXECUTOR_DRY_RUN", false);
        let candidate_limit = env_u64("SPOT_EXECUTOR_CANDIDATE_LIMIT", 100).max(1) as usize;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("reqwest client builder");

        Ok(Some(Self {
            api_url,
            chain_id: ARC_CHAIN_ID,
            executor,
            interval,
            dry_run,
            candidate_limit,
            signer_key_hex: signer_key_hex.to_string(),
            http,
        }))
    }

    pub async fn run(self) {
        info!(
            api_url = %self.api_url,
            executor = ?self.executor,
            dry_run = self.dry_run,
            interval_ms = self.interval.as_millis() as u64,
            "spot executor enabled"
        );

        loop {
            if let Err(e) = self.scan_once().await {
                warn!(error = ?e, "spot executor scan failed");
            }
            sleep(self.interval).await;
        }
    }

    async fn scan_once(&self) -> Result<(), SpotExecutorError> {
        let route_ids = self.fetch_spot_route_ids().await;
        let candidates = self.fetch_open_requests().await?;
        if candidates.is_empty() {
            debug!("spot executor: no open requests");
            return Ok(());
        }

        let mut executed = 0usize;
        let mut skipped = 0usize;
        let mut failed = 0usize;

        for candidate in candidates {
            if !route_ids.contains(&candidate.spot_route_id) {
                skipped += 1;
                continue;
            }
            match self.process_candidate(candidate).await {
                Ok(SpotOutcome::Executed(tx)) => {
                    executed += 1;
                    info!(tx = ?tx, "spot executor: request executed");
                }
                Ok(SpotOutcome::DryRun) | Ok(SpotOutcome::Skipped) => {
                    skipped += 1;
                }
                Err(e) => {
                    failed += 1;
                    warn!(error = ?e, "spot executor request failed");
                }
            }
        }

        info!(executed, skipped, failed, "spot executor scan complete");
        Ok(())
    }

    async fn fetch_spot_route_ids(&self) -> BTreeSet<B256> {
        match self.fetch_market_route_ids().await {
            Ok(route_ids) if !route_ids.is_empty() => route_ids,
            Ok(_) | Err(_) => FALLBACK_SPOT_ROUTE_IDS
                .into_iter()
                .filter_map(|id| B256::from_str(id).ok())
                .collect(),
        }
    }

    async fn fetch_market_route_ids(&self) -> Result<BTreeSet<B256>, SpotExecutorError> {
        let url = format!("{}/markets?chainId={}", self.api_url, self.chain_id);
        let res = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| SpotExecutorError::ApiHttp(format!("send {url}: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(SpotExecutorError::ApiHttp(format!(
                "markets status {status}: {body}"
            )));
        }
        let envelope: MarketsEnvelope = res
            .json()
            .await
            .map_err(|e| SpotExecutorError::ApiParse(e.to_string()))?;
        Ok(envelope
            .markets
            .into_iter()
            .filter(|market| market.enabled.unwrap_or(true))
            .filter(|market| {
                market.source.as_deref() == Some("pyth")
                    || market
                        .symbol
                        .as_deref()
                        .is_some_and(|symbol| symbol.starts_with("USDC/"))
            })
            .filter_map(|market| B256::from_str(&market.market_id).ok())
            .collect())
    }

    async fn fetch_open_requests(&self) -> Result<Vec<SpotRequest>, SpotExecutorError> {
        let request = GraphQlRequest {
            query: OPEN_SPOT_REQUESTS_QUERY,
            variables: json!({
                "limit": self.candidate_limit as i64,
            }),
        };
        let url = format!("{}/graph", self.api_url);
        let res = self
            .http
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| SpotExecutorError::ApiHttp(format!("send {url}: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(SpotExecutorError::ApiHttp(format!(
                "graph status {status}: {body}"
            )));
        }
        let body: GraphQlResponse<SpotRequestsData> = res
            .json()
            .await
            .map_err(|e| SpotExecutorError::ApiParse(e.to_string()))?;
        if let Some(errors) = body.errors.filter(|errs| !errs.is_empty()) {
            return Err(SpotExecutorError::ApiGraphql(
                errors
                    .into_iter()
                    .map(|e| e.message)
                    .collect::<Vec<_>>()
                    .join("; "),
            ));
        }
        Ok(body
            .data
            .map(|data| data.telarana_loans)
            .unwrap_or_default()
            .into_iter()
            .filter_map(SpotRequest::from_row)
            .collect())
    }

    async fn process_candidate(
        &self,
        candidate: SpotRequest,
    ) -> Result<SpotOutcome, SpotExecutorError> {
        let rpc_url = arc_rpc_url()?;
        let signer: PrivateKeySigner =
            self.signer_key_hex
                .parse()
                .map_err(|e: alloy_signer_local::LocalSignerError| {
                    SpotExecutorError::Onchain(format!("invalid signer: {e}"))
                })?;
        let wallet = EthereumWallet::from(signer);
        let provider = ProviderBuilder::new()
            .wallet(wallet)
            .connect_http(rpc_url);
        let contract = FxSpotExecutorContract::new(self.executor, &provider);

        let hook = TelaranaGatewayHubHookReadContract::new(candidate.telarana_gateway_hook, &provider);
        let gateway_state = hook
            .gatewayRequestState(candidate.request_id)
            .call()
            .await
            .map_err(|e| SpotExecutorError::Onchain(format!("gatewayRequestState read: {e}")))?;
        if gateway_state != 1 {
            return Ok(SpotOutcome::Skipped);
        }

        let already_executed = contract
            .executed(candidate.request_id)
            .call()
            .await
            .map_err(|e| SpotExecutorError::Onchain(format!("executed read: {e}")))?;
        if already_executed {
            return Ok(SpotOutcome::Skipped);
        }

        if self.dry_run {
            info!(
                request_id = ?candidate.request_id,
                route = ?candidate.spot_route_id,
                "spot executor dry-run request"
            );
            return Ok(SpotOutcome::DryRun);
        }

        let pending = contract
            .executeSpotFx(candidate.request_id)
            .send()
            .await
            .map_err(|e| SpotExecutorError::Onchain(format!("executeSpotFx send: {e}")))?;
        let receipt = pending
            .get_receipt()
            .await
            .map_err(|e| SpotExecutorError::Onchain(format!("executeSpotFx receipt: {e}")))?;
        let tx = receipt.transaction_hash;
        if !receipt.status() {
            return Err(SpotExecutorError::Onchain(format!(
                "executeSpotFx reverted (tx {tx:#x})"
            )));
        }
        Ok(SpotOutcome::Executed(tx))
    }
}

enum SpotOutcome {
    Executed(B256),
    DryRun,
    Skipped,
}

#[derive(Debug, Deserialize)]
struct MarketsEnvelope {
    #[serde(default)]
    markets: Vec<ApiMarket>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiMarket {
    market_id: String,
    symbol: Option<String>,
    source: Option<String>,
    enabled: Option<bool>,
}

#[derive(Debug, serde::Serialize)]
struct GraphQlRequest<'a> {
    query: &'a str,
    variables: Value,
}

#[derive(Debug, Deserialize)]
struct GraphQlResponse<T> {
    data: Option<T>,
    errors: Option<Vec<GraphQlError>>,
}

#[derive(Debug, Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct SpotRequestsData {
    #[serde(default, rename = "TelaranaGatewayContext")]
    telarana_loans: Vec<SpotRequestRow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpotRequestRow {
    id: String,
    telarana_gateway_hook: String,
    spot_route_id: String,
}

#[derive(Debug, Clone)]
struct SpotRequest {
    request_id: B256,
    telarana_gateway_hook: Address,
    spot_route_id: B256,
}

impl SpotRequest {
    fn from_row(row: SpotRequestRow) -> Option<Self> {
        Some(Self {
            request_id: B256::from_str(&row.id).ok()?,
            telarana_gateway_hook: row.telarana_gateway_hook.parse().ok()?,
            spot_route_id: B256::from_str(&row.spot_route_id).ok()?,
        })
    }
}

fn normalize_api_url(raw: &str) -> Result<String, String> {
    let parsed: reqwest::Url = raw.parse().map_err(|e: url::ParseError| e.to_string())?;
    let mut out = parsed.to_string();
    while out.ends_with('/') {
        out.pop();
    }
    Ok(out)
}

fn arc_rpc_url() -> Result<reqwest::Url, SpotExecutorError> {
    let raw = std::env::var("SPOT_EXECUTOR_RPC_URL")
        .or_else(|_| std::env::var("TELARANA_ARC_RPC_URL"))
        .or_else(|_| std::env::var("ARC_RPC_URL"))
        .unwrap_or_else(|_| DEFAULT_ARC_RPC_URL.to_string());
    raw.parse::<reqwest::Url>()
        .map_err(|e| SpotExecutorError::InvalidRpcUrl(e.to_string()))
}

fn env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .unwrap_or(default)
}

fn env_bool(name: &str, default: bool) -> bool {
    std::env::var(name)
        .map(|raw| {
            matches!(
                raw.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(default)
}
