# BUFI Tinybird workspace

Real-time analytics for the perps clearinghouse. Replaces Subgraph-style
rollups with a columnar event store (ClickHouse under the hood) plus
HTTP-fronted query pipes.

Pillar 7 of the production-perps roadmap — see PR #46 in this repo for
the high-level design context.

## What's in here

```
tinybird/
├── datasources/
│   ├── perp_match_settled.datasource     # one row per MatchSettled
│   ├── perp_position_change.datasource   # one row per PositionIncreased/Decreased
│   ├── perp_funding_poked.datasource     # one row per FundingPoked
│   └── perp_liquidation.datasource       # one row per AccountLiquidated
└── pipes/
    ├── leaderboard_by_pnl.pipe           # top traders by realized PnL
    ├── market_24h_volume.pipe            # 24h volume per market
    ├── ohlcv_by_market.pipe              # OHLCV bars (1m..1d)
    ├── funding_history.pipe              # funding-rate timeseries
    ├── oi_history.pipe                   # long/short open interest timeseries
    └── trade_count_by_trader.pipe        # fills per trader (leaderboard gate)
```

Each `.pipe` becomes an HTTP endpoint at `/v0/pipes/<name>.json` once
deployed.

## Schema conventions

| Column type        | Encoding                                                    |
| ------------------ | ----------------------------------------------------------- |
| `marketId`         | `String` (hex `0x…` bytes32, lowercase)                     |
| Addresses          | `String` (hex `0x…`, lowercase)                             |
| Amounts (USDC)     | `Int64` atomic units (1e6). Clients format.                 |
| Prices             | `Int64` 1e18 fixed-point. Clients divide.                   |
| Sizes              | `Int64` contract-native signed delta                        |
| `timestamp`        | `DateTime64(3)` (millisecond precision)                     |
| `side`             | `LowCardinality(String)` — `long` / `short`                 |
| `deltaKind`        | `LowCardinality(String)` — `increase` / `decrease` / `close` |

Sort key on every timeseries datasource: `(market_id, timestamp)`.
Hot-path queries are per-market rolling-window scans, so co-locating
on market id keeps the working set tight.

Partition key: `toYYYYMM(timestamp)` — monthly partitions.
TTL: 18 months by default. Tune in production.

## Bootstrap

```bash
# 1. install the Tinybird CLI
brew install tinybirdco/tap/tinybird-cli   # or `pip install tinybird-cli`

# 2. log in (will open a browser)
tb auth

# 3. create the workspace
tb workspace create bufi-analytics

# 4. push the datasources + pipes
cd tinybird
tb push

# 5. mint two tokens (one for ingest, one for the read endpoints)
tb token create static  bufi_ingest      --scope DATASOURCES:APPEND
tb token create static  bufi_analytics_r --scope PIPES:READ

# 6. wire the four env vars (see "Env vars" below)
```

Validate locally before pushing:

```bash
cd tinybird
tb check          # syntax-validates every .datasource + .pipe
tb push --dry-run # diff what would be pushed
```

## Env vars

| Name                    | Where it's read                                              | Purpose                                          |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| `TINYBIRD_TOKEN`        | `apps/api/src/routes/internal/tinybird-ingest.ts`            | Write token. Forwarded to `/v0/events`.          |
| `TINYBIRD_READ_TOKEN`   | `apps/api/src/routes/analytics.ts`                           | Read token. Forwarded to `/v0/pipes/*.json`.     |
| `TINYBIRD_REGION`       | both routes (defaults to `us-east-1`)                        | API base — `us-east-1`, `eu`, `gcp-europe-west2`. |
| `INTERNAL_INGEST_TOKEN` | `apps/api/src/routes/internal/tinybird-ingest.ts`            | Protects the ingest route from public callers.   |

When `TINYBIRD_TOKEN` is unset the ingest route returns 503 with a
clear "analytics disabled" message and the read routes return empty
data with `analyticsAvailable: false`. The app does not crash.

## Ingest interface (called by Ponder + keepers)

`POST /internal/tinybird/ingest`

Headers:

```
Content-Type: application/json
X-Internal-Token: $INTERNAL_INGEST_TOKEN
```

Body:

```json
{
  "dataset": "perp_match_settled",
  "row": {
    "eventId": "0xabc…-42-3",
    "chainId": 5042002,
    "blockNumber": 12345678,
    "txHash": "0xabc…",
    "logIndex": 3,
    "marketId": "0xfeed…",
    "taker": "0x…",
    "maker": "0x…",
    "side": "long",
    "sizeDelta": "1000000",
    "priceE18": "1100000000000000000",
    "notionalUsdc": "1100000",
    "feeUsdc": "1100",
    "takerPnl": "0",
    "makerPnl": "0",
    "timestamp": 1737360000123
  }
}
```

Response:

```
202 Accepted
{ "ok": true, "dataset": "perp_match_settled", "queued": true }
```

The ingest route returns 202 immediately — failed rows go to
Tinybird's DLQ; the caller does not retry on its own. `event_id`
should be deterministic from `(txHash, logIndex)` so re-ingestion is
idempotent against duplicate row inserts (Tinybird de-dupes on
`(MergeTree, sorting key)` collisions on a best-effort basis).

### Curl example

```bash
curl -X POST $API/internal/tinybird/ingest \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $INTERNAL_INGEST_TOKEN" \
  -d '{
    "dataset": "perp_funding_poked",
    "row": {
      "eventId": "0xabc-42-0",
      "chainId": 5042002,
      "blockNumber": 12345678,
      "txHash": "0xabc",
      "logIndex": 0,
      "marketId": "0xfeed",
      "fundingRateE18": "100000000000000",
      "cumulativeFunding": "1234567",
      "markPriceE18": "1100000000000000000",
      "indexPriceE18": "1099500000000000000",
      "intervalSeconds": 3600,
      "timestamp": 1737360000123
    }
  }'
```

