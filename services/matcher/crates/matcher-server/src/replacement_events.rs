//! `bufx.perps.replacement_needed` event writer.
//!
//! When a fill partials an intent (residual `> 0` and not fully filled), the
//! API needs to know so it can prompt the trader to sign a replacement
//! order for the remainder. Mirrors the TS implementation byte-for-byte —
//! see `packages/perps/src/replacement-events.ts` in defi-web-app.
//!
//! The event lands in the `domain_events` table the TS workflow layer
//! already polls.

use sqlx::SqliteConnection;

use bufi_perps_db::{PerpIntent, PerpIntentStatus, PerpsDb};

/// Event type literal (matches `PERPS_REPLACEMENT_NEEDED_EVENT` in TS).
pub const EVENT_TYPE: &str = "bufx.perps.replacement_needed";

/// MCP tool name surfaced in the payload so the API can deep-link to the
/// replacement flow (matches `PERPS_REPLACEMENT_MCP_TOOL`).
pub const MCP_TOOL_NAME: &str = "bufx.intent.perp.replace";

/// Maker vs taker role of the partially-filled intent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// Maker (resting side of the cross).
    Maker,
    /// Taker (incoming side).
    Taker,
}

impl Role {
    fn as_str(self) -> &'static str {
        match self {
            Role::Maker => "maker",
            Role::Taker => "taker",
        }
    }
}

/// Inputs to a replacement-needed event.
#[derive(Debug, Clone)]
pub struct ReplacementEvent<'a> {
    /// The DB row post-fill (carries the new filled/remaining values).
    pub intent: &'a PerpIntent,
    /// Hex tx hash of the settlement.
    pub settlement_tx: String,
    /// Which side this intent played in the match.
    pub role: Role,
    /// The other side's intent id.
    pub counterparty_intent_id: String,
    /// Signed fill delta applied to this intent (same sign as `size_delta`).
    pub fill_size_delta: i128,
    /// Fill price in 18-dec WAD.
    pub fill_price_e18: u128,
    /// Unix seconds at emission time. Passed in (the caller owns the clock).
    pub emitted_at_secs: i64,
}

/// Write a replacement-needed row into `domain_events`. Idempotent on the
/// `event_id` (primary-key), so a re-run of the same settlement is safe.
pub async fn emit(db: &PerpsDb, event: ReplacementEvent<'_>) -> Result<(), sqlx::Error> {
    let mut conn = db.pool().acquire().await?;
    emit_with_conn(&mut conn, event).await
}

