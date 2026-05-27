//! Rust replacement for `apps/keeper-arcade-settler`.
//!
//! The loop watches Envio-indexed Bento rooms, finds locked rooms whose
//! `endsAt` has passed, builds the `PayoutRoot`, and submits
//! `FxBentoSettlementManager.submitResults(...)`.

use std::str::FromStr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use alloy_network::EthereumWallet;
use alloy_primitives::{keccak256, Address, Bytes, B256, U256};
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
const FUJI_CHAIN_ID: u64 = 43_113;
const DEFAULT_ARC_RPC_URL: &str = "https://rpc.testnet.arc.network";
const DEFAULT_FUJI_RPC_URL: &str = "https://api.avax-test.network/ext/bc/C/rpc";
const DEFAULT_ARC_SETTLEMENT_MANAGER: &str = "0x8f635571aaea4b1391534cd92932caa839e04bcd";
const DEFAULT_FUJI_SETTLEMENT_MANAGER: &str = "0xa73208b62af9a87fb5e2b694b27f510d70e17746";

const LOCKED_ROOMS_QUERY: &str = r#"
query ArcadeSettlerLockedRooms($limit: Int!) {
  ArcadeRoom(
    limit: $limit
    where: { status: { _eq: "locked" } }
    order_by: { updatedAt: asc }
  ) {
    id
    chainId
    status
    endsAt
    prizePoolUsdc
    resultsRoot
    payoutSchemaHash
    payoutTotal
    protocolFee
    metadataURI
    updatedAt
  }
}
"#;

sol! {
    #[sol(rpc)]
    contract FxBentoSettlementManagerContract {
        struct PayoutRoot {
            uint256 roomId;
            bytes32 winnerRoot;
            bytes32 rosterHash;
            bytes32 leaderboardHash;
            bytes32 scoreRoot;
            bytes32 settlementPriceRoot;
            uint256 payoutTotal;
            uint256 protocolFee;
            bytes32 metadataHash;
        }

        function submitResults(
            uint256 roomId,
            PayoutRoot payout,
            string metadataURI,
            bytes attestation
        ) external;
    }
}

#[derive(Debug, Error)]
pub enum ArcadeSettlerBootError {
    #[error("invalid BUFI_API_URL/TELARANA_API_URL: {0}")]
    InvalidApiUrl(String),
    #[error("invalid keeper signer key: {0}")]
    InvalidSignerKey(String),
}

#[derive(Debug, Error)]
enum ArcadeSettlerError {
    #[error("api http: {0}")]
    ApiHttp(String),
    #[error("api graphql: {0}")]
    ApiGraphql(String),
    #[error("api parse: {0}")]
    ApiParse(String),
    #[error("invalid RPC URL for chain {chain_id}: {reason}")]
    InvalidRpcUrl { chain_id: u64, reason: String },
    #[error("invalid settlement manager for chain {chain_id}: {reason}")]
    InvalidSettlementManager { chain_id: u64, reason: String },
    #[error("on-chain: {0}")]
    Onchain(String),
}

pub struct ArcadeSettler {
    api_url: String,
    interval: Duration,
    dry_run: bool,
    candidate_limit: usize,
    signer_key_hex: String,
    http: reqwest::Client,
}

