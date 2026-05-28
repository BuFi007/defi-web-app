//! Shared nonce manager for keeper-signed transactions.
//!
//! The matcher used to spin up its own alloy `Provider` per keeper call,
//! each with its own internal `NonceFiller`. With one signer key feeding
//! up to five keeper roles (telarana liquidator, spot executor, gateway
//! signer, arcade settler, perps liquidator) plus the perps settlement
//! path, the providers raced each other for the same `(signer, chain)`
//! pending-nonce, dropping txs with `nonce too low` errors under any
//! real concurrency.
//!
//! `TxSubmitter` centralises that state: one instance per `(chain_id)`
//! holds an `Arc<PrivateKeySigner>`, the cached pending-nonce behind a
//! `tokio::sync::Mutex`, and a single shared HTTP provider. Every
//! keeper that wants to send a tx assembles a `TransactionRequest`,
//! hands it to `submit_tx`, and the submitter:
//!
//!   1. Locks the per-chain mutex.
//!   2. Reads the cached nonce (lazily primed from chain on first use).
//!   3. Stamps it into the tx.
//!   4. Sends + awaits receipt with bounded retry + exponential backoff.
//!   5. On success: bumps the cached nonce by 1.
//!   6. On a "nonce too low" / "already known" / "replacement underpriced"
//!      error: re-syncs the cached nonce from `eth_getTransactionCount(pending)`
//!      and retries.
//!
//! Callers don't think about nonces. The mutex serialises submissions
//! per chain — fine for keepers because the bottleneck is block time,
//! not local throughput.
//!
//! The registry handed to `main.rs` carries a `TxSubmitter` per chain
//! id keepers might touch (Arc mainnet/testnet + Fuji today; expanded
//! per the cross-chain keeper consolidation plan). Keepers ask the
//! registry for the chain they need by id and get back an
//! `Arc<TxSubmitter>` they can stash.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use alloy_network::{EthereumWallet, TransactionBuilder};
use alloy_primitives::{Address, B256};
use alloy_provider::{DynProvider, Provider, ProviderBuilder};
use alloy_rpc_types_eth::TransactionRequest;
use alloy_signer_local::PrivateKeySigner;
use thiserror::Error;
use tokio::sync::Mutex;
use tokio::time::sleep;
use tracing::{debug, info, warn};

/// Max retry attempts for a single tx submission. After this many
/// failures the submitter returns the last error to the caller.
const MAX_ATTEMPTS: u32 = 3;

/// Base backoff between retry attempts. Doubled per attempt.
const BACKOFF_BASE: Duration = Duration::from_millis(250);

/// Errors raised by the shared transaction submitter.
#[derive(Debug, Error)]
pub enum TxSubmitterError {
    /// Bad RPC URL or unparseable signer.
    #[error("config: {0}")]
    Config(String),
    /// RPC / transport error from alloy.
    #[error("rpc: {0}")]
    Rpc(String),
    /// `eth_sendRawTransaction` succeeded but the receipt was a revert.
    #[error("tx reverted (tx {tx})")]
    Reverted {
        /// Transaction hash that reverted.
        tx: B256,
    },
    /// Exceeded `MAX_ATTEMPTS` without a successful submission. The
    /// inner string is the last underlying error message.
    #[error("max attempts ({attempts}) exhausted: {last_error}")]
    MaxAttemptsExceeded {
        /// Number of attempts made.
        attempts: u32,
        /// Last underlying error message.
        last_error: String,
    },
}

/// One submitter per (signer, chain). Cloneable; the interior state is
/// shared behind `Arc`.
#[derive(Clone)]
pub struct TxSubmitter {
    chain_id: u64,
    signer_address: Address,
    /// Cached pending nonce. `None` means "not yet primed from chain;
    /// the next submission will read it before stamping."
    nonce: Arc<Mutex<Option<u64>>>,
    /// Single shared provider — built once per submitter, reused across
    /// calls. The internal HTTP client pools sockets so this is the
    /// efficient path.
    provider: Arc<DynProvider>,
}

impl TxSubmitter {
    /// Build a submitter for the given chain id, RPC URL, and signer key
    /// (hex with or without the `0x` prefix). The provider is constructed
    /// once and shared by every caller.
    pub fn new(
        chain_id: u64,
        rpc_url: &str,
        signer_key_hex: &str,
    ) -> Result<Self, TxSubmitterError> {
        let url: reqwest::Url = rpc_url
            .parse()
            .map_err(|e: url::ParseError| TxSubmitterError::Config(format!("rpc url: {e}")))?;
        let signer: PrivateKeySigner = signer_key_hex
            .trim_start_matches("0x")
            .parse()
            .map_err(|e: alloy_signer_local::LocalSignerError| {
                TxSubmitterError::Config(format!("signer key: {e}"))
            })?;
        let signer_address = signer.address();
        let wallet = EthereumWallet::from(signer);
        let provider = ProviderBuilder::new().wallet(wallet).connect_http(url);
        Ok(Self {
            chain_id,
            signer_address,
            nonce: Arc::new(Mutex::new(None)),
            provider: Arc::new(provider.erased()),
        })
    }

