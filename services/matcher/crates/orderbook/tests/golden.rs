//! Golden replay test.
//!
//! Each `.json` fixture under `tests/golden/` describes an initial book,
//! a sequence of `submit`/`cancel` steps, and the expected outputs. The
//! test replays them through the matcher and diffs against the expected
//! `MatchOutcome` / `CancelOutcome`.
//!
//! Update goldens by running:
//!
//!   UPDATE_GOLDENS=1 cargo test -p bufi-orderbook --test golden
//!
//! and reviewing the diff carefully before committing — these are the
//! audit-grade replay corpus.

use std::fs;
use std::path::{Path, PathBuf};

use bufi_orderbook::{
    cancel_intent, match_intent, CancelOutcome, Intent, IntentId, MatchOutcome, Order, OrderBook,
};
use serde::{Deserialize, Serialize};

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

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum StepResult {
    Match(MatchOutcome),
    Cancel(CancelOutcome),
}

fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden")
}

fn list_fixtures() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for entry in fs::read_dir(golden_dir()).expect("read tests/golden") {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            out.push(path);
        }
    }
    out.sort();
    out
}

fn parse_market_id(s: &str) -> [u8; 32] {
    let stripped = s.strip_prefix("0x").unwrap_or(s);
    let bytes = (0..stripped.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&stripped[i..i + 2], 16).expect("hex byte"))
        .collect::<Vec<_>>();
    assert_eq!(bytes.len(), 32, "market_id must be 32 bytes");
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    out
}

fn run_fixture(path: &Path) {
    let raw = fs::read_to_string(path).expect("read fixture");
    let fixture: Fixture = serde_json::from_str(&raw).expect("parse fixture");
    let market_id = parse_market_id(&fixture.market_id);

    let mut book = OrderBook::new(market_id);
    for order in &fixture.initial_orders {
        book.insert(order.clone());
    }

    let mut actuals: Vec<StepResult> = Vec::with_capacity(fixture.steps.len());
    for step in &fixture.steps {
        match step {
            Step::Submit {
                intent,
                now_ms,
                match_seq,
            } => {
                let outcome = match_intent(&mut book, (**intent).clone(), *now_ms, *match_seq);
                actuals.push(StepResult::Match(outcome));
            }
            Step::Cancel { intent_id } => {
                let outcome = cancel_intent(&mut book, *intent_id);
                actuals.push(StepResult::Cancel(outcome));
            }
        }
    }

    if std::env::var("UPDATE_GOLDENS").is_ok() {
        let updated = Fixture {
            description: fixture.description.clone(),
            market_id: fixture.market_id.clone(),
            initial_orders: fixture.initial_orders.clone(),
            steps: fixture.steps,
            expected: actuals,
        };
        let pretty = serde_json::to_string_pretty(&updated).expect("serialize fixture");
        fs::write(path, pretty + "\n").expect("write fixture");
        return;
    }

    assert_eq!(
        actuals.len(),
        fixture.expected.len(),
        "fixture {}: step count mismatch",
        path.display()
    );
    for (i, (actual, expected)) in actuals.iter().zip(fixture.expected.iter()).enumerate() {
        assert_eq!(
            actual,
            expected,
            "fixture {} step {}: actual != expected\nactual: {}\nexpected: {}",
            path.display(),
            i,
            serde_json::to_string_pretty(actual).unwrap(),
            serde_json::to_string_pretty(expected).unwrap(),
        );
    }
}

#[test]
fn all_goldens_pass() {
    let fixtures = list_fixtures();
    assert!(!fixtures.is_empty(), "no goldens found in tests/golden");
    for path in fixtures {
        run_fixture(&path);
    }
}

// Tiny inline helper to (de)serialise a [u8; 32] as hex in JSON, since
// the default serde derive emits a 32-element array which is ugly.
mod hex_array_32 {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &[u8; 32], s: S) -> Result<S::Ok, S::Error> {
        let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        s.serialize_str(&format!("0x{hex}"))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u8; 32], D::Error> {
        let s: String = String::deserialize(d)?;
        let stripped = s.strip_prefix("0x").unwrap_or(&s);
        let mut out = [0u8; 32];
        for (i, chunk) in stripped.as_bytes().chunks(2).enumerate() {
            let hex = std::str::from_utf8(chunk).map_err(serde::de::Error::custom)?;
            out[i] = u8::from_str_radix(hex, 16).map_err(serde::de::Error::custom)?;
        }
        Ok(out)
    }
}
