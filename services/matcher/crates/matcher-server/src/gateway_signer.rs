//! Rust replacement for `apps/keeper-gateway-signer`.
//!
//! The deleted TS keeper only boot-logged the Circle/Gateway config. This
//! module preserves that role inside the matcher binary while the attestation
//! relay is promoted from placeholder to event-driven execution.

use tokio::time::{sleep, Duration};
use tracing::info;

use crate::config::Config;

pub struct GatewaySigner {
    circle_api: String,
}

impl GatewaySigner {
    pub fn new(cfg: &Config) -> Option<Self> {
        if !cfg.gateway_signer_enabled {
            return None;
        }
        let circle_api = std::env::var("GATEWAY_API_BASE")
            .unwrap_or_else(|_| "https://gateway-api-testnet.circle.com".to_string());
        Some(Self { circle_api })
    }

    pub async fn run(self) {
        info!(
            circle_api = %self.circle_api,
            fuji_hook = "0x7dA191bfB85D9F14069228cf618519BFb41f371E",
            arc_hook = "0x2931C50745334d6DFf9eC4E3106fE05b49717DF1",
            note = "wire LockedForRemote polling and Circle /transfer attestation relay here",
            "gateway signer ready"
        );
        loop {
            sleep(Duration::from_secs(3600)).await;
        }
    }
}
