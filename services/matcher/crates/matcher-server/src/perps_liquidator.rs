//! Event-driven perp liquidation keeper.
//!
//! The canonical position set comes from Envio `PositionChange` events. The
//! matcher refreshes that set on boot and on a fallback interval, then scans it
//! whenever the shared Pyth WS pusher publishes a fresh price tick.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;

use alloy_primitives::{Address, B256, U256};
use futures::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::sync::broadcast;
use tokio::time::{interval, MissedTickBehavior};
use tracing::{debug, info, warn};

use bufi_perps_onchain::{PerpsOnchain, PerpsOnchainError};

use crate::config::Config;
use crate::pyth_pusher_ws::PythPriceTick;

const OPEN_POSITIONS_QUERY: &str = r#"
query PerpsLiquidatorOpenPositions($limit: Int!, $chainId: Int!) {
  PositionChange(
    limit: $limit
    where: { chainId: { _eq: $chainId } }
    order_by: { timestamp: desc }
  ) {
    marketId
    trader
    resultingSizeE18
    timestamp
    chainId
  }
}
"#;

#[derive(Debug, Error)]
pub enum PerpsLiquidatorBootError {
    #[error("invalid LIQUIDATOR_ENVIO_URL: {0}")]
    InvalidEnvioUrl(String),
    #[error("invalid liquidation router address: {0}")]
    InvalidRouterAddress(String),
    #[error("LiquidationRouter address missing; set LIQUIDATION_ROUTER_ADDRESS or add {0}")]
    MissingRouterManifest(String),
    #[error("read {path}: {source}")]
    RouterManifestIo {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("parse {path}: {source}")]
    RouterManifestParse {
        path: PathBuf,
        source: serde_json::Error,
    },
}

#[derive(Debug, Error)]
enum PerpsLiquidatorError {
    #[error("envio http: {0}")]
    EnvioHttp(String),
    #[error("envio graphql: {0}")]
    EnvioGraphql(String),
    #[error("on-chain: {0}")]
    Onchain(#[from] PerpsOnchainError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct PositionKey {
    market_id: B256,
    trader: Address,
}

#[derive(Debug, Clone, Copy)]
struct OpenPosition {
    market_id: B256,
    trader: Address,
    size_abs_e18: U256,
    updated_at: u64,
}

pub struct PerpsLiquidator {
    onchain: PerpsOnchain,
    router_address: Address,
    chain_id: u64,
    envio_url: String,
    check_interval: Duration,
    page_size: usize,
    max_concurrent_checks: usize,
    http: reqwest::Client,
    positions: BTreeMap<PositionKey, OpenPosition>,
    price_rx: broadcast::Receiver<PythPriceTick>,
}

impl PerpsLiquidator {
    pub fn new(
        onchain: PerpsOnchain,
        cfg: &Config,
        deployments_dir: &Path,
        price_rx: broadcast::Receiver<PythPriceTick>,
    ) -> Result<Option<Self>, PerpsLiquidatorBootError> {
        if !cfg.liquidator_enabled {
            return Ok(None);
        }

        let _: reqwest::Url = cfg
            .liquidator_envio_url
            .parse()
            .map_err(|e: url::ParseError| {
                PerpsLiquidatorBootError::InvalidEnvioUrl(e.to_string())
            })?;
        let router_address = resolve_router_address(cfg, deployments_dir, cfg.chain_id)?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("reqwest client builder");

        Ok(Some(Self {
            onchain,
            router_address,
            chain_id: cfg.chain_id,
            envio_url: cfg.liquidator_envio_url.clone(),
            check_interval: cfg.liquidator_check_interval,
            page_size: cfg.liquidator_page_size.max(1),
            max_concurrent_checks: cfg.liquidator_max_concurrent_checks.max(1),
            http,
            positions: BTreeMap::new(),
            price_rx,
        }))
    }

    pub async fn run(mut self) {
        info!(
            router = ?self.router_address,
            envio_url = %self.envio_url,
            interval_ms = self.check_interval.as_millis() as u64,
            "perps liquidator enabled"
        );

        if let Err(e) = self.refresh_positions().await {
            warn!(error = ?e, "perps liquidator: initial Envio refresh failed");
        }

        let mut fallback = interval(self.check_interval);
        fallback.set_missed_tick_behavior(MissedTickBehavior::Delay);
        fallback.tick().await;

        let mut price_closed = false;
        loop {
            tokio::select! {
                msg = self.price_rx.recv(), if !price_closed => {
                    match msg {
                        Ok(tick) => {
                            debug!(
                                feed = ?tick.feed_id,
                                publish_time = tick.publish_time,
                                "perps liquidator: Pyth tick received"
                            );
                            self.scan_open_positions("pyth_tick").await;
                        }
                        Err(broadcast::error::RecvError::Lagged(skipped)) => {
                            warn!(skipped, "perps liquidator: lagged Pyth ticks; refreshing Envio positions");
                            self.refresh_and_scan("pyth_lag").await;
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            warn!("perps liquidator: Pyth tick channel closed; using fallback interval only");
                            price_closed = true;
                        }
                    }
                }
                _ = fallback.tick() => {
                    self.refresh_and_scan("fallback").await;
                }
            }
        }
    }