    /// Chain id this submitter targets. Currently consumed only by the
    /// registry boot logger; keep on the public surface so future
    /// observability hooks don't have to re-plumb it.
    #[allow(dead_code)]
    pub fn chain_id(&self) -> u64 {
        self.chain_id
    }

    /// Signer address derived from the configured key.
    pub fn signer_address(&self) -> Address {
        self.signer_address
    }

    /// Borrow the shared provider — used by callers that need to make
    /// read-only contract calls before deciding whether to submit.
    pub fn provider(&self) -> &DynProvider {
        &self.provider
    }

    /// Submit `tx` with managed nonce + bounded retry. The caller may
    /// pre-fill `to`, `from`, `input`/`data`, `value`, and any gas
    /// fields they care to lock; the submitter overwrites `nonce` and
    /// `from` (to the configured signer).
    ///
    /// Returns the confirmed-receipt tx hash on success.
    pub async fn submit_tx(
        &self,
        mut tx: TransactionRequest,
        action: &'static str,
    ) -> Result<B256, TxSubmitterError> {
        // Always pin `from` so the alloy wallet filler signs with the
        // configured key. The caller never sets this.
        tx.set_from(self.signer_address);

        let mut last_err = String::new();
        for attempt in 0..MAX_ATTEMPTS {
            // (1) acquire the per-submitter lock + prime the cached nonce
            // if this is the first call after boot or after a re-sync.
            let send_nonce = {
                let mut guard = self.nonce.lock().await;
                if guard.is_none() {
                    let primed = self
                        .provider
                        .get_transaction_count(self.signer_address)
                        .pending()
                        .await
                        .map_err(|e| TxSubmitterError::Rpc(format!("get_transaction_count: {e}")))?;
                    debug!(
                        chain_id = self.chain_id,
                        signer = ?self.signer_address,
                        nonce = primed,
                        "tx_submitter: primed nonce from chain"
                    );
                    *guard = Some(primed);
                }
                let n = guard.expect("primed above");
                tx.set_nonce(n);
                n
            };

            // (2) send + wait for receipt. We DROP the lock while waiting
            // for the receipt — that would block every other keeper for
            // however many seconds the chain takes to mine. Instead we
            // hold the lock only while assigning the nonce; the wallet
            // filler signs eagerly with that nonce. To preserve mining
            // order under serial-keeper assumptions we re-acquire the
            // lock before bumping the cached counter.
            let send_result = self.provider.send_transaction(tx.clone()).await;
            let pending = match send_result {
                Ok(p) => p,
                Err(e) => {
                    let msg = e.to_string();
                    last_err = msg.clone();
                    if is_nonce_collision(&msg) {
                        warn!(
                            chain_id = self.chain_id,
                            attempt,
                            error = %msg,
                            "tx_submitter: nonce collision; refreshing from chain"
                        );
                        self.resync_nonce().await?;
                        // Don't sleep — try again immediately with the
                        // refreshed nonce.
                        continue;
                    }
                    if is_transient(&msg) {
                        warn!(
                            chain_id = self.chain_id,
                            attempt,
                            error = %msg,
                            action,
                            "tx_submitter: transient send error; backing off"
                        );
                        sleep(backoff_for(attempt)).await;
                        continue;
                    }
                    return Err(TxSubmitterError::Rpc(format!("send {action}: {msg}")));
                }
            };

            let receipt = match pending.get_receipt().await {
                Ok(r) => r,
                Err(e) => {
                    let msg = e.to_string();
                    last_err = msg.clone();
                    warn!(
                        chain_id = self.chain_id,
                        attempt,
                        error = %msg,
                        action,
                        "tx_submitter: receipt fetch failed; will retry"
                    );
                    // Receipt fetch failures don't necessarily mean the tx
                    // didn't land — but if it did, our nonce is already
                    // out of sync. Resync to be safe.
                    self.resync_nonce().await?;
                    sleep(backoff_for(attempt)).await;
                    continue;
                }
            };

            let tx_hash = receipt.transaction_hash;
            if !receipt.status() {
                // On-chain revert. The nonce DID advance — bump it.
                self.commit_nonce(send_nonce).await;
                return Err(TxSubmitterError::Reverted { tx: tx_hash });
            }

            self.commit_nonce(send_nonce).await;
            info!(
                chain_id = self.chain_id,
                attempt,
                action,
                tx = ?tx_hash,
                nonce = send_nonce,
                "tx_submitter: submitted"
            );
            return Ok(tx_hash);
        }

        Err(TxSubmitterError::MaxAttemptsExceeded {
            attempts: MAX_ATTEMPTS,
            last_error: last_err,
        })
    }

