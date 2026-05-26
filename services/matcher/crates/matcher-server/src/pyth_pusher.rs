//! Phase 7.2 — Pyth oracle pusher.
//!
//! Fetches fresh price-update VAAs from Pyth Hermes and pushes them on-chain
//! so `FxOracle.getMid` returns without falling through to RedStone (which
//! requires payload-wrapped calls the matcher doesn't construct). Same root
//! cause unblocks BUFX `FxSpotExecutor` if/when that path is exercised on
//! Arc — see `docs/matcher-integration-runbook.md` §6.5 F3.
//!
//! ## Design
//!
//! Mirrors `funding_poker`: per-feed throttle, in-memory state, fail-soft
//! on transient errors. Boot sequence:
//!
//!   1. For each market in `MATCHER_FUNDING_MARKET_IDS`, read
//!      `FxPerpClearinghouse.marketConfig(market_id).baseToken`, then
//!      `FxOracle.pythFeedOf(baseToken)`. Quote feed is the USDC feed
//!      (`pythFeedOf(USDC)`).
//!   2. Dedupe into a Set<bytes32> of feed ids. Cache.
//!   3. Every `PYTH_PUSH_INTERVAL_MS` (default 5s):
//!      - Check the on-chain `publishTime` of EACH feed via
//!        `IPyth.getPriceUnsafe(id).publishTime`. If `publishTime +
//!        PYTH_PUSH_MAX_AGE_SECS > now`, skip — the feed is fresh.
//!      - Fetch fresh VAAs from
//!        `https://hermes.pyth.network/v2/updates/price/latest?ids[]=…`
//!        for any feeds that need a push.
//!      - Call `IPyth.updatePriceFeeds{value: fee}(updateData)`.
//!
//! ## Cost
//!
//! Arc Testnet uses USDC as native gas. Each `updatePriceFeeds` call costs
//! a small fee (returned by `getUpdateFee`); the keeper EOA must hold USDC
//! to fund this. Today this is shared with the `settleMatch` EOA — pre-
//! merge for mainnet, consider splitting via env override `PYTH_PUSHER_PRIVATE_KEY`.

use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use alloy_network::EthereumWallet;
use alloy_primitives::{Address, Bytes, B256};
use alloy_provider::ProviderBuilder;
use alloy_signer_local::PrivateKeySigner;
use serde::Deserialize;
use thiserror::Error;
use tokio::sync::broadcast;
use tokio::time::sleep;
use tracing::{debug, info, warn};

use bufi_perps_onchain::bindings::{FxPerpClearinghouse, IPyth};
use bufi_perps_onchain::{resolve_pyth_address, PerpsOnchain, PerpsOnchainError};

use crate::config::Config;
use crate::lp_state::market_id_hex;
use crate::pyth_pusher_ws::{derive_ws_url, PythPriceTick, PythPusherWs};