    async fn refresh_and_scan(&mut self, source: &'static str) {
        if let Err(e) = self.refresh_positions().await {
            warn!(source, error = ?e, "perps liquidator: Envio refresh failed");
        }
        self.scan_open_positions(source).await;
    }

    async fn refresh_positions(&mut self) -> Result<usize, PerpsLiquidatorError> {
        let rows = self.fetch_position_changes().await?;
        self.positions = derive_open_positions(&rows, self.chain_id);
        let open = self.positions.len();
        debug!(open, "perps liquidator: position set refreshed");
        Ok(open)
    }

    async fn fetch_position_changes(&self) -> Result<Vec<PositionChangeRow>, PerpsLiquidatorError> {
        let request = GraphQlRequest {
            query: OPEN_POSITIONS_QUERY,
            variables: json!({
                "limit": self.page_size as i64,
                "chainId": self.chain_id as i64,
            }),
        };
        let response = self
            .http
            .post(&self.envio_url)
            .json(&request)
            .send()
            .await
            .map_err(|e| PerpsLiquidatorError::EnvioHttp(format!("send: {e}")))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(PerpsLiquidatorError::EnvioHttp(format!(
                "status {status}: {body}"
            )));
        }
        let body: GraphQlResponse<PositionChangeData> = response
            .json()
            .await
            .map_err(|e| PerpsLiquidatorError::EnvioHttp(format!("parse: {e}")))?;
        if let Some(errors) = body.errors.filter(|errs| !errs.is_empty()) {
            let messages = errors
                .into_iter()
                .map(|e| e.message)
                .collect::<Vec<_>>()
                .join("; ");
            return Err(PerpsLiquidatorError::EnvioGraphql(messages));
        }
        Ok(body.data.map(|d| d.position_changes).unwrap_or_default())
    }

    async fn scan_open_positions(&self, source: &'static str) {
        let positions = self.positions.values().copied().collect::<Vec<_>>();
        if positions.is_empty() {
            return;
        }
        let router = self.router_address;
        let onchain = self.onchain.clone();
        let max_concurrent = self.max_concurrent_checks;
        let results = stream::iter(positions)
            .map(|position| {
                let onchain = onchain.clone();
                async move { check_and_liquidate(onchain, router, position).await }
            })
            .buffer_unordered(max_concurrent)
            .collect::<Vec<_>>()
            .await;

        let mut liquidated = 0usize;
        let mut checked = 0usize;
        for result in results {
            checked += 1;
            match result {
                Ok(Some(tx)) => {
                    liquidated += 1;
                    info!(source, tx = ?tx, "perps liquidator: liquidation submitted");
                }
                Ok(None) => {}
                Err(e) => {
                    warn!(source, error = ?e, "perps liquidator: candidate check failed");
                }
            }
        }
        if liquidated != 0 {
            info!(
                source,
                checked, liquidated, "perps liquidator scan complete"
            );
        } else {
            debug!(source, checked, "perps liquidator scan complete");
        }
    }
}

async fn check_and_liquidate(
    onchain: PerpsOnchain,
    router_address: Address,
    position: OpenPosition,
) -> Result<Option<B256>, PerpsLiquidatorError> {
    let liquidatable = onchain
        .is_liquidatable(position.market_id, position.trader)
        .await?;
    if !liquidatable {
        return Ok(None);
    }

    let latest_size = onchain
        .position_size_abs(position.market_id, position.trader)
        .await?;
    let max_close = if latest_size > U256::ZERO {
        latest_size
    } else {
        position.size_abs_e18
    };
    if max_close == U256::ZERO {
        return Ok(None);
    }

    debug!(
        market = ?position.market_id,
        trader = ?position.trader,
        updated_at = position.updated_at,
        max_close = %max_close,
        "perps liquidator: submitting atomic liquidation"
    );
    let tx = onchain
        .submit_liquidation_router_atomic(
            router_address,
            position.market_id,
            position.trader,
            max_close,
        )
        .await?;
    Ok(Some(tx))
}

fn derive_open_positions(
    rows: &[PositionChangeRow],
    chain_id: u64,
) -> BTreeMap<PositionKey, OpenPosition> {
    let mut seen = BTreeSet::new();
    let mut positions = BTreeMap::new();
    for row in rows {
        if row.chain_id as u64 != chain_id {
            continue;
        }
        let Some(market_id) = parse_b256(&row.market_id) else {
            continue;
        };
        let Some(trader) = parse_address(&row.trader) else {
            continue;
        };
        let key = PositionKey { market_id, trader };
        if !seen.insert(key) {
            continue;
        }
        let Some(size_abs_e18) = parse_abs_u256(&row.resulting_size_e18) else {
            continue;
        };
        if size_abs_e18 == U256::ZERO {
            continue;
        }
        positions.insert(
            key,
            OpenPosition {
                market_id,
                trader,
                size_abs_e18,
                updated_at: row.timestamp as u64,
            },
        );
    }
    positions
}

