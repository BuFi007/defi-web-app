//! Phase 7 canary keeper — synthetic-intent liveness probe.
//!
//! Inserts one tiny, EIP-712-signed `PerpIntent` per `canary_interval`
//! using a dedicated third EOA (`CANARY_TRADER_PRIVATE_KEY`), then polls
//! the DB row until it reaches a terminal status (`filled`, `rejected`,
//! `expired`). If the row stays in `pending` / `partially_filled` past
//! `canary_timeout` the canary emits an `ERROR` log — operators wire that
//! line into PagerDuty/Slack.
//!
//! Design notes:
//!   - Tiny notional (default 1 USDC) so a stuck canary doesn't drain
//!     margin on the canary EOA.
//!   - Distinct EOA from `PERP_KEEPER_PRIVATE_KEY` (settler) and
//!     `LP_OPERATOR_PRIVATE_KEY` (synthetic LP) so a canary key compromise
//!     can't impersonate either of the other roles.
//!   - Intent insertion mimics what `apps/api` does: build a `SignedOrder`,
//!     sign it, derive the digest as `intent_id`, and `PerpsDb::put` it
//!     with `status = pending`. The matcher's tick loop picks it up like
//!     any other intent.
//!   - All wall-clock reads stay in this module — never in
//!     `crates/orderbook` (pure-core).

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use alloy_primitives::{Address, B256, I256, Signature as PrimitiveSignature, U256};
use alloy_signer::SignerSync;
use alloy_signer_local::PrivateKeySigner;
use alloy_sol_types::SolStruct;
use thiserror::Error;
use tokio::time::sleep;
use tracing::{debug, error, info};

use bufi_matcher_types::eip712::{domain as eip712_domain, SignedOrder as TypedSignedOrder};
use bufi_perps_db::{
    PerpIntent, PerpIntentStatus, PerpOrderType, PerpSide, PerpsDb, PerpsDbError,
};
use bufi_perps_onchain::PerpsDeployment;

/// Errors the canary surfaces at boot. Runtime ticks log + retry; only
/// boot-time misconfig aborts the matcher.
#[derive(Debug, Error)]
pub enum CanaryError {
    /// `CANARY_TRADER_PRIVATE_KEY` couldn't be parsed.
    #[error("CANARY_TRADER_PRIVATE_KEY parse: {0}")]
    Key(String),
    /// Tried to share a key with the keeper or the LP operator.
    #[error(
        "CANARY_TRADER_PRIVATE_KEY collides with {role}; canary must be a distinct EOA"
    )]
    KeyCollision {
        /// `"PERP_KEEPER"` or `"LP_OPERATOR"`.
        role: &'static str,
    },
}

/// Configured canary keeper — owns its signer and per-tick parameters.
pub struct Canary {
    db: PerpsDb,
    deployment: PerpsDeployment,
    signer: PrivateKeySigner,
    trader: Address,
    interval: Duration,
    timeout: Duration,
    market_id: [u8; 32],
    notional_usdc_e6: u64,
}