/// Errors raised at boot. Runtime tick errors log + retry; only boot misconfig aborts.
#[derive(Debug, Error)]
pub enum PythPusherBootError {
    /// `PYTH_ADDRESS` env / `perp-oracle-{chainId}.json` resolution failed.
    #[error("resolve pyth: {0}")]
    ResolveAddress(#[from] PerpsOnchainError),
    /// Hermes URL didn't parse.
    #[error("invalid PYTH_HERMES_URL: {0}")]
    InvalidHermesUrl(String),
    /// Could not parse the USDC address (for the quote-side feed lookup).
    #[error("USDC_ADDRESS parse: {0}")]
    InvalidUsdcAddress(String),
}

/// One configured pusher — owns the resolved feed set + per-feed throttle.
pub struct PythPusher {
    onchain: PerpsOnchain,
    hermes_url: String,
    hermes_timeout: Duration,
    poll_interval: Duration,
    max_age_secs: u64,
    pyth_address: Address,
    /// Markets we're keeping fresh. Resolved at boot.
    market_ids: Vec<[u8; 32]>,
    /// USDC token address — the quote-side feed for all sprint-1 markets.
    usdc_address: Address,
    /// Feed-id set populated at boot via `seed_from_chain`. `BTreeSet` so
    /// the iteration order is deterministic (matches funding_poker style).
    feed_ids: BTreeSet<B256>,
    /// Last push attempt per feed, unix secs. Used for staleness gating.
    /// Empty until the first tick after `seed_from_chain` runs.
    last_push_secs: BTreeMap<B256, u64>,
    hermes_client: reqwest::Client,
    /// Phase 8.5c — when true, dispatch to the WS path on `run()`.
    /// HTTP poll is retained as fall-back when WS exhausts its
    /// reconnect budget.
    use_ws: bool,
    /// Phase 8.5c — derived `wss://…/ws` URL. Empty when `use_ws=false`.
    ws_url: String,
    /// Optional price-tick publisher for in-process consumers.
    price_tx: Option<broadcast::Sender<PythPriceTick>>,
}

impl PythPusher {
    /// Build from config. Returns `Ok(None)` when there are no markets to
    /// keep fresh — the matcher boots happily without a pusher in that case.
    pub fn new(
        onchain: PerpsOnchain,
        cfg: &Config,
        price_tx: Option<broadcast::Sender<PythPriceTick>>,
    ) -> Result<Option<Self>, PythPusherBootError> {
        if cfg.funding_market_ids.is_empty() {
            // Same markets the funding poker watches — no markets means
            // nothing to push for.
            return Ok(None);
        }
        let pyth_address = resolve_pyth_address(cfg.chain_id)?;
        let usdc_raw = std::env::var("USDC_ADDRESS")
            .unwrap_or_else(|_| bufi_perps_onchain::oracle::DEFAULT_ARC_USDC.to_string());
        let usdc_address = usdc_raw
            .parse::<Address>()
            .map_err(|e| PythPusherBootError::InvalidUsdcAddress(e.to_string()))?;
        let _ = reqwest::Url::parse(&cfg.pyth_hermes_url)
            .map_err(|e| PythPusherBootError::InvalidHermesUrl(e.to_string()))?;

        let hermes_client = reqwest::Client::builder()
            .timeout(cfg.pyth_hermes_timeout)
            .build()
            .expect("reqwest client builder");

        let ws_url = if cfg.pyth_use_ws {
            derive_ws_url(&cfg.pyth_hermes_url, cfg.pyth_hermes_ws_url.as_deref())
        } else {
            String::new()
        };

        Ok(Some(Self {
            onchain,
            hermes_url: cfg.pyth_hermes_url.clone(),
            hermes_timeout: cfg.pyth_hermes_timeout,
            poll_interval: cfg.pyth_push_interval,
            max_age_secs: cfg.pyth_push_max_age.as_secs(),
            pyth_address,
            market_ids: cfg.funding_market_ids.clone(),
            usdc_address,
            feed_ids: BTreeSet::new(),
            last_push_secs: BTreeMap::new(),
            hermes_client,
            use_ws: cfg.pyth_use_ws,
            ws_url,
            price_tx,
        }))
    }

    /// One-shot at boot: walk `market_ids`, resolve `(baseToken, USDC) →
    /// (baseFeed, quoteFeed)`, populate `feed_ids`. Misses are logged but
    /// don't abort — a market with an unconfigured feed is just skipped.
    pub async fn seed_from_chain(&mut self) {
        // Resolve quote-side feed (USDC) once.
        match self.onchain.pyth_feed_of(self.usdc_address).await {
            Ok(feed) if feed != B256::ZERO => {
                self.feed_ids.insert(feed);
                debug!(token = ?self.usdc_address, feed = ?feed, "pyth_pusher: USDC feed resolved");
            }
            Ok(_) => warn!(
                token = ?self.usdc_address,
                "pyth_pusher: USDC pythFeedOf returned ZERO — skipping"
            ),
            Err(e) => warn!(
                token = ?self.usdc_address,
                error = ?e,
                "pyth_pusher: USDC pythFeedOf failed at boot"
            ),
        }

        // Resolve each market's base-token feed.
        for id in &self.market_ids {
            let market_b256 = B256::from(*id);
            let market_hex = market_id_hex(id);
            let base = match self.read_base_token(market_b256).await {
                Ok(addr) => addr,
                Err(e) => {
                    warn!(market = market_hex, error = ?e, "pyth_pusher: marketConfig failed; skipping");
                    continue;
                }
            };
            match self.onchain.pyth_feed_of(base).await {
                Ok(feed) if feed != B256::ZERO => {
                    self.feed_ids.insert(feed);
                    debug!(
                        market = market_hex,
                        token = ?base,
                        feed = ?feed,
                        "pyth_pusher: base feed resolved"
                    );
                }
                Ok(_) => warn!(
                    market = market_hex,
                    token = ?base,
                    "pyth_pusher: base pythFeedOf returned ZERO — skipping"
                ),
                Err(e) => warn!(
                    market = market_hex,
                    token = ?base,
                    error = ?e,
                    "pyth_pusher: base pythFeedOf failed"
                ),
            }
        }
    }