impl ArcadeSettler {
    pub fn new(cfg: &Config, signer_key_hex: &str) -> Result<Option<Self>, ArcadeSettlerBootError> {
        if !cfg.arcade_settler_enabled {
            return Ok(None);
        }

        let api_url = normalize_api_url(&cfg.telarana_api_url)
            .map_err(ArcadeSettlerBootError::InvalidApiUrl)?;
        let _signer: PrivateKeySigner =
            signer_key_hex
                .parse()
                .map_err(|e: alloy_signer_local::LocalSignerError| {
                    ArcadeSettlerBootError::InvalidSignerKey(e.to_string())
                })?;
        let interval = Duration::from_millis(env_u64("ARCADE_SETTLER_INTERVAL_MS", 15_000));
        let dry_run = env_bool("ARCADE_SETTLER_DRY_RUN", false);
        let candidate_limit = env_u64("ARCADE_SETTLER_CANDIDATE_LIMIT", 50).max(1) as usize;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("reqwest client builder");

        Ok(Some(Self {
            api_url,
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
            dry_run = self.dry_run,
            interval_ms = self.interval.as_millis() as u64,
            "arcade settler enabled"
        );

        loop {
            if let Err(e) = self.scan_once().await {
                warn!(error = ?e, "arcade settler scan failed");
            }
            sleep(self.interval).await;
        }
    }

    async fn scan_once(&self) -> Result<(), ArcadeSettlerError> {
        let rooms = self.fetch_locked_rooms().await?;
        if rooms.is_empty() {
            debug!("arcade settler: no locked rooms");
            return Ok(());
        }

        let now = now_unix_secs();
        let mut submitted = 0usize;
        let mut skipped = 0usize;
        let mut failed = 0usize;

        for room in rooms {
            if room.ends_at == 0 || room.ends_at > now {
                skipped += 1;
                continue;
            }
            match self.process_room(room).await {
                Ok(ArcadeOutcome::Submitted(tx)) => {
                    submitted += 1;
                    info!(tx = ?tx, "arcade settler: results submitted");
                }
                Ok(ArcadeOutcome::DryRun) => {
                    skipped += 1;
                }
                Err(e) => {
                    failed += 1;
                    warn!(error = ?e, "arcade settler room failed");
                }
            }
        }

        info!(submitted, skipped, failed, "arcade settler scan complete");
        Ok(())
    }

    async fn fetch_locked_rooms(&self) -> Result<Vec<ArcadeRoom>, ArcadeSettlerError> {
        let request = GraphQlRequest {
            query: LOCKED_ROOMS_QUERY,
            variables: json!({ "limit": self.candidate_limit as i64 }),
        };
        let url = format!("{}/graph", self.api_url);
        let res = self
            .http
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ArcadeSettlerError::ApiHttp(format!("send {url}: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(ArcadeSettlerError::ApiHttp(format!(
                "graph status {status}: {body}"
            )));
        }
        let body: GraphQlResponse<ArcadeData> = res
            .json()
            .await
            .map_err(|e| ArcadeSettlerError::ApiParse(e.to_string()))?;
        if let Some(errors) = body.errors.filter(|errs| !errs.is_empty()) {
            return Err(ArcadeSettlerError::ApiGraphql(
                errors
                    .into_iter()
                    .map(|e| e.message)
                    .collect::<Vec<_>>()
                    .join("; "),
            ));
        }
        Ok(body
            .data
            .unwrap_or_default()
            .arcade_rooms
            .into_iter()
            .filter_map(ArcadeRoom::from_row)
            .collect())
    }

    async fn process_room(&self, room: ArcadeRoom) -> Result<ArcadeOutcome, ArcadeSettlerError> {
        let metadata_uri = if room.metadata_uri.is_empty() {
            std::env::var("ARCADE_SETTLER_METADATA_URI")
                .unwrap_or_else(|_| "ipfs://fx-bento-settlement-pending".to_string())
        } else {
            room.metadata_uri.clone()
        };
        let payout = FxBentoSettlementManagerContract::PayoutRoot {
            roomId: room.room_id,
            winnerRoot: room.results_root,
            rosterHash: B256::ZERO,
            leaderboardHash: B256::ZERO,
            scoreRoot: B256::ZERO,
            settlementPriceRoot: B256::ZERO,
            payoutTotal: if room.payout_total > U256::ZERO {
                room.payout_total
            } else {
                room.prize_pool_usdc
            },
            protocolFee: room.protocol_fee,
            metadataHash: keccak256(metadata_uri.as_bytes()),
        };

        if self.dry_run {
            info!(
                chain_id = room.chain_id,
                room_id = %room.room_id,
                ends_at = room.ends_at,
                "arcade settler dry-run room"
            );
            return Ok(ArcadeOutcome::DryRun);
        }

        let signer: PrivateKeySigner =
            self.signer_key_hex
                .parse()
                .map_err(|e: alloy_signer_local::LocalSignerError| {
                    ArcadeSettlerError::Onchain(format!("invalid signer: {e}"))
                })?;
        let wallet = EthereumWallet::from(signer);
        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(rpc_url_for_chain(room.chain_id)?);
        let manager = settlement_manager_for_chain(room.chain_id)?;
        let contract = FxBentoSettlementManagerContract::new(manager, &provider);
        let pending = contract
            .submitResults(room.room_id, payout, metadata_uri, Bytes::new())
            .send()
            .await
            .map_err(|e| ArcadeSettlerError::Onchain(format!("submitResults send: {e}")))?;
        let receipt = pending
            .get_receipt()
            .await
            .map_err(|e| ArcadeSettlerError::Onchain(format!("submitResults receipt: {e}")))?;
        let tx = receipt.transaction_hash;
        if !receipt.status() {
            return Err(ArcadeSettlerError::Onchain(format!(
                "submitResults reverted (tx {tx:#x})"
            )));
        }
        Ok(ArcadeOutcome::Submitted(tx))
    }
}