### Ponder handler hook (Wave-F, not yet wired)

```ts
// apps/ponder/src/handlers/clearinghouse-match-settled.ts (TODO)
import { ponder } from "@/generated";

const INGEST_URL = process.env.BUFI_INGEST_URL!;        // https://api.bu.finance
const INGEST_TOKEN = process.env.INTERNAL_INGEST_TOKEN!;

ponder.on("Clearinghouse:MatchSettled", async ({ event, context }) => {
  await fetch(`${INGEST_URL}/internal/tinybird/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": INGEST_TOKEN,
    },
    body: JSON.stringify({
      dataset: "perp_match_settled",
      row: {
        eventId: `${event.transaction.hash}-${event.log.logIndex}`,
        chainId: context.network.chainId,
        blockNumber: Number(event.block.number),
        txHash: event.transaction.hash,
        logIndex: event.log.logIndex,
        marketId: event.args.marketId,
        taker: event.args.taker.toLowerCase(),
        maker: event.args.maker.toLowerCase(),
        takerIntentId: event.args.takerIntentId,
        makerIntentId: event.args.makerIntentId,
        side: event.args.side === 0 ? "long" : "short",
        sizeDelta: String(event.args.sizeDelta),
        priceE18: String(event.args.priceE18),
        notionalUsdc: String(event.args.notionalUsdc),
        feeUsdc: String(event.args.feeUsdc),
        takerPnl: String(event.args.takerPnl ?? 0),
        makerPnl: String(event.args.makerPnl ?? 0),
        timestamp: Number(event.block.timestamp) * 1000,
      },
    }),
  });
});
```

The Ponder wiring is intentionally **not** part of this wave (E7).
That lives in Wave-F.

## Read interface (consumed by the web app)

All read endpoints are thin proxies in `apps/api/src/routes/analytics.ts`.
Cache headers: `Cache-Control: max-age=15, stale-while-revalidate=60`.

| Endpoint                                       | Pipe                       |
| ---------------------------------------------- | -------------------------- |
| `GET /analytics/leaderboard?window=7d&limit=100` | `leaderboard_by_pnl`       |
| `GET /analytics/markets/:id/volume?window=24h` | `market_24h_volume`        |
| `GET /analytics/markets/:id/ohlcv?bar=1m&limit=500` | `ohlcv_by_market`     |
| `GET /analytics/markets/:id/funding?limit=500` | `funding_history`          |
| `GET /analytics/markets/:id/oi?bar=5m&limit=500` | `oi_history`              |

Frontend client: `apps/web/lib/analytics.ts` (re-exports typed helpers
around the above).

## Vendor-swap exit clause

Tinybird's pricing is fine for early-stage; if MRR > $10k/mo, pricing
pivots, the Events API quota gets uncomfortable, or we just decide
"enough vendor risk", the same workload can be rebuilt on:

| Layer                | Tinybird                      | Self-hosted equivalent                                        |
| -------------------- | ----------------------------- | ------------------------------------------------------------- |
| Column store         | Tinybird-managed ClickHouse   | ClickHouse Cloud / Altinity / self-hosted ClickHouse on K8s   |
| `.datasource`        | DDL macro                     | `CREATE TABLE` migration files (identical schema)             |
| `.pipe`              | HTTP-fronted parameterised query | A Hono route + parameterised ClickHouse client query      |
| Events API ingest    | `POST /v0/events`             | `POST` to a self-hosted HTTP-to-ClickHouse shim (chproxy,     |
|                      |                               | clickhouse-keeper-ingestor, or a thin Bun service)            |
| Auth tokens          | Static `Bearer` tokens        | mTLS / Auth0 / Tinybird-compatible token shim                 |
| Materialized views   | `.pipe` with `TYPE materialized` | Standard ClickHouse `MATERIALIZED VIEW` statements         |

The schemas in this directory are written in syntax that round-trips
cleanly to vanilla ClickHouse — `LowCardinality`, `DateTime64`,
`MergeTree`, `toYYYYMM`, `ORDER BY` and `TTL` are all native CH
features that Tinybird exposes by passthrough. Engine settings live in
`ENGINE_*` keys that map 1:1 to CH `ENGINE = MergeTree() ORDER BY …`.

Migration cost is roughly:
- `.datasource` → `.sql` (sed substitution): hours
- `.pipe` → parameterised query inside the analytics route: a day per pipe
- Ingest shim: a couple of days for an authenticated HTTP-to-CH router
- Token surface compatibility shim: a day if we want zero-app-side change

Worst-case ETA: one engineer-week. We don't owe Tinybird a long
runway commitment.

## Gaps for next cycle (Wave-F)

- Wire Ponder handlers (`apps/ponder/src/handlers/*.ts`) into the ingest
  route. Stubs above. Needs:
  - `BUFI_INGEST_URL` env var on the Ponder deployment
  - `INTERNAL_INGEST_TOKEN` sharing between API + Ponder
  - Backfill script: replay historical events through the ingest route
- Wire keeper trigger emissions:
  - `keeper-perps-funding` → `perp_funding_poked`
  - `keeper-perps-liquidator` → `perp_liquidation`
  (currently both keepers only write to the on-chain log; they need a
  post-tx hook that mirrors to the ingest route.)
- Materialized rollups: add `.pipe` files with `TYPE materialized` that
  pre-aggregate 1m OHLCV bars into 1h / 1d for cheaper long-range queries.
- Per-trader PnL leaderboard could be cached aggressively (60s) at the
  CDN edge — current cache is 15s for liveness.
