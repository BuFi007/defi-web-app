//! Live RPC integration test against Arc Testnet.
//!
//! `#[ignore]`d by default so `cargo test` stays hermetic. Opt in with:
//!
//! ```bash
//! cd services/matcher
//! export ARC_RPC_URL=https://rpc.drpc.testnet.arc.network
//! export PERP_KEEPER_PRIVATE_KEY=0x<32 bytes hex>
//! export FX_TELARANA_DEPLOYMENTS=/abs/path/to/fx-telarana/deployments
//! cargo test -p bufi-matcher-server --test live_arc_testnet -- --ignored --nocapture
//! ```
//!
//! Validates the wire format end-to-end: loads the deployment manifest,
//! builds `PerpsOnchain`, reads the EURC/USDC perp's OI snapshot off-chain,
//! and asserts the cap is non-zero (i.e. the market is configured).

use bufi_perps_onchain::env::ARC_CHAIN_ID;
use bufi_perps_onchain::{PerpsDeployment, PerpsOnchain};

const EURC_USDC_PERP: &str =
    "0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8";

#[tokio::test]
#[ignore = "needs ARC_RPC_URL + PERP_KEEPER_PRIVATE_KEY + FX_TELARANA_DEPLOYMENTS"]
async fn query_oi_against_live_arc_testnet() {
    let onchain = PerpsOnchain::from_env_for_chain(ARC_CHAIN_ID)
        .expect("from_env_for_chain — set the three env vars in the test docstring");
    let market_id = EURC_USDC_PERP.parse().expect("EURC market id parses");
    let snapshot = onchain
        .query_oi(market_id)
        .await
        .expect("query_oi against Arc Testnet");
    println!(
        "EURC/USDC OI snapshot: long={} short={} cap={}",
        snapshot.long, snapshot.short, snapshot.cap
    );
    assert!(
        snapshot.cap > alloy_primitives::U256::ZERO,
        "EURC/USDC perp market has zero OI cap — is the deployment manifest stale?"
    );
}

#[tokio::test]
#[ignore = "needs FX_TELARANA_DEPLOYMENTS pointed at the sprint-1 manifest"]
async fn deployment_loads_arc_sprint1_addresses() {
    let deployment = PerpsDeployment::load_from_env(ARC_CHAIN_ID)
        .expect("load_from_env — set FX_TELARANA_DEPLOYMENTS");
    assert_eq!(deployment.chain_id, ARC_CHAIN_ID);
    // Sprint-1 broadcast addresses (handoff doc, fx-telarana c0ff0d3).
    let expected_settlement =
        "0x93C3d831D6F0657479d7Fb6Cf0D06e75aA05E4CC".to_ascii_lowercase();
    let expected_clearinghouse =
        "0x39dc43E2133CF860c1d17d4DB75Ef4204eebD46A".to_ascii_lowercase();
    assert_eq!(
        format!("{:#x}", deployment.contracts.fx_order_settlement),
        expected_settlement
    );
    assert_eq!(
        format!("{:#x}", deployment.contracts.fx_perp_clearinghouse),
        expected_clearinghouse
    );
    assert_eq!(deployment.liquidation.bounty_bps, 500);
    assert_eq!(deployment.liquidation.flag_delay_secs, 120);
}