enum ArcadeOutcome {
    Submitted(B256),
    DryRun,
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

#[derive(Debug, Default, Deserialize)]
struct ArcadeData {
    #[serde(default, rename = "ArcadeRoom")]
    arcade_rooms: Vec<ArcadeRoomRow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArcadeRoomRow {
    id: String,
    chain_id: u64,
    ends_at: String,
    prize_pool_usdc: String,
    results_root: String,
    payout_total: String,
    protocol_fee: String,
    metadata_uri: String,
}

#[derive(Debug, Clone)]
struct ArcadeRoom {
    room_id: U256,
    chain_id: u64,
    ends_at: u64,
    prize_pool_usdc: U256,
    results_root: B256,
    payout_total: U256,
    protocol_fee: U256,
    metadata_uri: String,
}

impl ArcadeRoom {
    fn from_row(row: ArcadeRoomRow) -> Option<Self> {
        Some(Self {
            room_id: U256::from_str(row.id.trim()).ok()?,
            chain_id: row.chain_id,
            ends_at: row.ends_at.parse::<u64>().unwrap_or(0),
            prize_pool_usdc: U256::from_str(row.prize_pool_usdc.trim()).ok()?,
            results_root: parse_optional_b256(&row.results_root),
            payout_total: U256::from_str(row.payout_total.trim()).ok()?,
            protocol_fee: U256::from_str(row.protocol_fee.trim()).ok()?,
            metadata_uri: row.metadata_uri,
        })
    }
}

fn settlement_manager_for_chain(chain_id: u64) -> Result<Address, ArcadeSettlerError> {
    let raw = match chain_id {
        ARC_CHAIN_ID => std::env::var("FX_BENTO_SETTLEMENT_MANAGER_5042002")
            .or_else(|_| std::env::var("ARCADE_SETTLER_ARC_MANAGER"))
            .unwrap_or_else(|_| DEFAULT_ARC_SETTLEMENT_MANAGER.to_string()),
        FUJI_CHAIN_ID => std::env::var("FX_BENTO_SETTLEMENT_MANAGER_43113")
            .or_else(|_| std::env::var("ARCADE_SETTLER_FUJI_MANAGER"))
            .unwrap_or_else(|_| DEFAULT_FUJI_SETTLEMENT_MANAGER.to_string()),
        other => {
            return Err(ArcadeSettlerError::InvalidSettlementManager {
                chain_id: other,
                reason: "unsupported hub chain".to_string(),
            })
        }
    };
    raw.parse::<Address>()
        .map_err(|e| ArcadeSettlerError::InvalidSettlementManager {
            chain_id,
            reason: e.to_string(),
        })
}

fn rpc_url_for_chain(chain_id: u64) -> Result<reqwest::Url, ArcadeSettlerError> {
    let raw = match chain_id {
        ARC_CHAIN_ID => std::env::var("ARCADE_SETTLER_ARC_RPC_URL")
            .or_else(|_| std::env::var("TELARANA_ARC_RPC_URL"))
            .or_else(|_| std::env::var("ARC_RPC_URL"))
            .unwrap_or_else(|_| DEFAULT_ARC_RPC_URL.to_string()),
        FUJI_CHAIN_ID => std::env::var("ARCADE_SETTLER_FUJI_RPC_URL")
            .or_else(|_| std::env::var("TELARANA_FUJI_RPC_URL"))
            .or_else(|_| std::env::var("FUJI_RPC_URL"))
            .unwrap_or_else(|_| DEFAULT_FUJI_RPC_URL.to_string()),
        other => {
            return Err(ArcadeSettlerError::InvalidRpcUrl {
                chain_id: other,
                reason: "unsupported hub chain".to_string(),
            })
        }
    };
    raw.parse::<reqwest::Url>()
        .map_err(|e| ArcadeSettlerError::InvalidRpcUrl {
            chain_id,
            reason: e.to_string(),
        })
}

fn parse_optional_b256(raw: &str) -> B256 {
    if raw.is_empty() {
        B256::ZERO
    } else {
        B256::from_str(raw).unwrap_or(B256::ZERO)
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

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
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