impl Canary {
    /// Build from explicit pieces. Returns `Ok(None)` when the canary key
    /// isn't set — the parent module treats that as "canary disabled".
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        db: PerpsDb,
        deployment: PerpsDeployment,
        canary_key_hex: Option<&str>,
        perp_keeper_key_hex: Option<&str>,
        lp_operator_key_hex: Option<&str>,
        interval: Duration,
        timeout: Duration,
        market_id: [u8; 32],
        notional_usdc_e6: u64,
    ) -> Result<Option<Self>, CanaryError> {
        let Some(raw) = canary_key_hex else {
            return Ok(None);
        };
        let stripped = raw.trim_start_matches("0x");
        let signer: PrivateKeySigner = stripped
            .parse()
            .map_err(|e: alloy_signer_local::LocalSignerError| CanaryError::Key(e.to_string()))?;
        let trader = signer.address();

        // Reject reuse of the keeper or LP signing keys — the canary
        // takes the *taker* side of trades; if it shared the keeper key
        // the on-chain `settleMatch` would revert with `maker == taker`.
        if same_signer(stripped, perp_keeper_key_hex) {
            return Err(CanaryError::KeyCollision { role: "PERP_KEEPER" });
        }
        if same_signer(stripped, lp_operator_key_hex) {
            return Err(CanaryError::KeyCollision { role: "LP_OPERATOR" });
        }

        Ok(Some(Self {
            db,
            deployment,
            signer,
            trader,
            interval,
            timeout,
            market_id,
            notional_usdc_e6,
        }))
    }

    /// Canary trader address — logged at boot so operators can fund the
    /// EOA's margin before pointing the matcher at it.
    pub fn trader_address(&self) -> Address {
        self.trader
    }

    /// Run forever. Sleeps `interval` between attempts.
    pub async fn run(self) {
        info!(
            trader = ?self.trader,
            market = format!("0x{}", hex32(&self.market_id)),
            interval_secs = self.interval.as_secs(),
            timeout_secs = self.timeout.as_secs(),
            notional_usdc_e6 = self.notional_usdc_e6,
            "canary keeper started"
        );
        loop {
            match self.tick().await {
                Ok(TickReport { intent_id, status, latency_ms }) => {
                    info!(
                        intent_id,
                        status = status.as_str(),
                        latency_ms,
                        "canary tick: terminal status reached"
                    );
                }
                Err(e) => {
                    error!(error = ?e, "canary tick failed; alerting operators");
                }
            }
            sleep(self.interval).await;
        }
    }

    async fn tick(&self) -> Result<TickReport, CanaryTickError> {
        let now_secs = current_unix_secs();
        let deadline_secs = now_secs.saturating_add(self.timeout.as_secs().saturating_add(60));
        let (intent_id, signed_order, signature) = self.sign_synthetic_intent(deadline_secs)?;
        let intent_id_hex = format!("0x{}", hex32(&intent_id));

        let intent_row = self.build_perp_intent(
            &intent_id_hex,
            &signed_order,
            &signature,
            now_secs as i64,
            deadline_secs as i64,
        );
        self.db.put(&intent_row).await.map_err(CanaryTickError::Db)?;
        debug!(intent_id = intent_id_hex, "canary: synthetic intent inserted");

        let started_at_ms = now_unix_ms();
        let deadline_at_ms = started_at_ms + self.timeout.as_millis() as u64;
        loop {
            let row = self
                .db
                .get(&intent_id_hex)
                .await
                .map_err(CanaryTickError::Db)?
                .ok_or_else(|| CanaryTickError::Vanished(intent_id_hex.clone()))?;
            if is_terminal(row.status) {
                let latency_ms = now_unix_ms().saturating_sub(started_at_ms);
                return Ok(TickReport {
                    intent_id: intent_id_hex,
                    status: row.status,
                    latency_ms,
                });
            }
            if now_unix_ms() >= deadline_at_ms {
                return Err(CanaryTickError::Timeout {
                    intent_id: intent_id_hex,
                    last_status: row.status,
                    timeout_secs: self.timeout.as_secs(),
                });
            }
            sleep(Duration::from_millis(500)).await;
        }
    }

    fn sign_synthetic_intent(
        &self,
        deadline_secs: u64,
    ) -> Result<([u8; 32], TypedSignedOrder, Vec<u8>), CanaryTickError> {
        // Canary trades LONG so the LP backstop quotes against it; the
        // notional is converted to an 18-dec WAD using a 1.0 placeholder
        // price (the LP gate will fill at the real oracle mark, not this).
        let mag_e18: u128 = (self.notional_usdc_e6 as u128).saturating_mul(1_000_000_000_000u128);
        let size_delta = i128::try_from(mag_e18).map_err(|_| CanaryTickError::SizeOverflow)?;
        let order = TypedSignedOrder {
            trader: self.trader,
            marketId: B256::from(self.market_id),
            sizeDeltaE18: I256::try_from(size_delta).expect("i128 fits in i256"),
            // Limit at a far-OTM price (10_000 USDC per unit) so the
            // matcher prefers the LP quote at the oracle mark and the
            // canary always settles via LP.
            priceE18: U256::from(10_000u128) * U256::from(10u128.pow(18)),
            maxFee: U256::ZERO,
            orderType: 1, // LIMIT
            flags: 0,
            // Permit2 bitmap nonce — millis since epoch matches LpSigner.
            nonce: now_unix_ms(),
            deadline: deadline_secs,
        };
        let domain = eip712_domain(
            self.deployment.chain_id,
            self.deployment.contracts.fx_order_settlement,
        );
        let digest: B256 = order.eip712_signing_hash(&domain);
        let sig = self
            .signer
            .sign_hash_sync(&digest)
            .map_err(|e| CanaryTickError::Sign(e.to_string()))?;
        let sig: PrimitiveSignature = sig;
        let mut bytes = Vec::with_capacity(65);
        bytes.extend_from_slice(&sig.r().to_be_bytes::<32>());
        bytes.extend_from_slice(&sig.s().to_be_bytes::<32>());
        bytes.push(if sig.v() { 28 } else { 27 });
        Ok((digest.0, order, bytes))
    }

    fn build_perp_intent(
        &self,
        intent_id_hex: &str,
        order: &TypedSignedOrder,
        signature: &[u8],
        now_secs: i64,
        deadline_secs: i64,
    ) -> PerpIntent {
        let size_delta_str = order.sizeDeltaE18.to_string();
        PerpIntent {
            intent_id: intent_id_hex.to_string(),
            replacement_of: None,
            chain_id: self.deployment.chain_id as i64,
            trader: format!("{:#x}", self.trader),
            market_id: format!("0x{}", hex32(&self.market_id)),
            side: PerpSide::Long,
            size_usdc: self.notional_usdc_e6.to_string(),
            size_delta: size_delta_str.clone(),
            filled_size_delta: "0".to_string(),
            remaining_size_delta: size_delta_str,
            leverage: 1,
            order_type: PerpOrderType::Limit,
            price_e18: order.priceE18.to_string(),
            limit_price: None,
            reduce_only: false,
            post_only: false,
            flags: 0,
            digest: intent_id_hex.to_string(),
            signature: format!("0x{}", hex_bytes(signature)),
            nonce: order.nonce.to_string(),
            deadline: deadline_secs,
            status: PerpIntentStatus::Pending,
            created_at: now_secs,
            updated_at: now_secs,
        }
    }
}

