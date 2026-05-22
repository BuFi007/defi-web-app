//! Integration tests against an in-memory SQLite, covering the same
//! contract the TS `sqlite.test.ts` asserts on `@bufi/db`.

use bufi_perps_db::{PerpIntent, PerpIntentStatus, PerpOrderType, PerpSide, PerpsDb, PerpsDbError};

const ARC_CHAIN_ID: i64 = 5_042_002;
const NOW: i64 = 1_700_000_000;

fn sample_intent(intent_id: &str, side: PerpSide, size_delta_e18: &str, nonce: u64) -> PerpIntent {
    PerpIntent {
        intent_id: intent_id.into(),
        replacement_of: None,
        chain_id: ARC_CHAIN_ID,
        trader: "0x000000000000000000000000000000000000beef".into(),
        market_id: format!("0x{}", "11".repeat(32)),
        side,
        size_usdc: "1000000".into(),
        size_delta: size_delta_e18.into(),
        filled_size_delta: "0".into(),
        remaining_size_delta: size_delta_e18.into(),
        leverage: 1,
        order_type: PerpOrderType::Limit,
        price_e18: "1000000000000000000".into(),
        limit_price: None,
        reduce_only: false,
        post_only: false,
        flags: 0,
        digest: format!("0x{}", "ab".repeat(32)),
        signature: format!("0x{}", "cd".repeat(65)),
        nonce: nonce.to_string(),
        deadline: NOW + 3_600,
        status: PerpIntentStatus::Pending,
        created_at: NOW,
        updated_at: NOW,
    }
}

#[tokio::test]
async fn put_then_get_roundtrips() {
    let db = PerpsDb::open_in_memory().await.expect("open");
    let intent = sample_intent("0x01", PerpSide::Long, "5000000000000000000", 1);
    db.put(&intent).await.expect("put");
    let fetched = db.get("0x01").await.expect("get").expect("present");
    assert_eq!(fetched, intent);
}

#[tokio::test]
async fn list_pending_filters_by_chain_status_and_deadline() {
    let db = PerpsDb::open_in_memory().await.expect("open");

    // Pending on Arc — expected to surface.
    db.put(&sample_intent("0xA", PerpSide::Long, "1", 1))
        .await
        .unwrap();

    // Pending on a different chain — filtered out.
    let mut other_chain = sample_intent("0xB", PerpSide::Long, "1", 2);
    other_chain.chain_id = 43_113;
    db.put(&other_chain).await.unwrap();

    // Filled on Arc — filtered by status.
    let mut filled = sample_intent("0xC", PerpSide::Long, "1", 3);
    filled.status = PerpIntentStatus::Filled;
    db.put(&filled).await.unwrap();

    // Expired on Arc — filtered by deadline.
    let mut expired = sample_intent("0xD", PerpSide::Long, "1", 4);
    expired.deadline = NOW - 1;
    db.put(&expired).await.unwrap();

    let rows = db.list_pending(ARC_CHAIN_ID, NOW).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].intent_id, "0xA");
}

#[tokio::test]
async fn list_pending_orders_by_created_at_ascending() {
    let db = PerpsDb::open_in_memory().await.expect("open");
    let mut first = sample_intent("0x01", PerpSide::Long, "1", 1);
    first.created_at = NOW;
    let mut second = sample_intent("0x02", PerpSide::Long, "1", 2);
    second.created_at = NOW + 1;
    let mut third = sample_intent("0x03", PerpSide::Long, "1", 3);
    third.created_at = NOW + 2;
    // Insert out of order — store should still return FIFO by created_at.
    db.put(&third).await.unwrap();
    db.put(&first).await.unwrap();
    db.put(&second).await.unwrap();
    let rows = db.list_pending(ARC_CHAIN_ID, NOW - 1).await.unwrap();
    let ids: Vec<&str> = rows.iter().map(|r| r.intent_id.as_str()).collect();
    assert_eq!(ids, vec!["0x01", "0x02", "0x03"]);
}

