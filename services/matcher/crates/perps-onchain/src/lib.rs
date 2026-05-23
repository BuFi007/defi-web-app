//! alloy-rs bindings + deployment loaders for the Telaraña perp stack.
//!
//! Source of truth for addresses is `fx-telarana/deployments/perps-{chainId}.json`;
//! per-market config (market ids, OI caps, leverage, fees) lives in
//! `fx-telarana/deployments/perps-config-{chainId}.json`. Path resolution
//! honours the env vars documented on [`env::DeploymentRoots`].
//!
//! The runtime client at [`client::PerpsOnchain`] wraps an alloy `Provider`
//! plus a local signer (from `PERP_KEEPER_PRIVATE_KEY` or `DEPLOYER_PRIVATE_KEY`)
//! and exposes:
//!
//! - [`client::PerpsOnchain::settle_match`] — calls
//!   `FxOrderSettlement.settleMatch(maker, makerSig, taker, takerSig,
//!   fillSizeE18, fillPriceE18)` and waits for the receipt.
//! - [`client::PerpsOnchain::query_oi`] — reads
//!   `FxPerpClearinghouse.openInterestLong / openInterestShort / maxOpenInterest`
//!   for the defence-in-depth OI gate (Phase 3 decision #3).

#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod bindings;
pub mod client;
pub mod deployment;
pub mod env;
pub mod market_config;
pub mod oracle;

pub use client::{OiSnapshot, PerpsOnchain, PerpsOnchainError};
pub use deployment::{PerpsContracts, PerpsDeployment};
pub use market_config::{MarketConfig, MarketConfigSet};
pub use oracle::{resolve_pyth_address, OracleSnapshot};
