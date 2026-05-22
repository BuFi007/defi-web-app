//! Loader tests against canonical fixtures captured from
//! `fx-telarana/deployments/perps-{config-,}5042002.json`.

use bufi_perps_onchain::{MarketConfigSet, PerpsDeployment};

const ARC_CHAIN_ID: u64 = 5_042_002;

fn write_temp(name: &str, contents: &str) -> std::path::PathBuf {
    let mut path = std::env::temp_dir();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    path.push(format!("bufi-perps-onchain-test-{stamp}-{name}"));
    std::fs::write(&path, contents).expect("write fixture");
    path
}

// Sprint-1 manifest (post-PR #38 broadcast). Mirrors
// fx-telarana/deployments/perp-stack-5042002.json at HEAD c0ff0d3.
const ARC_PERP_STACK_JSON: &str = r#"{
  "FxFundingEngine": "0x859bA11A3693895f8B03C31C6AE3b8F04992115B",
  "FxHealthChecker": "0xA00Be167609c02F3879138dA8530BC31527c02b8",
  "FxLiquidationEngine": "0xF579e265EF1D5E67EfDbb1F20863465E94a9d3eA",
  "FxMarginAccount": "0x4EB6018F988301417B93cb2b8899D74D42273e96",
  "FxOrderSettlement": "0x93C3d831D6F0657479d7Fb6Cf0D06e75aA05E4CC",
  "FxPerpClearinghouse": "0x39dc43E2133CF860c1d17d4DB75Ef4204eebD46A",
  "chainId": 5042002,
  "deployer": "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  "keeper": "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  "liquidation_bountyBps": 500,
  "liquidation_bountyCap": 5000000,
  "liquidation_flagDelay": 120
}"#;

// Legacy manifest used to test the fallback path; same shape minus the
// liquidation_* fields.
const ARC_PERPS_LEGACY_JSON: &str = r#"{
  "FxFundingEngine": "0x88B70872759E1aA24858746779Cb15ca9F2cdcf3",
  "FxHealthChecker": "0x272305e821D810eC5741761F98DbDC273efD47E6",
  "FxLiquidationEngine": "0xD384560E5f8CE969BF4C1BDfAFACc5304AFbe8f2",
  "FxMarginAccount": "0x35c7cD02cFa0c2889547482B71c1a5114d8439C6",
  "FxOrderSettlement": "0x0F62FCdA2de63d905Cb167301C00251A9bB6dAa1",
  "FxPerpClearinghouse": "0x6A265045D9A3291D2881d77DDC62e2781A2418c5",
  "chainId": 5042002,
  "deployer": "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69",
  "keeper": "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69"
}"#;

#[test]
fn deployment_parses_sprint1_arc_manifest() {
    let path = write_temp(&format!("perp-stack-{ARC_CHAIN_ID}.json"), ARC_PERP_STACK_JSON);
    let d = PerpsDeployment::load_from_file(&path).expect("load");
    assert_eq!(d.chain_id, ARC_CHAIN_ID);
    assert_eq!(
        format!("{:#x}", d.contracts.fx_order_settlement).to_lowercase(),
        "0x93c3d831d6f0657479d7fb6cf0d06e75aa05e4cc"
    );
    assert_eq!(
        format!("{:#x}", d.contracts.fx_perp_clearinghouse).to_lowercase(),
        "0x39dc43e2133cf860c1d17d4db75ef4204eebd46a"
    );
    assert_eq!(d.liquidation.bounty_bps, 500);
    assert_eq!(d.liquidation.bounty_cap, 5_000_000);
    assert_eq!(d.liquidation.flag_delay_secs, 120);
}