#[tokio::test]
async fn update_status_bumps_updated_at() {
    let db = PerpsDb::open_in_memory().await.expect("open");
    db.put(&sample_intent("0x01", PerpSide::Long, "1", 1))
        .await
        .unwrap();
    let updated = db
        .update_status("0x01", PerpIntentStatus::Expired, NOW + 10)
        .await
        .unwrap();
    assert_eq!(updated.status, PerpIntentStatus::Expired);
    assert_eq!(updated.updated_at, NOW + 10);
}

#[tokio::test]
async fn update_status_on_missing_intent_errors() {
    let db = PerpsDb::open_in_memory().await.expect("open");
    let err = db
        .update_status("0xZZ", PerpIntentStatus::Filled, NOW)
        .await
        .unwrap_err();
    assert!(matches!(err, PerpsDbError::NotFound(_)));
}

#[tokio::test]
async fn record_fill_marks_partial_then_filled_for_long() {
    let db = PerpsDb::open_in_memory().await.expect("open");
    db.put(&sample_intent("0x01", PerpSide::Long, "10", 1))
        .await
        .unwrap();

    let after_partial = db.record_fill("0x01", 3, NOW + 1).await.unwrap();
    assert_eq!(after_partial.status, PerpIntentStatus::PartiallyFilled);
    assert_eq!(after_partial.filled_size_delta, "3");
    assert_eq!(after_partial.remaining_size_delta, "7");

    let after_full = db.record_fill("0x01", 7, NOW + 2).await.unwrap();
    assert_eq!(after_full.status, PerpIntentStatus::Filled);
    assert_eq!(after_full.filled_size_delta, "10");
    assert_eq!(after_full.remaining_size_delta, "0");
}

#[tokio::test]
async fn record_fill_handles_short_side_with_negative_deltas() {
    let db = PerpsDb::open_in_memory().await.expect("open");
    db.put(&sample_intent("0x02", PerpSide::Short, "-10", 1))
        .await
        .unwrap();
    let after_partial = db.record_fill("0x02", -4, NOW + 1).await.unwrap();
    assert_eq!(after_partial.status, PerpIntentStatus::PartiallyFilled);
    assert_eq!(after_partial.filled_size_delta, "-4");
    assert_eq!(after_partial.remaining_size_delta, "-6");
}

#[tokio::test]
async fn record_fill_rejects_zero_fill() {
    let db = PerpsDb::open_in_memory().await.expect("open");
    db.put(&sample_intent("0x01", PerpSide::Long, "10", 1))
        .await
        .unwrap();
    let err = db.record_fill("0x01", 0, NOW).await.unwrap_err();
    assert!(matches!(err, PerpsDbError::InvalidFill { .. }));
}

#[tokio::test]
async fn record_fill_rejects_wrong_sign() {
    let db = PerpsDb::open_in_memory().await.expect("open");
    db.put(&sample_intent("0x01", PerpSide::Long, "10", 1))
        .await
        .unwrap();
    let err = db.record_fill("0x01", -1, NOW).await.unwrap_err();
    match err {
        PerpsDbError::InvalidFill { reason, .. } => assert!(reason.contains("sign")),
        other => panic!("unexpected: {other:?}"),
    }
}

#[tokio::test]
async fn record_fill_rejects_overfill() {
    let db = PerpsDb::open_in_memory().await.expect("open");
    db.put(&sample_intent("0x01", PerpSide::Long, "10", 1))
        .await
        .unwrap();
    let err = db.record_fill("0x01", 11, NOW).await.unwrap_err();
    match err {
        PerpsDbError::InvalidFill { reason, .. } => assert!(reason.contains("exceeds")),
        other => panic!("unexpected: {other:?}"),
    }
}

#[tokio::test]
async fn put_is_upsert_on_intent_id() {
    let db = PerpsDb::open_in_memory().await.expect("open");
    let mut intent = sample_intent("0x01", PerpSide::Long, "10", 1);
    db.put(&intent).await.unwrap();
    intent.status = PerpIntentStatus::PartiallyFilled;
    intent.filled_size_delta = "4".into();
    intent.remaining_size_delta = "6".into();
    db.put(&intent).await.unwrap();
    let fetched = db.get("0x01").await.unwrap().unwrap();
    assert_eq!(fetched.status, PerpIntentStatus::PartiallyFilled);
    assert_eq!(fetched.filled_size_delta, "4");
}
