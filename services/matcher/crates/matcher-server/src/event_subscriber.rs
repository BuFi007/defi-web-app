//! HTTP-polling event subscriber for the perp stack.
//!
//! WebSocket subscriptions are intentionally NOT used in v1 — `eth_getLogs`
//! polling at a confirmation buffer is strictly simpler and gives reorg
//! safety for free (we never read logs from a block that isn't N deep).
//!
//! Per-tick:
//!   1. `eth_blockNumber()` → `head`.
//!   2. `confirmed = head - config.event_confirmations`.
//!   3. `from = cursor` (the last block we processed, exclusive on retry).
//!   4. `to = confirmed`. If `to < from`, no-op.
//!   5. `eth_getLogs({addresses: [order_settlement, clearinghouse,
//!      liquidation, funding], topics: [topic0_union]})`.
//!   6. Decode each log via the alloy bindings; emit as tracing events.
//!   7. Persist cursor = `to` to disk atomically (write tmp + rename).
//!
//! The cursor file at `MATCHER_EVENT_CURSOR_PATH` (default
//! `.bufi/matcher-event-cursor.json`) carries `{chain_id, last_processed_block}`.
//! Boot-time mismatch on `chain_id` resets the cursor to `confirmed` (we'd
//! rather lose history than process events from a different chain).

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use alloy_primitives::Address;
use alloy_provider::{Provider, ProviderBuilder};
use alloy_rpc_types_eth::{BlockNumberOrTag, Filter};
use alloy_sol_types::SolEvent;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::time::sleep;
use tracing::{debug, error, info, warn};

use bufi_perps_onchain::bindings::{
    AccountFlagRescinded, AccountFlagged, FundingPoked, FundingSettled, MatchSettled,
    OrderCancelled, PositionDecreased, PositionIncreased,
};
use bufi_perps_onchain::PerpsDeployment;

use crate::config::Config;

/// Errors raised by the event-subscriber loop. Most are wrapped + retried.
#[derive(Debug, Error)]
pub enum SubscriberError {
    /// alloy / network failure.
    #[error("rpc: {0}")]
    Rpc(String),
    /// Cursor file I/O failure.
    #[error("cursor io: {0}")]
    Io(#[from] std::io::Error),
    /// Cursor file JSON parse failure.
    #[error("cursor parse: {0}")]
    Parse(#[from] serde_json::Error),
    /// Invalid RPC URL.
    #[error("invalid RPC URL: {0}")]
    InvalidUrl(String),
}

/// Persisted state — survives restarts so we don't re-process old logs.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Cursor {
    chain_id: u64,
    last_processed_block: u64,
}

/// Subscriber state — built once at boot, lives in its own tokio task.
pub struct EventSubscriber {
    rpc_url: String,
    chain_id: u64,
    addresses: Vec<Address>,
    cursor_path: PathBuf,
    poll_interval: Duration,
    confirmations: u64,
}

impl EventSubscriber {
    /// Build the subscriber config from the matcher's `Config` + the loaded
    /// deployment. The `rpc_url` is captured so each `tick` rebuilds a
    /// fresh provider (HTTP pooling is internal — cheap).
    pub fn new(config: &Config, deployment: &PerpsDeployment) -> Self {
        let addresses = vec![
            deployment.contracts.fx_order_settlement,
            deployment.contracts.fx_perp_clearinghouse,
            deployment.contracts.fx_liquidation_engine,
            deployment.contracts.fx_funding_engine,
        ];
        Self {
            rpc_url: config.rpc_url.clone(),
            chain_id: config.chain_id,
            addresses,
            cursor_path: config.event_cursor_path.clone(),
            poll_interval: config.event_poll,
            confirmations: config.event_confirmations,
        }
    }

    /// Run forever. Returns only if `cancellation` is triggered (caller side).
    pub async fn run(self: Arc<Self>) {
        loop {
            if let Err(e) = self.tick().await {
                warn!(error = ?e, "event subscriber tick failed; backing off");
            }
            sleep(self.poll_interval).await;
        }
    }

    async fn tick(&self) -> Result<(), SubscriberError> {
        let url = self
            .rpc_url
            .parse::<reqwest::Url>()
            .map_err(|e| SubscriberError::InvalidUrl(e.to_string()))?;
        let provider = ProviderBuilder::new().on_http(url);
        let head: u64 = provider
            .get_block_number()
            .await
            .map_err(|e| SubscriberError::Rpc(format!("get_block_number: {e}")))?;
        let confirmed = head.saturating_sub(self.confirmations);
        let mut cursor = self.load_cursor(confirmed)?;
        if cursor.chain_id != self.chain_id {
            warn!(
                cursor_chain = cursor.chain_id,
                expected_chain = self.chain_id,
                "cursor file chain id mismatch; resetting to confirmed head"
            );
            cursor.chain_id = self.chain_id;
            cursor.last_processed_block = confirmed;
            self.save_cursor(&cursor)?;
            return Ok(());
        }
        if confirmed <= cursor.last_processed_block {
            debug!(confirmed, cursor = cursor.last_processed_block, "no new confirmed blocks");
            return Ok(());
        }
        let from_block = cursor.last_processed_block + 1;
        let to_block = confirmed;
        let topics = [
            MatchSettled::SIGNATURE_HASH,
            OrderCancelled::SIGNATURE_HASH,
            PositionIncreased::SIGNATURE_HASH,
            PositionDecreased::SIGNATURE_HASH,
            AccountFlagged::SIGNATURE_HASH,
            AccountFlagRescinded::SIGNATURE_HASH,
            FundingPoked::SIGNATURE_HASH,
            FundingSettled::SIGNATURE_HASH,
        ];
        let filter = Filter::new()
            .from_block(BlockNumberOrTag::Number(from_block))
            .to_block(BlockNumberOrTag::Number(to_block))
            .address(self.addresses.clone())
            .event_signature(topics.to_vec());
        let logs = provider
            .get_logs(&filter)
            .await
            .map_err(|e| SubscriberError::Rpc(format!("get_logs: {e}")))?;

        info!(
            from = from_block,
            to = to_block,
            log_count = logs.len(),
            "polled perp events"
        );
        for log in logs {
            decode_and_emit(&log);
        }
        cursor.last_processed_block = to_block;
        self.save_cursor(&cursor)?;
        Ok(())
    }

