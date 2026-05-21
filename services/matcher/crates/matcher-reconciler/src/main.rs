//! Reconciler: every 60s, diff matcher-side fills against Ponder-indexed
//! on-chain settlements. Emit OTel alerts when they disagree.
//!
//! Phase 1 scaffold — boots the runtime, logs, exits cleanly. Real diff loop
//! lands in Phase 3 alongside the keeper integration.

use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt().json().init();
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        "BUFI matcher reconciler starting (Phase 1 scaffold)"
    );
    ExitCode::SUCCESS
}
