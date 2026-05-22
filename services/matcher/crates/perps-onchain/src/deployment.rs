//! Loader for `fx-telarana/deployments/perp-stack-{chainId}.json`.
//!
//! **Filename was `perps-{chain_id}.json` in the pre-sprint-1 layout.**
//! Sprint-1 (broadcast 2026-05-21, PR #38) introduced the
//! `perp-stack-{chainId}.json` file with the new addresses + liquidation
//! params. The older `perps-{chain_id}.json` is stale; this loader reads
//! the sprint-1 file, falling back to the legacy filename only when the
//! sprint-1 file is missing.
//!
//! Schema (flat top-level keys, see
//! `fx-telarana/deployments/perp-stack-5042002.json` HEAD `c0ff0d3`):
//!
//! ```json
//! {
//!   "chainId": 5042002,
//!   "deployer": "0x…",
//!   "keeper": "0x…",
//!   "FxOrderSettlement": "0x…",
//!   "FxPerpClearinghouse": "0x…",
//!   "FxFundingEngine": "0x…",
//!   "FxHealthChecker": "0x…",
//!   "FxLiquidationEngine": "0x…",
//!   "FxMarginAccount": "0x…",
//!   "liquidation_bountyBps": 500,
//!   "liquidation_bountyCap": 5000000,
//!   "liquidation_flagDelay": 120
//! }
//! ```
//!
//! Override layer: `CONTRACT_ADDRESSES_JSON` env (TS-compatible) lets ops
//! patch individual addresses without re-deploying. The override map is
//! shaped like `{ "<chainId>": { "perps": { "orderSettlement": "0x…", … } } }`.

use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use alloy_primitives::Address;
use serde::Deserialize;
use thiserror::Error;

use crate::env::fx_telarana_deployments_dir;

/// Per-contract addresses for a single chain's perp deployment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct PerpsContracts {
    /// FxOrderSettlement — keeper calls `settleMatch` on this.
    pub fx_order_settlement: Address,
    /// FxPerpClearinghouse — OI / margin / position state lives here.
    pub fx_perp_clearinghouse: Address,
    /// FxFundingEngine — funding rate computation.
    pub fx_funding_engine: Address,
    /// FxHealthChecker — margin-health checks.
    pub fx_health_checker: Address,
    /// FxLiquidationEngine — liquidations.
    pub fx_liquidation_engine: Address,
    /// FxMarginAccount — per-trader collateral state.
    pub fx_margin_account: Address,
}

/// Liquidation parameters baked into the sprint-1 deployment manifest.
/// Mirrors `FxLiquidationEngine.liquidationConfig`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LiquidationParams {
    /// Bounty paid to the keeper, in basis points of the liquidated notional.
    pub bounty_bps: u32,
    /// Max bounty cap (USDC quantums, 6-dec).
    pub bounty_cap: u64,
    /// Delay between `flagAccount` and `liquidate` (seconds).
    pub flag_delay_secs: u32,
}

/// Full deployment metadata for a chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PerpsDeployment {
    /// Chain id (e.g. `5_042_002` for Arc Testnet).
    pub chain_id: u64,
    /// Address that deployed the stack.
    pub deployer: Address,
    /// Authorised keeper address (`SETTLER_ROLE` holder).
    pub keeper: Address,
    /// Contract addresses.
    pub contracts: PerpsContracts,
    /// Liquidation params (sprint-1+). Zero-valued for pre-sprint-1 manifests.
    pub liquidation: LiquidationParams,
}

/// Errors raised by the deployment loader.
#[derive(Debug, Error)]
pub enum DeploymentLoadError {
    /// Couldn't open or read the JSON file.
    #[error("failed to read {path}: {source}")]
    Io {
        /// Path we tried.
        path: PathBuf,
        /// Underlying io::Error.
        source: std::io::Error,
    },
    /// JSON parsing failed.
    #[error("failed to parse {path}: {source}")]
    Parse {
        /// Path we tried.
        path: PathBuf,
        /// serde_json error.
        source: serde_json::Error,
    },
    /// `CONTRACT_ADDRESSES_JSON` couldn't be parsed.
    #[error("failed to parse CONTRACT_ADDRESSES_JSON: {0}")]
    OverrideParse(serde_json::Error),
    /// Override contained a malformed address. Source held as String so
    /// the loader is insulated from alloy's parse-error type changing
    /// between minor versions.
    #[error("override address for {field} is invalid: {reason}")]
    OverrideAddress {
        /// Which field the override targets.
        field: String,
        /// Why parsing failed.
        reason: String,
    },
}

