//! Rust replacement for `apps/keeper-arcade-settler`.
//!
//! The original consolidation plan left this game keeper in TS. The current
//! operator request is stricter: no `apps/keeper-*` processes in dev or
//! Railway. The TS keeper was a boot-log placeholder, so this module carries
//! that behavior in the matcher binary.

use tokio::time::{sleep, Duration};
use tracing::info;

use crate::config::Config;

pub struct ArcadeSettler;

impl ArcadeSettler {
    pub fn new(cfg: &Config) -> Option<Self> {
        cfg.arcade_settler_enabled.then_some(Self)
    }

    pub async fn run(self) {
        info!(
            note = "wire FX Bento room settlement windows -> oracle snapshot -> Bento.settle",
            "arcade settler ready"
        );
        loop {
            sleep(Duration::from_secs(3600)).await;
        }
    }
}
