# Realtime fan-out (Wave E6)

Bun WebSocket + Redis pub/sub for orderbook + trade-tape + funding-rate
distribution. Roadmap pillar 4 + 10 of
`docs/roadmap-production-perps.md` (PR #46).

## Why

Polling the API every 1s for the orderbook + trade tape doesn't scale past a
handful of users and feels janky compared to a CEX. The push path makes the
trade UI sub-100ms perceived latency. Redis fans out across N API instances
so a single client can hold a WS to *any* replica and still see the same
event stream.

## Channels

Channel naming: `<kind>:<marketId>` — built/parsed via
`realtimeChannel()` and `parseRealtimeChannel()` in `realtime.ts`.

| Channel kind | Source | Payload shape |
|---|---|---|
| `trades:<marketId>` | matcher / settlement | `TradeMessage` |
| `book:<marketId>` | pending-intents view | `BookMessage` |
| `funding:<marketId>` | `FundingPoked` event | `FundingMessage` |

Every WS connection at `/ws/markets/:marketId` subscribes to ALL three
channels for that market by default. v2 will add a client→server control
envelope for partial subscriptions (e.g. "trades only").

## Wire shape

Every WS frame is a JSON-encoded `RealtimeEnvelope`:

```ts
{
  type: "realtime",
  channel: "trades:EUR-USD-PERP",
  kind: "trades",
  marketId: "EUR-USD-PERP",
  data: { /* TradeMessage | BookMessage | FundingMessage */ }
}
```

Bigint fields inside `data` are decimal-string-encoded E18 — same convention
as the existing Pyth tick + obDelta frames in `routes/ws.ts`. JS parsers
silently truncate large numbers; never JSON.parse a bigint as a Number.

## REDIS_URL

| State | Behaviour |
|---|---|
| set | Two ioredis connections (pub + sub); cross-instance fan-out |
| unset | In-process `EventEmitter`; logs `WS fan-out disabled` once at boot |

The fallback is single-instance only. Production must set `REDIS_URL` —
without it, two API replicas can't see each other's published events.

## Publishing — three sources

### 1. Ponder indexer (TODO — interface defined)

`apps/ponder/` is owned by PR #41. When the indexer ships, its handlers
should call `publishChannel("trades:<marketId>", { ... })` etc. The
interface (channel naming + envelope shape) is finalised here; the wiring
inside Ponder is a follow-up PR.

To minimise the coupling, Ponder can import just the two-function surface:

```ts
import {
  publishChannel,
  buildEnvelope,
} from "@bufi/api/lib/redis-realtime"; // or a shared @bufi/realtime package
```

### 2. API route (live today)

`POST /internal/realtime/publish` accepts an envelope from the matcher /
keeper. Guarded by `X-Internal-Token` against the `INTERNAL_REALTIME_TOKEN`
env var. This is the most testable path and the one the v1 keeper uses.

### 3. Keeper-direct (v2)

`apps/keeper-perps-matcher/` will publish straight to Redis after
`settleMatch` confirms, skipping the API hop. Pulled out of v1 scope so the
keeper doesn't gain a Redis dep before we've shaken out the channel schema.

## Adding a new channel kind

1. Append the kind to `REALTIME_CHANNEL_KINDS` in `realtime.ts`.
2. Add the payload interface + a discriminated union member to
   `RealtimePayload`.
3. Document the source + payload shape in the table above.
4. The WS handler picks it up automatically — `marketsWebSocketHandler`
   iterates over `REALTIME_CHANNEL_KINDS` on `open`.

## Testing

- `bun run --filter ./apps/api typecheck` — schema + handler compile.
- Manual: `redis-cli PUBLISH trades:EUR-USD-PERP '{"type":"realtime","channel":"trades:EUR-USD-PERP","kind":"trades","marketId":"EUR-USD-PERP","data":{"priceE18":"1160000000000000000","sizeE18":"1000000000000000000","side":"long","ts":1716200000000}}'`
- A WS client at `/ws/markets/EUR-USD-PERP` receives the frame verbatim.