/// Per-tick report — logged at INFO on success.
#[derive(Debug)]
#[allow(dead_code)]
struct TickReport {
    intent_id: String,
    status: PerpIntentStatus,
    latency_ms: u64,
}

/// Per-tick failures. Logged at ERROR so the operator's alerting pipeline
/// picks them up.
#[derive(Debug, Error)]
enum CanaryTickError {
    #[error("db: {0}")]
    Db(PerpsDbError),
    #[error("intent {0} vanished from DB before reaching terminal status")]
    Vanished(String),
    #[error(
        "intent {intent_id} stayed in {last_status:?} for {timeout_secs}s — matcher liveness alert"
    )]
    Timeout {
        intent_id: String,
        last_status: PerpIntentStatus,
        timeout_secs: u64,
    },
    #[error("canary size overflow — notional too large for i128")]
    SizeOverflow,
    #[error("signing: {0}")]
    Sign(String),
}

fn is_terminal(status: PerpIntentStatus) -> bool {
    matches!(
        status,
        PerpIntentStatus::Filled
            | PerpIntentStatus::Rejected
            | PerpIntentStatus::Expired
    )
}

fn same_signer(a_hex: &str, b_hex: Option<&str>) -> bool {
    let Some(b_raw) = b_hex else { return false };
    let b = b_raw.trim_start_matches("0x");
    let a_addr = match a_hex.parse::<PrivateKeySigner>() {
        Ok(s) => s.address(),
        Err(_) => return false,
    };
    let b_addr = match b.parse::<PrivateKeySigner>() {
        Ok(s) => s.address(),
        Err(_) => return false,
    };
    a_addr == b_addr
}

fn hex32(b: &[u8; 32]) -> String {
    let mut out = String::with_capacity(64);
    for x in b {
        out.push_str(&format!("{x:02x}"));
    }
    out
}

