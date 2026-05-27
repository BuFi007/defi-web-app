//! Rust replacement for `apps/keeper-spot`.
//!
//! The deleted TS keeper was a boot-log placeholder. This module keeps the
//! same operator signal inside the consolidated matcher binary until the
//! GatewayAtomicFxSwapRequested event execution path is wired.

use tokio::time::{sleep, Duration};
use tracing::info;

use crate::config::Config;

pub struct SpotExecutor {
    enabled: bool,
}

impl SpotExecutor {
    pub fn new(cfg: &Config) -> Option<Self> {
        cfg.spot_executor_enabled.then_some(Self { enabled: true })
    }

    pub async fn run(self) {
        if !self.enabled {
            return;
        }
        info!(
            tgh = "0x74E894aFf25c89d707873347cd2554d30E0541fa",
            executor = "0x4e7372108529C0e7cb3aa0fF92B1c52e06e9e72f",
            note = "wire GatewayAtomicFxSwapRequested -> receiveGatewayMint -> executeSpotFx",
            "spot executor ready"
        );
        loop {
            sleep(Duration::from_secs(3600)).await;
        }
    }
}
