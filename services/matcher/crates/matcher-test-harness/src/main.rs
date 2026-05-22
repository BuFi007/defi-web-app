// `1 * ONE_E18` is the "one unit" idiom in fixture builders.
#![allow(clippy::identity_op)]

//! Replay tool for orderbook goldens.
//!
//! Subcommands:
//!   - `replay <path>` — replay a single fixture, print outcomes as JSON.
//!   - `replay-all <dir>` — replay every `*.json` in a directory.
//!   - `seed` — write the 5 canonical Phase-2 fixtures into the orderbook
//!     crate's `tests/golden/` directory.
//!
//! The matcher's `cargo test` already runs every fixture as an assertion
//! (see `crates/orderbook/tests/golden.rs`). This binary exists so a human
//! can replay any fixture in isolation, and so the fixture corpus has a
//! single source-of-truth generator.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use bufi_orderbook::{
    cancel_intent, match_intent, CancelOutcome, Intent, IntentId, MatchOutcome, Order, OrderBook,
    OrderType, Price, Side, Size, TimeInForce,
};
use serde::{Deserialize, Serialize};

const ONE_E18: i128 = 1_000_000_000_000_000_000;
const TEST_MARKET: [u8; 32] = [0xAA; 32];
const TEST_MARKET_HEX: &str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    match args.get(1).map(|s| s.as_str()) {
        Some("seed") => seed(),
        Some("replay") => match args.get(2) {
            Some(path) => replay_one(Path::new(path)),
            None => usage(),
        },
        Some("replay-all") => match args.get(2) {
            Some(dir) => replay_all(Path::new(dir)),
            None => usage(),
        },
        _ => usage(),
    }
}

fn usage() -> ExitCode {
    eprintln!("usage: bufi-matcher-replay <seed|replay <fixture.json>|replay-all <dir>>");
    ExitCode::FAILURE
}

// ---------------------------------------------------------------------------
// Fixture format — keep in sync with crates/orderbook/tests/golden.rs.
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct Fixture {
    description: String,
    market_id: String,
    #[serde(default)]
    initial_orders: Vec<Order>,
    steps: Vec<Step>,
    expected: Vec<StepResult>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Step {
    Submit {
        intent: Box<Intent>,
        now_ms: u64,
        match_seq: u64,
    },
    Cancel {
        #[serde(with = "hex_array_32")]
        intent_id: IntentId,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum StepResult {
    Match(MatchOutcome),
    Cancel(CancelOutcome),
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

fn replay_one(path: &Path) -> ExitCode {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("read {}: {e}", path.display());
            return ExitCode::FAILURE;
        }
    };
    let fixture: Fixture = match serde_json::from_str(&raw) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("parse {}: {e}", path.display());
            return ExitCode::FAILURE;
        }
    };
    let market_id = parse_market_id(&fixture.market_id);
    let mut book = OrderBook::new(market_id);
    for o in &fixture.initial_orders {
        book.insert(o.clone());
    }
    let mut outcomes: Vec<StepResult> = Vec::new();
    for step in &fixture.steps {
        match step {
            Step::Submit {
                intent,
                now_ms,
                match_seq,
            } => outcomes.push(StepResult::Match(match_intent(
                &mut book,
                (**intent).clone(),
                *now_ms,
                *match_seq,
            ))),
            Step::Cancel { intent_id } => {
                outcomes.push(StepResult::Cancel(cancel_intent(&mut book, *intent_id)))
            }
        }
    }
    println!("{}", serde_json::to_string_pretty(&outcomes).unwrap());
    ExitCode::SUCCESS
}