    /// Run forever until the parent task cancels us.
    ///
    /// Phase 8.5c: when `MATCHER_PYTH_USE_WS=true` (default) we run
    /// the WebSocket subscription path. If WS exhausts its reconnect
    /// budget the WS runner returns an error and we fall back to the
    /// HTTP poll loop — the matcher MUST NEVER go blind on mark-price
    /// freshness because Hermes WS hiccupped.
    pub async fn run(mut self) {
        self.seed_from_chain().await;
        info!(
            pyth = ?self.pyth_address,
            feeds = self.feed_ids.len(),
            poll_ms = self.poll_interval.as_millis() as u64,
            max_age_secs = self.max_age_secs,
            hermes_url = self.hermes_url,
            use_ws = self.use_ws,
            ws_url = self.ws_url,
            "pyth_pusher started"
        );
        if self.feed_ids.is_empty() {
            warn!("pyth_pusher: no feeds resolved; idling — LP-backstop oracle reads will continue to fail");
            // No feeds = nothing to do. Park forever; the outer
            // tokio::select! in main.rs will detect shutdown.
            loop {
                sleep(Duration::from_secs(3600)).await;
            }
        }

        if self.use_ws {
            info!("pyth_pusher: starting in WebSocket mode (Phase 8.5c)");
            let runner = PythPusherWs::new(
                self.onchain.clone(),
                self.ws_url.clone(),
                self.pyth_address,
                self.feed_ids.clone(),
                self.max_age_secs,
                self.price_tx.clone(),
            );
            if let Err(e) = runner.run().await {
                warn!(
                    error = ?e,
                    "pyth_pusher: WS path failed permanently; falling back to HTTP poll"
                );
            } else {
                // Normal in tests only. Production WS path runs forever.
                info!("pyth_pusher: WS path exited cleanly; falling back to HTTP poll");
            }
        }

        info!("pyth_pusher: running HTTP poll loop");
        self.run_http_loop().await;
    }

    /// The original HTTP poll loop, factored out so the WS path can
    /// fall back to it without code duplication. Runs forever.
    async fn run_http_loop(&mut self) {
        loop {
            if let Err(e) = self.tick().await {
                warn!(error = ?e, "pyth_pusher tick failed; backing off");
            }
            sleep(self.poll_interval).await;
        }
    }

