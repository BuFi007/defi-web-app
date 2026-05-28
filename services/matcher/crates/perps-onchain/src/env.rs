//! Env-var resolution for runtime configuration.
//!
//! ```text
//!   ARC_RPC_URL                       JSON-RPC endpoint (primary)
//!                                     (default https://rpc.drpc.testnet.arc.network)
//!   ARC_RPC_FALLBACK_URL              JSON-RPC endpoint (fallback)
//!                                     (default https://rpc.testnet.arc.network)
//!   PERP_KEEPER_PRIVATE_KEY           Signer hex (preferred)
//!   DEPLOYER_PRIVATE_KEY              Signer hex (fallback)
//!   FX_TELARANA_DEPLOYMENTS           Path to fx-telarana/deployments/
//!                                     (default: ../../fx-telarana/deployments
//!                                     relative to the matcher worktree root)
//!   CONTRACT_ADDRESSES_JSON           Optional override; same shape as the TS
//!                                     loadContracts() merge map. When set, the
//!                                     `perps.*` keys for `chainId` override
//!                                     individual addresses on top of the
//!                                     fx-telarana JSON.
//! ```

use std::env;
use std::path::PathBuf;

/// Default Arc Testnet RPC (primary). dRPC mirror — benchmarked ~2x faster
/// than the public endpoint (259ms vs 530ms avg).
pub const DEFAULT_ARC_RPC_URL: &str = "https://rpc.drpc.testnet.arc.network";

/// Default Arc Testnet RPC (fallback). Public Circle endpoint — used if
/// dRPC has an outage. No API key needed for either.
pub const DEFAULT_ARC_RPC_FALLBACK_URL: &str = "https://rpc.testnet.arc.network";

/// Arc Testnet chain id (decimal). Matches `ARC_CHAIN_ID` in the TS keeper.
pub const ARC_CHAIN_ID: u64 = 5_042_002;

/// Resolve the Arc RPC URL from `ARC_RPC_URL` env, falling back to the
/// dRPC default (primary).
pub fn arc_rpc_url() -> String {
    env::var("ARC_RPC_URL").unwrap_or_else(|_| DEFAULT_ARC_RPC_URL.to_string())
}

/// Resolve the fallback Arc RPC URL from `ARC_RPC_FALLBACK_URL` env, falling
/// back to the public Circle endpoint.
pub fn arc_rpc_fallback_url() -> String {
    env::var("ARC_RPC_FALLBACK_URL")
        .unwrap_or_else(|_| DEFAULT_ARC_RPC_FALLBACK_URL.to_string())
}

/// Resolve the keeper signing key from `PERP_KEEPER_PRIVATE_KEY` or
/// `DEPLOYER_PRIVATE_KEY` (in that order). Returned with any `0x` prefix
/// stripped.
pub fn keeper_private_key() -> Option<String> {
    env::var("PERP_KEEPER_PRIVATE_KEY")
        .or_else(|_| env::var("DEPLOYER_PRIVATE_KEY"))
        .ok()
        .map(|s| s.trim_start_matches("0x").to_string())
}

/// Resolve the path to `fx-telarana/deployments/`.
///
/// Lookup order:
///   1. `FX_TELARANA_DEPLOYMENTS` env (explicit absolute or relative path).
///   2. `../../fx-telarana/deployments` relative to the current dir
///      (the sibling-clone pattern this monorepo uses).
pub fn fx_telarana_deployments_dir() -> PathBuf {
    if let Some(p) = env::var_os("FX_TELARANA_DEPLOYMENTS") {
        return PathBuf::from(p);
    }
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    cwd.join("../../fx-telarana/deployments")
}