fn hex_bytes(b: &[u8]) -> String {
    let mut out = String::with_capacity(b.len() * 2);
    for x in b {
        out.push_str(&format!("{x:02x}"));
    }
    out
}

fn current_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bufi_perps_onchain::deployment::{LiquidationParams, PerpsContracts};

    const TEST_KEY: &str = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const OTHER_KEY: &str = "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

    fn fake_deployment() -> PerpsDeployment {
        PerpsDeployment {
            chain_id: 5_042_002,
            deployer: Address::ZERO,
            keeper: Address::ZERO,
            contracts: PerpsContracts {
                fx_order_settlement: Address::ZERO,
                fx_perp_clearinghouse: Address::ZERO,
                fx_funding_engine: Address::ZERO,
                fx_health_checker: Address::ZERO,
                fx_liquidation_engine: Address::ZERO,
                fx_margin_account: Address::ZERO,
            },
            liquidation: LiquidationParams::default(),
        }
    }

    #[tokio::test]
    async fn canary_disabled_when_no_key_set() {
        let db = PerpsDb::open_in_memory().await.unwrap();
        let res = Canary::new(
            db,
            fake_deployment(),
            None,
            None,
            None,
            Duration::from_secs(1),
            Duration::from_secs(1),
            [0u8; 32],
            1,
        );
        match res {
            Ok(None) => {}
            Ok(Some(_)) => panic!("no key ⇒ canary must be disabled"),
            Err(e) => panic!("unexpected error: {e}"),
        }
    }

    #[tokio::test]
    async fn canary_rejects_key_collision_with_keeper() {
        let db = PerpsDb::open_in_memory().await.unwrap();
        let res = Canary::new(
            db,
            fake_deployment(),
            Some(TEST_KEY),
            Some(TEST_KEY),
            Some(OTHER_KEY),
            Duration::from_secs(1),
            Duration::from_secs(1),
            [0u8; 32],
            1,
        );
        match res {
            Err(CanaryError::KeyCollision { role: "PERP_KEEPER" }) => {}
            Ok(_) => panic!("expected KeyCollision, got Ok"),
            Err(e) => panic!("expected KeyCollision(PERP_KEEPER), got {e}"),
        }
    }

    #[tokio::test]
    async fn canary_rejects_key_collision_with_lp_operator() {
        let db = PerpsDb::open_in_memory().await.unwrap();
        let res = Canary::new(
            db,
            fake_deployment(),
            Some(TEST_KEY),
            Some(OTHER_KEY),
            Some(TEST_KEY),
            Duration::from_secs(1),
            Duration::from_secs(1),
            [0u8; 32],
            1,
        );
        match res {
            Err(CanaryError::KeyCollision { role: "LP_OPERATOR" }) => {}
            Ok(_) => panic!("expected KeyCollision, got Ok"),
            Err(e) => panic!("expected KeyCollision(LP_OPERATOR), got {e}"),
        }
    }

    #[tokio::test]
    async fn canary_accepts_distinct_key() {
        let db = PerpsDb::open_in_memory().await.unwrap();
        let res = Canary::new(
            db,
            fake_deployment(),
            Some(TEST_KEY),
            Some(OTHER_KEY),
            None,
            Duration::from_secs(1),
            Duration::from_secs(1),
            [0u8; 32],
            1,
        );
        let canary = match res {
            Ok(Some(c)) => c,
            Ok(None) => panic!("expected canary to be built"),
            Err(e) => panic!("expected Ok, got {e}"),
        };
        assert_ne!(canary.trader_address(), Address::ZERO);
    }

    #[test]
    fn is_terminal_matches_only_terminal_statuses() {
        assert!(is_terminal(PerpIntentStatus::Filled));
        assert!(is_terminal(PerpIntentStatus::Rejected));
        assert!(is_terminal(PerpIntentStatus::Expired));
        assert!(!is_terminal(PerpIntentStatus::Pending));
        assert!(!is_terminal(PerpIntentStatus::PartiallyFilled));
    }
}