    async fn tick(&mut self) -> Result<TickReport, PythPusherTickError> {
        if self.feed_ids.is_empty() {
            return Ok(TickReport::default());
        }
        let now = current_unix_secs();

        // Which feeds need a push? Read on-chain publishTime per feed.
        // (Each call is cheap — view function, cached at the RPC layer.)
        let mut stale: Vec<B256> = Vec::new();
        for feed in self.feed_ids.clone() {
            match self.feed_publish_time(feed).await {
                Ok(publish_time) => {
                    if publish_time.saturating_add(self.max_age_secs) <= now {
                        stale.push(feed);
                    }
                }
                Err(e) => {
                    // Treat publishTime-read failures as "stale" — if we
                    // can't tell, assume it needs a push. Worst case: a
                    // tiny extra fee.
                    debug!(feed = ?feed, error = ?e, "pyth_pusher: getPriceUnsafe failed; treating as stale");
                    stale.push(feed);
                }
            }
        }
        if stale.is_empty() {
            debug!(feeds = self.feed_ids.len(), "pyth_pusher tick: all feeds fresh");
            return Ok(TickReport {
                pushed: 0,
                skipped: self.feed_ids.len(),
                failed: 0,
            });
        }

        // Fetch fresh VAAs for the stale set from Hermes.
        let update_data = match self.fetch_hermes_updates(&stale).await {
            Ok(data) => data,
            Err(e) => {
                warn!(error = ?e, stale = stale.len(), "pyth_pusher: hermes fetch failed");
                return Err(e);
            }
        };
        if update_data.is_empty() {
            return Ok(TickReport {
                pushed: 0,
                skipped: self.feed_ids.len(),
                failed: 0,
            });
        }

        // Push them in one tx.
        match self
            .onchain
            .submit_pyth_update(self.pyth_address, update_data)
            .await
        {
            Ok(tx) => {
                let pushed = stale.len();
                for feed in &stale {
                    self.last_push_secs.insert(*feed, now);
                }
                info!(
                    tx = ?tx,
                    pushed,
                    skipped = self.feed_ids.len() - pushed,
                    "pyth_pusher tick: feeds refreshed"
                );
                Ok(TickReport {
                    pushed,
                    skipped: self.feed_ids.len() - pushed,
                    failed: 0,
                })
            }
            Err(e) => {
                warn!(error = ?e, stale = stale.len(), "pyth_pusher: updatePriceFeeds failed");
                Err(PythPusherTickError::Onchain(e.to_string()))
            }
        }
    }

    async fn read_base_token(&self, market_id: B256) -> Result<Address, PerpsOnchainError> {
        // Reuses the provider construction pattern from oracle.rs. We could
        // factor this into a shared helper, but for the boot path this is fine.
        let signer: PrivateKeySigner = self
            .onchain
            .signer_key_hex()
            .parse()
            .map_err(|e: alloy_signer_local::LocalSignerError| {
                PerpsOnchainError::InvalidSignerKey(e.to_string())
            })?;
        let wallet = EthereumWallet::from(signer);
        let url: reqwest::Url = self
            .onchain
            .rpc_url()
            .parse()
            .map_err(|e: url::ParseError| PerpsOnchainError::InvalidRpcUrl(e.to_string()))?;
        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(url);
        let clearinghouse = FxPerpClearinghouse::new(self.onchain.clearinghouse(), &provider);
        let cfg = clearinghouse
            .marketConfig(market_id)
            .call()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("marketConfig: {e}")))?;
        Ok(cfg._0.baseToken)
    }

    async fn feed_publish_time(&self, feed: B256) -> Result<u64, PerpsOnchainError> {
        let signer: PrivateKeySigner = self
            .onchain
            .signer_key_hex()
            .parse()
            .map_err(|e: alloy_signer_local::LocalSignerError| {
                PerpsOnchainError::InvalidSignerKey(e.to_string())
            })?;
        let wallet = EthereumWallet::from(signer);
        let url: reqwest::Url = self
            .onchain
            .rpc_url()
            .parse()
            .map_err(|e: url::ParseError| PerpsOnchainError::InvalidRpcUrl(e.to_string()))?;
        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(url);
        let pyth = IPyth::new(self.pyth_address, &provider);
        let r = pyth
            .getPriceUnsafe(feed)
            .call()
            .await
            .map_err(|e| PerpsOnchainError::Rpc(format!("getPriceUnsafe: {e}")))?;
        Ok(r.publishTime.try_into().unwrap_or(0))
    }

    /// GET `<hermes_url>/v2/updates/price/latest?ids[]=…&encoding=hex`.
    /// Response shape: `{ binary: { data: ["<hex>", ...] } }`. Each hex
    /// string is one VAA — passed verbatim to `updatePriceFeeds(bytes[])`.
    async fn fetch_hermes_updates(
        &self,
        feeds: &[B256],
    ) -> Result<Vec<Bytes>, PythPusherTickError> {
        if feeds.is_empty() {
            return Ok(Vec::new());
        }
        let mut url = format!("{}/v2/updates/price/latest?encoding=hex", self.hermes_url);
        for feed in feeds {
            // Hermes wants the feed id WITHOUT the 0x prefix.
            let hex_id = format!("{:x}", feed);
            url.push_str("&ids[]=");
            url.push_str(&hex_id);
        }
        debug!(url, feeds = feeds.len(), "pyth_pusher: fetching from hermes");
        let response = self
            .hermes_client
            .get(&url)
            .timeout(self.hermes_timeout)
            .send()
            .await
            .map_err(|e| PythPusherTickError::Hermes(format!("send: {e}")))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(PythPusherTickError::Hermes(format!(
                "status {}: {}",
                status, body
            )));
        }
        let body: HermesV2Response = response
            .json()
            .await
            .map_err(|e| PythPusherTickError::Hermes(format!("parse: {e}")))?;
        let data = body.binary.data;
        if data.is_empty() {
            return Err(PythPusherTickError::Hermes("empty data array".into()));
        }
        let mut out = Vec::with_capacity(data.len());
        for hex_vaa in data {
            let stripped = hex_vaa.strip_prefix("0x").unwrap_or(&hex_vaa);
            let bytes = hex_decode(stripped)
                .map_err(|e| PythPusherTickError::Hermes(format!("hex decode: {e}")))?;
            out.push(Bytes::from(bytes));
        }
        Ok(out)
    }
}

