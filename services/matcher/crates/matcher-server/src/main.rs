//! BUFI matcher server entry point.
//!
//! Phase 1 — scaffolding only. Boots the tokio runtime, sets up tracing,
//! prints "matcher v0.1.0 starting…", and exits cleanly. The gRPC server,
//! Redis publisher, and intent validator land in Phase 2/3.

use std::process::ExitCode;

mod config;
mod intent_validator;
mod grpc;
mod redis_publisher;
mod lp_router;
mod funding;
mod mark_price;

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "bufi_matcher_server=info,info".into()),
        )
        .json()
        .init();

    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        "BUFI matcher server starting (Phase 1 scaffold — no traffic accepted yet)"
    );

    // Real boot sequence lands in Phase 2:
    //   1. Parse config::Config from env.
    //   2. Connect Redis, recover book snapshot.
    //   3. Replay fill log forward from snapshot.
    //   4. Start tonic gRPC server.
    //   5. Spawn the Redis publisher background task.
    //   6. Install signal handlers for graceful shutdown.

    ExitCode::SUCCESS
}