impl PerpsDeployment {
    /// Load `perp-stack-{chain_id}.json` from `dir`, falling back to the
    /// legacy `perps-{chain_id}.json` if the sprint-1 file is missing.
    /// Applies the `CONTRACT_ADDRESSES_JSON` env override if present.
    pub fn load_from_dir(dir: &Path, chain_id: u64) -> Result<Self, DeploymentLoadError> {
        let sprint1 = dir.join(format!("perp-stack-{chain_id}.json"));
        if sprint1.exists() {
            return Self::load_from_file(&sprint1);
        }
        let legacy = dir.join(format!("perps-{chain_id}.json"));
        Self::load_from_file(&legacy)
    }

    /// Load from an explicit JSON path. Applies the env override.
    pub fn load_from_file(path: &Path) -> Result<Self, DeploymentLoadError> {
        let raw = fs::read_to_string(path).map_err(|source| DeploymentLoadError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        let flat: FlatManifest =
            serde_json::from_str(&raw).map_err(|source| DeploymentLoadError::Parse {
                path: path.to_path_buf(),
                source,
            })?;
        let mut deployment = Self {
            chain_id: flat.chain_id,
            deployer: flat.deployer,
            keeper: flat.keeper,
            contracts: PerpsContracts {
                fx_order_settlement: flat.fx_order_settlement,
                fx_perp_clearinghouse: flat.fx_perp_clearinghouse,
                fx_funding_engine: flat.fx_funding_engine,
                fx_health_checker: flat.fx_health_checker,
                fx_liquidation_engine: flat.fx_liquidation_engine,
                fx_margin_account: flat.fx_margin_account,
            },
            liquidation: LiquidationParams {
                bounty_bps: flat.liquidation_bounty_bps.unwrap_or(0),
                bounty_cap: flat.liquidation_bounty_cap.unwrap_or(0),
                flag_delay_secs: flat.liquidation_flag_delay.unwrap_or(0),
            },
        };
        apply_env_override(&mut deployment)?;
        Ok(deployment)
    }

    /// Convenience: load via `fx_telarana_deployments_dir()`.
    pub fn load_from_env(chain_id: u64) -> Result<Self, DeploymentLoadError> {
        Self::load_from_dir(&fx_telarana_deployments_dir(), chain_id)
    }
}

#[derive(Deserialize)]
struct FlatManifest {
    #[serde(rename = "chainId")]
    chain_id: u64,
    deployer: Address,
    keeper: Address,
    #[serde(rename = "FxOrderSettlement")]
    fx_order_settlement: Address,
    #[serde(rename = "FxPerpClearinghouse")]
    fx_perp_clearinghouse: Address,
    #[serde(rename = "FxFundingEngine")]
    fx_funding_engine: Address,
    #[serde(rename = "FxHealthChecker")]
    fx_health_checker: Address,
    #[serde(rename = "FxLiquidationEngine")]
    fx_liquidation_engine: Address,
    #[serde(rename = "FxMarginAccount")]
    fx_margin_account: Address,
    // Sprint-1+ fields; absent on legacy perps-{id}.json.
    #[serde(default, rename = "liquidation_bountyBps")]
    liquidation_bounty_bps: Option<u32>,
    #[serde(default, rename = "liquidation_bountyCap")]
    liquidation_bounty_cap: Option<u64>,
    #[serde(default, rename = "liquidation_flagDelay")]
    liquidation_flag_delay: Option<u32>,
}

// ---------------------------------------------------------------------------
// CONTRACT_ADDRESSES_JSON override (matches the TS loadContracts merge).
// ---------------------------------------------------------------------------

fn apply_env_override(deployment: &mut PerpsDeployment) -> Result<(), DeploymentLoadError> {
    let Ok(raw) = std::env::var("CONTRACT_ADDRESSES_JSON") else {
        return Ok(());
    };
    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(DeploymentLoadError::OverrideParse)?;

    let chain_key = deployment.chain_id.to_string();
    let Some(chain_patch) = parsed.get(&chain_key).and_then(|v| v.as_object()) else {
        return Ok(());
    };

    if let Some(perps) = chain_patch.get("perps").and_then(|v| v.as_object()) {
        for (key, slot) in [
            (
                "orderSettlement",
                &mut deployment.contracts.fx_order_settlement,
            ),
            (
                "clearinghouse",
                &mut deployment.contracts.fx_perp_clearinghouse,
            ),
            ("fundingEngine", &mut deployment.contracts.fx_funding_engine),
            ("healthChecker", &mut deployment.contracts.fx_health_checker),
            (
                "liquidationEngine",
                &mut deployment.contracts.fx_liquidation_engine,
            ),
            ("marginAccount", &mut deployment.contracts.fx_margin_account),
        ] {
            if let Some(addr_str) = perps.get(key).and_then(|v| v.as_str()) {
                *slot = Address::from_str(addr_str).map_err(|e| {
                    DeploymentLoadError::OverrideAddress {
                        field: format!("perps.{key}"),
                        reason: e.to_string(),
                    }
                })?;
            }
        }
    }
    Ok(())
}