#[test]
fn deployment_loader_prefers_perp_stack_over_legacy() {
    let dir = std::env::temp_dir().join(format!(
        "bufi-perps-onchain-prefer-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    // Both files present; loader MUST pick perp-stack.
    std::fs::write(dir.join("perp-stack-5042002.json"), ARC_PERP_STACK_JSON).unwrap();
    std::fs::write(dir.join("perps-5042002.json"), ARC_PERPS_LEGACY_JSON).unwrap();
    let d = PerpsDeployment::load_from_dir(&dir, ARC_CHAIN_ID).expect("load");
    assert_eq!(
        format!("{:#x}", d.contracts.fx_order_settlement).to_lowercase(),
        "0x93c3d831d6f0657479d7fb6cf0d06e75aa05e4cc"
    );
}

#[test]
fn deployment_loader_falls_back_to_legacy_when_perp_stack_missing() {
    let dir = std::env::temp_dir().join(format!(
        "bufi-perps-onchain-legacy-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("perps-5042002.json"), ARC_PERPS_LEGACY_JSON).unwrap();
    let d = PerpsDeployment::load_from_dir(&dir, ARC_CHAIN_ID).expect("load");
    // Legacy manifests don't carry liquidation params — they zero-default.
    assert_eq!(d.liquidation.bounty_bps, 0);
    assert_eq!(d.liquidation.bounty_cap, 0);
    assert_eq!(d.liquidation.flag_delay_secs, 0);
}

// Mirrors fx-telarana/deployments/perps-config-5042002.json at HEAD c0ff0d3.
// 4 markets: EURC + CIRBTC + TJPYC + TMXNB. TCHFC stays in the JSON but is
// "unlisted on-chain" per the handoff doc, so any production list-of-markets
// view should filter on `enabled` AND check the matching marketConfig
// returned by FxPerpClearinghouse.marketConfig() at boot.
const ARC_PERPS_CONFIG_JSON: &str = r#"{
  "CIRBTC_USDC_baseToken": "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
  "CIRBTC_USDC_enabled": true,
  "CIRBTC_USDC_fundingEnabled": true,
  "CIRBTC_USDC_fundingVelocityBps": 1,
  "CIRBTC_USDC_initialMarginBps": 500,
  "CIRBTC_USDC_maintenanceMarginBps": 300,
  "CIRBTC_USDC_marketId": "0x238aacf17c8d170ad55905cd1c217ae2db8338354b1235059fb0f096e20b777a",
  "CIRBTC_USDC_maxFundingRateBpsPerSecond": 1,
  "CIRBTC_USDC_maxLeverageBps": 200000,
  "CIRBTC_USDC_maxOpenInterestUsd": 250000000,
  "CIRBTC_USDC_maxSkewUsd": 250000000,
  "CIRBTC_USDC_openInterestLong": 0,
  "CIRBTC_USDC_openInterestShort": 0,
  "CIRBTC_USDC_tradingFeeBps": 5,
  "EURC_USDC_baseToken": "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  "EURC_USDC_enabled": true,
  "EURC_USDC_fundingEnabled": true,
  "EURC_USDC_fundingVelocityBps": 1,
  "EURC_USDC_initialMarginBps": 500,
  "EURC_USDC_maintenanceMarginBps": 300,
  "EURC_USDC_marketId": "0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8",
  "EURC_USDC_maxFundingRateBpsPerSecond": 1,
  "EURC_USDC_maxLeverageBps": 200000,
  "EURC_USDC_maxOpenInterestUsd": 1000000000,
  "EURC_USDC_maxSkewUsd": 1000000000,
  "EURC_USDC_openInterestLong": 11616,
  "EURC_USDC_openInterestShort": 592446,
  "EURC_USDC_tradingFeeBps": 5,
  "TJPYC_USDC_baseToken": "0x44cEe9E472C34b2f0d9710CD8aBd02dadb912761",
  "TJPYC_USDC_enabled": true,
  "TJPYC_USDC_fundingEnabled": true,
  "TJPYC_USDC_fundingVelocityBps": 1,
  "TJPYC_USDC_initialMarginBps": 500,
  "TJPYC_USDC_maintenanceMarginBps": 300,
  "TJPYC_USDC_marketId": "0x9ccad283db415085bf69329b696bfc7a34bff2d476f5cf7b1d4a3ba9bc0b70ab",
  "TJPYC_USDC_maxFundingRateBpsPerSecond": 1,
  "TJPYC_USDC_maxLeverageBps": 200000,
  "TJPYC_USDC_maxOpenInterestUsd": 250000000,
  "TJPYC_USDC_maxSkewUsd": 250000000,
  "TJPYC_USDC_openInterestLong": 0,
  "TJPYC_USDC_openInterestShort": 0,
  "TJPYC_USDC_tradingFeeBps": 5,
  "TMXNB_USDC_baseToken": "0x836F73Fbc370A9329Ba4957E47912DfDBA6BA461",
  "TMXNB_USDC_enabled": true,
  "TMXNB_USDC_fundingEnabled": true,
  "TMXNB_USDC_fundingVelocityBps": 1,
  "TMXNB_USDC_initialMarginBps": 500,
  "TMXNB_USDC_maintenanceMarginBps": 300,
  "TMXNB_USDC_marketId": "0xb698dfdbcbae088741081a53b9f1da11df8ff7c92c9278b66e15a34077ea5ca3",
  "TMXNB_USDC_maxFundingRateBpsPerSecond": 1,
  "TMXNB_USDC_maxLeverageBps": 200000,
  "TMXNB_USDC_maxOpenInterestUsd": 250000000,
  "TMXNB_USDC_maxSkewUsd": 250000000,
  "TMXNB_USDC_openInterestLong": 0,
  "TMXNB_USDC_openInterestShort": 0,
  "TMXNB_USDC_tradingFeeBps": 5,
  "FxOrderSettlement": "0x93C3d831D6F0657479d7Fb6Cf0D06e75aA05E4CC",
  "FxPerpClearinghouse": "0x39dc43E2133CF860c1d17d4DB75Ef4204eebD46A"
}"#;

#[test]
fn market_config_groups_by_symbol() {
    let path = write_temp(
        &format!("perps-config-{ARC_CHAIN_ID}.json"),
        ARC_PERPS_CONFIG_JSON,
    );
    let set = MarketConfigSet::load_from_file(&path).expect("load");
    let symbols: Vec<&str> = set.markets.keys().map(String::as_str).collect();
    assert_eq!(
        symbols,
        vec!["CIRBTC_USDC", "EURC_USDC", "TJPYC_USDC", "TMXNB_USDC"]
    );
}

#[test]
fn market_config_carries_id_and_caps() {
    let path = write_temp(
        &format!("perps-config-{ARC_CHAIN_ID}.json"),
        ARC_PERPS_CONFIG_JSON,
    );
    let set = MarketConfigSet::load_from_file(&path).expect("load");
    let eurc = set.markets.get("EURC_USDC").expect("eurc");
    assert_eq!(
        format!("{:#x}", eurc.market_id).to_lowercase(),
        "0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8"
    );
    assert_eq!(eurc.max_leverage_bps, 200_000);
    assert_eq!(eurc.trading_fee_bps, 5);
    assert!(eurc.enabled);
    // 1_000_000_000 fits in u64 — confirm the U256 round-trip survives.
    assert_eq!(
        eurc.max_open_interest_usd,
        alloy_primitives::U256::from(1_000_000_000u64)
    );
}

#[test]
fn market_config_lookup_by_market_id() {
    let path = write_temp(
        &format!("perps-config-{ARC_CHAIN_ID}.json"),
        ARC_PERPS_CONFIG_JSON,
    );
    let set = MarketConfigSet::load_from_file(&path).expect("load");
    let target: alloy_primitives::B256 =
        "0x238aacf17c8d170ad55905cd1c217ae2db8338354b1235059fb0f096e20b777a"
            .parse()
            .unwrap();
    let cirbtc = set.by_market_id(&target).expect("found");
    assert_eq!(cirbtc.symbol, "CIRBTC_USDC");
}

// Use a unique chain id (99999) for the override test so it doesn't race
// with the other tests via CONTRACT_ADDRESSES_JSON — cargo test runs in
// parallel by default.
#[test]
fn override_env_replaces_addresses() {
    let custom_manifest =
        ARC_PERP_STACK_JSON.replace("\"chainId\": 5042002", "\"chainId\": 99999");
    let path = write_temp("perp-stack-99999.json", &custom_manifest);
    let override_json = r#"{
        "99999": {
            "perps": {
                "orderSettlement": "0x1111111111111111111111111111111111111111"
            }
        }
    }"#;
    let _guard = EnvVarGuard::set("CONTRACT_ADDRESSES_JSON", override_json);
    let d = PerpsDeployment::load_from_file(&path).expect("load");
    assert_eq!(
        format!("{:#x}", d.contracts.fx_order_settlement).to_lowercase(),
        "0x1111111111111111111111111111111111111111"
    );
}

/// Scope-guarded env var, restored on drop.
struct EnvVarGuard {
    key: &'static str,
    prev: Option<String>,
}

impl EnvVarGuard {
    fn set(key: &'static str, value: &str) -> Self {
        let prev = std::env::var(key).ok();
        // SAFETY: set_var is unsafe in 2024 edition (thread-safety concern);
        // tests within one crate run in their own process so it's OK here.
        std::env::set_var(key, value);
        Self { key, prev }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match &self.prev {
            Some(v) => std::env::set_var(self.key, v),
            None => std::env::remove_var(self.key),
        }
    }
}