fn replay_all(dir: &Path) -> ExitCode {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("read_dir {}: {e}", dir.display());
            return ExitCode::FAILURE;
        }
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("json"))
        .collect();
    paths.sort();
    for path in paths {
        println!("--- {} ---", path.display());
        if matches!(replay_one(&path), ExitCode::FAILURE) {
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}

// ---------------------------------------------------------------------------
// Fixture generation
// ---------------------------------------------------------------------------

fn seed() -> ExitCode {
    let out_dir = locate_golden_dir();
    if let Err(e) = fs::create_dir_all(&out_dir) {
        eprintln!("mkdir {}: {e}", out_dir.display());
        return ExitCode::FAILURE;
    }

    let fixtures = [
        ("simple_cross.json", build_simple_cross()),
        ("partial_fill.json", build_partial_fill()),
        ("multi_level_walk.json", build_multi_level_walk()),
        ("fok_reject.json", build_fok_reject()),
        ("expired_reject.json", build_expired_reject()),
    ];

    for (name, fixture) in fixtures {
        let path = out_dir.join(name);
        let json = serde_json::to_string_pretty(&fixture).unwrap();
        if let Err(e) = fs::write(&path, json + "\n") {
            eprintln!("write {}: {e}", path.display());
            return ExitCode::FAILURE;
        }
        println!("wrote {}", path.display());
    }
    ExitCode::SUCCESS
}

fn locate_golden_dir() -> PathBuf {
    // Run from the workspace root: services/matcher/crates/matcher-test-harness/...
    // Goldens live in services/matcher/crates/orderbook/tests/golden/.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("orderbook/tests/golden")
}

fn parse_market_id(s: &str) -> [u8; 32] {
    let stripped = s.strip_prefix("0x").unwrap_or(s);
    let mut out = [0u8; 32];
    for (i, chunk) in stripped.as_bytes().chunks(2).enumerate() {
        let hex = std::str::from_utf8(chunk).unwrap();
        out[i] = u8::from_str_radix(hex, 16).unwrap();
    }
    out
}

// ----- per-fixture builders -----

const NOW_MS: u64 = 2_000_000_000_000;
const NOW_SECS: u64 = NOW_MS / 1_000;

fn ord(id: u8, trader_seed: u8, side: Side, price_e18: i128, size_e18: u128, inserted: u64) -> Order {
    Order {
        id: [id; 32],
        trader: [trader_seed; 20],
        side,
        price: Price::new(price_e18),
        remaining: Size::new(size_e18),
        flags: 0,
        inserted_at_ms: inserted,
    }
}

fn it(id: u8, trader_seed: u8, side: Side, price_e18: i128, mag_e18: u128, nonce: u64) -> Intent {
    Intent {
        id: [id; 32],
        market_id: TEST_MARKET,
        trader: [trader_seed; 20],
        side,
        magnitude: Size::new(mag_e18),
        price: Price::new(price_e18),
        max_fee: 0,
        order_type: OrderType::Limit,
        flags: 0,
        nonce,
        deadline_secs: NOW_SECS + 3_600,
        tif: TimeInForce::GoodTilCancel,
    }
}

fn expect(book: &mut OrderBook, steps: &[Step]) -> Vec<StepResult> {
    let mut out = Vec::with_capacity(steps.len());
    for s in steps {
        match s {
            Step::Submit {
                intent,
                now_ms,
                match_seq,
            } => out.push(StepResult::Match(match_intent(
                book,
                (**intent).clone(),
                *now_ms,
                *match_seq,
            ))),
            Step::Cancel { intent_id } => {
                out.push(StepResult::Cancel(cancel_intent(book, *intent_id)))
            }
        }
    }
    out
}

fn fixture(description: &str, initial: Vec<Order>, steps: Vec<Step>) -> Fixture {
    let mut book = OrderBook::new(TEST_MARKET);
    for o in &initial {
        book.insert(o.clone());
    }
    let expected = expect(&mut book, &steps);
    Fixture {
        description: description.into(),
        market_id: TEST_MARKET_HEX.into(),
        initial_orders: initial,
        steps,
        expected,
    }
}

fn build_simple_cross() -> Fixture {
    let ask = ord(0x01, 0x10, Side::Short, ONE_E18, 5 * ONE_E18 as u128, 100);
    let taker = it(0x02, 0x20, Side::Long, ONE_E18, 5 * ONE_E18 as u128, 1);
    fixture(
        "single ask, single taker, fully fills at the resting price",
        vec![ask],
        vec![Step::Submit {
            intent: Box::new(taker),
            now_ms: NOW_MS,
            match_seq: 0,
        }],
    )
}

fn build_partial_fill() -> Fixture {
    let ask = ord(0x01, 0x10, Side::Short, ONE_E18, 3 * ONE_E18 as u128, 100);
    let taker = it(0x02, 0x20, Side::Long, ONE_E18, 5 * ONE_E18 as u128, 1);
    fixture(
        "taker > maker; residual rests on the book under GTC",
        vec![ask],
        vec![Step::Submit {
            intent: Box::new(taker),
            now_ms: NOW_MS,
            match_seq: 0,
        }],
    )
}

fn build_multi_level_walk() -> Fixture {
    let asks = vec![
        ord(0x01, 0x10, Side::Short, 2 * ONE_E18, 5 * ONE_E18 as u128, 100),
        ord(0x02, 0x11, Side::Short, 1 * ONE_E18, 3 * ONE_E18 as u128, 200),
    ];
    let taker = it(0x03, 0x20, Side::Long, 3 * ONE_E18, 6 * ONE_E18 as u128, 1);
    fixture(
        "taker walks the cheaper ask first, then partials into the second level",
        asks,
        vec![Step::Submit {
            intent: Box::new(taker),
            now_ms: NOW_MS,
            match_seq: 0,
        }],
    )
}

fn build_fok_reject() -> Fixture {
    let ask = ord(0x01, 0x10, Side::Short, ONE_E18, 1 * ONE_E18 as u128, 100);
    let mut taker = it(0x02, 0x20, Side::Long, ONE_E18, 5 * ONE_E18 as u128, 1);
    taker.tif = TimeInForce::FillOrKill;
    fixture(
        "FOK can't fully fill; rejected with no book mutation",
        vec![ask],
        vec![Step::Submit {
            intent: Box::new(taker),
            now_ms: NOW_MS,
            match_seq: 0,
        }],
    )
}

fn build_expired_reject() -> Fixture {
    let ask = ord(0x01, 0x10, Side::Short, ONE_E18, 5 * ONE_E18 as u128, 100);
    let mut taker = it(0x02, 0x20, Side::Long, ONE_E18, 5 * ONE_E18 as u128, 1);
    taker.deadline_secs = NOW_SECS - 1;
    fixture(
        "intent past deadline_secs; rejected without touching the book",
        vec![ask],
        vec![Step::Submit {
            intent: Box::new(taker),
            now_ms: NOW_MS,
            match_seq: 0,
        }],
    )
}

// ---------------------------------------------------------------------------
// Hex helper for [u8; 32] in Cancel steps.
// ---------------------------------------------------------------------------

mod hex_array_32 {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &[u8; 32], s: S) -> Result<S::Ok, S::Error> {
        let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        s.serialize_str(&format!("0x{hex}"))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u8; 32], D::Error> {
        let s = String::deserialize(d)?;
        let stripped = s.strip_prefix("0x").unwrap_or(&s);
        let mut out = [0u8; 32];
        for (i, chunk) in stripped.as_bytes().chunks(2).enumerate() {
            let hex = std::str::from_utf8(chunk).map_err(serde::de::Error::custom)?;
            out[i] = u8::from_str_radix(hex, 16).map_err(serde::de::Error::custom)?;
        }
        Ok(out)
    }
}