fn resolve_router_address(
    cfg: &Config,
    deployments_dir: &Path,
    chain_id: u64,
) -> Result<Address, PerpsLiquidatorBootError> {
    if let Some(raw) = cfg.liquidation_router_address.as_deref() {
        return raw
            .parse::<Address>()
            .map_err(|e| PerpsLiquidatorBootError::InvalidRouterAddress(e.to_string()));
    }

    let path = deployments_dir.join(format!("liquidation-router-{chain_id}.json"));
    if !path.exists() {
        return Err(PerpsLiquidatorBootError::MissingRouterManifest(
            path.display().to_string(),
        ));
    }
    let raw =
        fs::read_to_string(&path).map_err(|source| PerpsLiquidatorBootError::RouterManifestIo {
            path: path.clone(),
            source,
        })?;
    let parsed: LiquidationRouterManifest = serde_json::from_str(&raw).map_err(|source| {
        PerpsLiquidatorBootError::RouterManifestParse {
            path: path.clone(),
            source,
        }
    })?;
    parsed
        .liquidation_router
        .parse::<Address>()
        .map_err(|e| PerpsLiquidatorBootError::InvalidRouterAddress(e.to_string()))
}

fn parse_b256(raw: &str) -> Option<B256> {
    B256::from_str(raw).ok()
}

fn parse_address(raw: &str) -> Option<Address> {
    Address::from_str(raw).ok()
}

fn parse_abs_u256(value: &Value) -> Option<U256> {
    let raw = match value {
        Value::String(s) => s.as_str(),
        Value::Number(n) => return U256::from_str(&n.to_string()).ok(),
        _ => return None,
    };
    let trimmed = raw.trim();
    let positive = trimmed.strip_prefix('-').unwrap_or(trimmed);
    U256::from_str(positive).ok()
}

#[derive(Debug, Serialize)]
struct GraphQlRequest<'a> {
    query: &'a str,
    variables: Value,
}

#[derive(Debug, Deserialize)]
struct GraphQlResponse<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Option<Vec<GraphQlError>>,
}

#[derive(Debug, Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct PositionChangeData {
    #[serde(rename = "PositionChange")]
    position_changes: Vec<PositionChangeRow>,
}

#[derive(Debug, Deserialize)]
struct PositionChangeRow {
    #[serde(rename = "marketId")]
    market_id: String,
    trader: String,
    #[serde(rename = "resultingSizeE18")]
    resulting_size_e18: Value,
    timestamp: i64,
    #[serde(rename = "chainId")]
    chain_id: i64,
}

#[derive(Debug, Deserialize)]
struct LiquidationRouterManifest {
    #[serde(rename = "LiquidationRouter")]
    liquidation_router: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    const MARKET_A: &str = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const MARKET_B: &str = "0x2222222222222222222222222222222222222222222222222222222222222222";
    const TRADER_A: &str = "0x00000000000000000000000000000000000000aA";
    const TRADER_B: &str = "0x00000000000000000000000000000000000000bB";

    #[test]
    fn parse_abs_u256_handles_signed_decimal_strings() {
        assert_eq!(
            parse_abs_u256(&Value::String("-123".into())).unwrap(),
            U256::from(123_u64)
        );
        assert_eq!(
            parse_abs_u256(&Value::String("456".into())).unwrap(),
            U256::from(456_u64)
        );
    }

    #[test]
    fn derive_open_positions_uses_latest_row_per_market_trader() {
        let rows = vec![
            row(MARKET_A, TRADER_A, "0", 100, 5_042_002),
            row(MARKET_A, TRADER_A, "100", 90, 5_042_002),
            row(MARKET_B, TRADER_B, "-250", 80, 5_042_002),
            row(MARKET_B, TRADER_B, "0", 70, 43113),
        ];
        let positions = derive_open_positions(&rows, 5_042_002);

        assert_eq!(positions.len(), 1);
        let position = positions.values().next().unwrap();
        assert_eq!(position.size_abs_e18, U256::from(250_u64));
        assert_eq!(position.updated_at, 80);
    }

    fn row(
        market_id: &str,
        trader: &str,
        size: &str,
        timestamp: i64,
        chain_id: i64,
    ) -> PositionChangeRow {
        PositionChangeRow {
            market_id: market_id.to_string(),
            trader: trader.to_string(),
            resulting_size_e18: Value::String(size.to_string()),
            timestamp,
            chain_id,
        }
    }
}
