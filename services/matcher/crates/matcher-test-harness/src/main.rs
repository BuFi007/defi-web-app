//! Replays a fill-log corpus through the orderbook core and diffs against
//! the canonical golden outputs in `crates/orderbook/tests/golden/`.
//!
//! Phase 1 scaffold — does nothing yet. Real replay tool lands with the
//! Phase 2 golden test suite.

use std::process::ExitCode;

fn main() -> ExitCode {
    println!("bufi-matcher-replay: Phase 1 scaffold — replay corpus not yet wired up");
    ExitCode::SUCCESS
}