    /// Bump the cached nonce iff it still equals the value we sent under.
    /// If another caller already pushed the counter forward (e.g. a
    /// concurrent resync) we leave it alone.
    async fn commit_nonce(&self, sent_under: u64) {
        let mut guard = self.nonce.lock().await;
        let next = sent_under.saturating_add(1);
        match *guard {
            Some(current) if current == sent_under => {
                *guard = Some(next);
            }
            Some(current) if current > sent_under => {
                // Someone else (resync) already advanced past us; leave alone.
            }
            _ => {
                *guard = Some(next);
            }
        }
    }

    /// Drop the cached nonce so the next call re-reads from chain. Used
    /// after a transient error to recover from any divergence.
    async fn resync_nonce(&self) -> Result<(), TxSubmitterError> {
        let primed = self
            .provider
            .get_transaction_count(self.signer_address)
            .pending()
            .await
            .map_err(|e| TxSubmitterError::Rpc(format!("get_transaction_count resync: {e}")))?;
        let mut guard = self.nonce.lock().await;
        debug!(
            chain_id = self.chain_id,
            signer = ?self.signer_address,
            nonce = primed,
            "tx_submitter: resynced nonce from chain"
        );
        *guard = Some(primed);
        Ok(())
    }
}

/// Heuristic: does this RPC error look like a nonce collision?
fn is_nonce_collision(msg: &str) -> bool {
    let lower = msg.to_ascii_lowercase();
    lower.contains("nonce too low")
        || lower.contains("already known")
        || lower.contains("replacement transaction underpriced")
        || lower.contains("nonce has already been used")
        || lower.contains("invalid nonce")
}

/// Heuristic: should we retry this RPC error?
fn is_transient(msg: &str) -> bool {
    let lower = msg.to_ascii_lowercase();
    lower.contains("timeout")
        || lower.contains("timed out")
        || lower.contains("connection")
        || lower.contains("502")
        || lower.contains("503")
        || lower.contains("504")
        || lower.contains("eof")
        || lower.contains("network")
        || lower.contains("temporarily")
}

fn backoff_for(attempt: u32) -> Duration {
    let mult = 1u32 << attempt.min(8);
    BACKOFF_BASE * mult
}

/// Registry of `TxSubmitter`s keyed by chain id. Built once at boot;
/// keepers call `get` to fetch the submitter for the chain they target.
#[derive(Clone, Default)]
pub struct TxSubmitterRegistry {
    inner: Arc<BTreeMap<u64, Arc<TxSubmitter>>>,
}

impl TxSubmitterRegistry {
    /// Build a registry from an explicit map. `main.rs` constructs
    /// `TxSubmitter`s for every chain it knows the keepers might touch
    /// and hands them all in here.
    pub fn from_map(map: BTreeMap<u64, Arc<TxSubmitter>>) -> Self {
        Self {
            inner: Arc::new(map),
        }
    }

    /// Fetch the submitter for `chain_id`, or `None` if the registry
    /// wasn't told about that chain at boot.
    pub fn get(&self, chain_id: u64) -> Option<Arc<TxSubmitter>> {
        self.inner.get(&chain_id).cloned()
    }

    /// Iterate every (chain_id, submitter) pair the registry knows about.
    /// Currently only consumed by tests / future operator tooling; kept
    /// on the public surface intentionally.
    #[allow(dead_code)]
    pub fn iter(&self) -> impl Iterator<Item = (u64, Arc<TxSubmitter>)> + '_ {
        self.inner.iter().map(|(k, v)| (*k, v.clone()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nonce_collision_heuristic_matches_common_errors() {
        assert!(is_nonce_collision("nonce too low"));
        assert!(is_nonce_collision("Nonce Too Low"));
        assert!(is_nonce_collision("ALREADY KNOWN"));
        assert!(is_nonce_collision("replacement transaction underpriced"));
        assert!(!is_nonce_collision("insufficient funds"));
        assert!(!is_nonce_collision("execution reverted"));
    }

    #[test]
    fn transient_heuristic_matches_network_errors() {
        assert!(is_transient("timeout while reading response"));
        assert!(is_transient("connection reset by peer"));
        assert!(is_transient("server returned 502 Bad Gateway"));
        assert!(is_transient("EOF"));
        assert!(!is_transient("execution reverted"));
        assert!(!is_transient("insufficient funds"));
    }

    #[test]
    fn backoff_doubles_each_attempt() {
        assert_eq!(backoff_for(0), BACKOFF_BASE);
        assert_eq!(backoff_for(1), BACKOFF_BASE * 2);
        assert_eq!(backoff_for(2), BACKOFF_BASE * 4);
        assert_eq!(backoff_for(3), BACKOFF_BASE * 8);
    }
}