/// Per-tick report — logged at INFO on push, DEBUG otherwise.
#[derive(Debug, Default)]
#[allow(dead_code)]
pub struct TickReport {
    pub pushed: usize,
    pub skipped: usize,
    pub failed: usize,
}

#[derive(Debug, Error)]
enum PythPusherTickError {
    #[error("hermes: {0}")]
    Hermes(String),
    #[error("on-chain: {0}")]
    Onchain(String),
}

/// Hermes v2 response wire format. We only need `binary.data`; the rest
/// (`parsed`, metadata) is ignored. Matches the `perp-arc-trading-smoke.ts`
/// parser exactly.
#[derive(Debug, Deserialize)]
struct HermesV2Response {
    binary: HermesBinary,
}

#[derive(Debug, Deserialize)]
struct HermesBinary {
    data: Vec<String>,
}

fn current_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 {
        return Err(format!("odd length {}", s.len()));
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    for i in (0..s.len()).step_by(2) {
        let chunk = &s[i..i + 2];
        let b = u8::from_str_radix(chunk, 16).map_err(|e| format!("{chunk}: {e}"))?;
        out.push(b);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_decode_round_trips() {
        let raw = vec![0x01, 0xab, 0xcd, 0xef, 0xff];
        let hex: String = raw.iter().map(|b| format!("{b:02x}")).collect();
        let decoded = hex_decode(&hex).expect("decode");
        assert_eq!(decoded, raw);
    }

    #[test]
    fn hex_decode_rejects_odd_length() {
        let err = hex_decode("0a1").unwrap_err();
        assert!(err.contains("odd"));
    }

    #[test]
    fn hex_decode_rejects_non_hex() {
        let err = hex_decode("zz").unwrap_err();
        assert!(err.contains("zz"));
    }

    #[test]
    fn hermes_response_parses_canonical_shape() {
        let body = r#"{
          "binary": { "data": ["00aabbcc", "deadbeef"] },
          "parsed": []
        }"#;
        let parsed: HermesV2Response = serde_json::from_str(body).unwrap();
        assert_eq!(parsed.binary.data.len(), 2);
        assert_eq!(parsed.binary.data[0], "00aabbcc");
    }

    #[test]
    fn hermes_response_rejects_missing_binary() {
        let body = r#"{ "parsed": [] }"#;
        let parsed: Result<HermesV2Response, _> = serde_json::from_str(body);
        assert!(parsed.is_err());
    }
}