    fn load_cursor(&self, default_block: u64) -> Result<Cursor, SubscriberError> {
        if !self.cursor_path.exists() {
            return Ok(Cursor {
                chain_id: self.chain_id,
                last_processed_block: default_block,
            });
        }
        let raw = fs::read_to_string(&self.cursor_path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    fn save_cursor(&self, cursor: &Cursor) -> Result<(), SubscriberError> {
        if let Some(parent) = self.cursor_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = self.cursor_path.with_extension("json.tmp");
        let body = serde_json::to_vec_pretty(cursor)?;
        {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(&body)?;
            f.sync_all()?;
        }
        fs::rename(&tmp, &self.cursor_path)?;
        Ok(())
    }
}

/// Decode the log against every event type we care about; emit the first
/// match as a structured tracing event. Unknown logs (shouldn't happen
/// given the topic filter) are logged at debug.
fn decode_and_emit(log: &alloy_rpc_types_eth::Log) {
    // Per-event try-decode. The topic filter narrows this, so at most one
    // arm matches; ordering inside is cosmetic.
    if let Ok(ev) = MatchSettled::decode_log(&log.inner, true) {
        info!(
            kind = "MatchSettled",
            market = ?ev.marketId,
            maker = ?ev.maker,
            taker = ?ev.taker,
            fill_size = ?ev.fillSizeE18,
            fill_price = ?ev.fillPriceE18,
            tx = ?log.transaction_hash,
            block = ?log.block_number,
            "perp event"
        );
        return;
    }
    if let Ok(ev) = PositionIncreased::decode_log(&log.inner, true) {
        info!(
            kind = "PositionIncreased",
            market = ?ev.marketId,
            trader = ?ev.trader,
            size_delta = ?ev.sizeDeltaE18,
            resulting_size = ?ev.resultingSizeE18,
            entry_price = ?ev.entryPriceE18,
            margin_reserved = ?ev.marginReserved,
            fee = ?ev.fee,
            tx = ?log.transaction_hash,
            block = ?log.block_number,
            "perp event"
        );
        return;
    }
    if let Ok(ev) = PositionDecreased::decode_log(&log.inner, true) {
        info!(
            kind = "PositionDecreased",
            market = ?ev.marketId,
            trader = ?ev.trader,
            size_delta = ?ev.sizeDeltaE18,
            resulting_size = ?ev.resultingSizeE18,
            price = ?ev.priceE18,
            margin_released = ?ev.marginReleased,
            pnl = ?ev.pnl,
            bad_debt = ?ev.badDebt,
            tx = ?log.transaction_hash,
            block = ?log.block_number,
            "perp event"
        );
        return;
    }
    if let Ok(ev) = OrderCancelled::decode_log(&log.inner, true) {
        info!(
            kind = "OrderCancelled",
            trader = ?ev.trader,
            nonce = ev.nonce,
            tx = ?log.transaction_hash,
            block = ?log.block_number,
            "perp event"
        );
        return;
    }
    if let Ok(ev) = AccountFlagged::decode_log(&log.inner, true) {
        info!(
            kind = "AccountFlagged",
            market = ?ev.marketId,
            trader = ?ev.trader,
            flagger = ?ev.flagger,
            tx = ?log.transaction_hash,
            block = ?log.block_number,
            "perp event"
        );
        return;
    }
    if let Ok(ev) = AccountFlagRescinded::decode_log(&log.inner, true) {
        info!(
            kind = "AccountFlagRescinded",
            market = ?ev.marketId,
            trader = ?ev.trader,
            caller = ?ev.caller,
            auto = ev.auto_,
            tx = ?log.transaction_hash,
            block = ?log.block_number,
            "perp event"
        );
        return;
    }
    if let Ok(ev) = FundingPoked::decode_log(&log.inner, true) {
        info!(
            kind = "FundingPoked",
            market = ?ev.marketId,
            version = ev.version,
            rate = ?ev.rateE18PerSecond,
            cumulative = ?ev.cumulativeFundingE18,
            tx = ?log.transaction_hash,
            block = ?log.block_number,
            "perp event"
        );
        return;
    }
    if let Ok(ev) = FundingSettled::decode_log(&log.inner, true) {
        info!(
            kind = "FundingSettled",
            market = ?ev.marketId,
            trader = ?ev.trader,
            funding_paid = ?ev.fundingPaid,
            tx = ?log.transaction_hash,
            block = ?log.block_number,
            "perp event"
        );
        return;
    }
    error!(
        topic0 = ?log.topic0(),
        tx = ?log.transaction_hash,
        "perp log matched topic filter but no event decoder accepted it — bindings drift?"
    );
}