/// Lower-level variant that takes an existing connection (used from inside
/// a settlement transaction so the write is atomic with `record_fill`).
pub async fn emit_with_conn(
    conn: &mut SqliteConnection,
    event: ReplacementEvent<'_>,
) -> Result<(), sqlx::Error> {
    // Skip non-partial fills entirely — the event is meaningless for them.
    if event.intent.status != PerpIntentStatus::PartiallyFilled {
        return Ok(());
    }

    let event_id = format!(
        "perps-replacement-needed:{}:{}",
        event.settlement_tx, event.intent.intent_id
    );
    let actor = event.intent.trader.to_ascii_lowercase();
    let prepare_path = format!(
        "/perps/intents/{}/replacement/prepare",
        event.intent.intent_id
    );
    let payload = serde_json::json!({
        "intentId": event.intent.intent_id,
        "replacementOf": event.intent.replacement_of,
        "chainId": event.intent.chain_id,
        "trader": event.intent.trader,
        "marketId": event.intent.market_id,
        "side": event.intent.side.as_str(),
        "status": event.intent.status.as_str(),
        "filledSizeDelta": event.intent.filled_size_delta,
        "remainingSizeDelta": event.intent.remaining_size_delta,
        "role": event.role.as_str(),
        "counterpartyIntentId": event.counterparty_intent_id,
        "fillSizeDelta": event.fill_size_delta.to_string(),
        "fillPriceE18": event.fill_price_e18.to_string(),
        "settlementTx": event.settlement_tx,
        "prepareApiPath": prepare_path,
        "mcpToolName": MCP_TOOL_NAME,
    });
    let payload_json = serde_json::to_string(&payload).unwrap();

    sqlx::query(
        r#"
        insert or ignore into domain_events
          (event_id, type, aggregate_id, actor, created_at, payload_json)
        values (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
    )
    .bind(&event_id)
    .bind(EVENT_TYPE)
    .bind(&event.intent.intent_id)
    .bind(&actor)
    .bind(event.emitted_at_secs)
    .bind(&payload_json)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use bufi_perps_db::{PerpOrderType, PerpSide};

    fn sample_intent(id: &str, side: PerpSide) -> PerpIntent {
        PerpIntent {
            intent_id: id.into(),
            replacement_of: None,
            chain_id: 5_042_002,
            trader: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".into(),
            market_id: format!("0x{}", "11".repeat(32)),
            side,
            size_usdc: "1000000".into(),
            size_delta: "10".into(),
            filled_size_delta: "3".into(),
            remaining_size_delta: "7".into(),
            leverage: 1,
            order_type: PerpOrderType::Limit,
            price_e18: "1000000000000000000".into(),
            limit_price: None,
            reduce_only: false,
            post_only: false,
            flags: 0,
            digest: format!("0x{}", "ab".repeat(32)),
            signature: format!("0x{}", "cd".repeat(65)),
            nonce: "1".into(),
            deadline: 1_700_000_000,
            status: PerpIntentStatus::PartiallyFilled,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
        }
    }

    #[tokio::test]
    async fn emits_partial_event_into_domain_events() {
        let db = PerpsDb::open_in_memory().await.expect("open");
        let intent = sample_intent("0x01", PerpSide::Long);
        // Insert a row so the FK + indexes are populated; not strictly
        // required for domain_events but mirrors real usage.
        db.put(&intent).await.unwrap();
        emit(
            &db,
            ReplacementEvent {
                intent: &intent,
                settlement_tx: "0xdeadbeef".into(),
                role: Role::Maker,
                counterparty_intent_id: "0x02".into(),
                fill_size_delta: 3,
                fill_price_e18: 1_000_000_000_000_000_000,
                emitted_at_secs: 1_700_000_001,
            },
        )
        .await
        .unwrap();

        let count: (i64,) = sqlx::query_as("select count(*) from domain_events")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(count.0, 1);

        let actor: (String,) =
            sqlx::query_as("select actor from domain_events where type = ?1")
                .bind(EVENT_TYPE)
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(actor.0, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    }

    #[tokio::test]
    async fn skips_non_partial_intents() {
        let db = PerpsDb::open_in_memory().await.expect("open");
        let mut intent = sample_intent("0x01", PerpSide::Long);
        intent.status = PerpIntentStatus::Filled;
        db.put(&intent).await.unwrap();
        emit(
            &db,
            ReplacementEvent {
                intent: &intent,
                settlement_tx: "0xdeadbeef".into(),
                role: Role::Maker,
                counterparty_intent_id: "0x02".into(),
                fill_size_delta: 10,
                fill_price_e18: 1_000_000_000_000_000_000,
                emitted_at_secs: 1_700_000_001,
            },
        )
        .await
        .unwrap();

        let count: (i64,) = sqlx::query_as("select count(*) from domain_events")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(count.0, 0);
    }

    #[tokio::test]
    async fn double_emit_is_idempotent() {
        let db = PerpsDb::open_in_memory().await.expect("open");
        let intent = sample_intent("0x01", PerpSide::Long);
        db.put(&intent).await.unwrap();
        let ev = ReplacementEvent {
            intent: &intent,
            settlement_tx: "0xdeadbeef".into(),
            role: Role::Maker,
            counterparty_intent_id: "0x02".into(),
            fill_size_delta: 3,
            fill_price_e18: 1_000_000_000_000_000_000,
            emitted_at_secs: 1_700_000_001,
        };
        emit(&db, ev.clone()).await.unwrap();
        emit(&db, ev).await.unwrap();

        let count: (i64,) = sqlx::query_as("select count(*) from domain_events")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(count.0, 1);
    }
}
