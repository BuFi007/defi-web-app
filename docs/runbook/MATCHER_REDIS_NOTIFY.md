# Matcher Redis notify — runbook (Wave H1)

Background on why and how `apps/keeper-perps-matcher` listens on
`perps:intent:inserted` for sub-second intent → match latency.

## What this replaces

Before Wave H1, the matcher polled `db.perpsIntents.list({ status:
"pending" })` every `KEEPER_POLL_MS` (default 30s). Worst-case the
trader sat watching their order do nothing for 30s before the matcher
even *looked* at it, which felt awful in demo flows.

The original plan was Postgres `LISTEN/NOTIFY`. The trading DB is
`bun:sqlite` though (no LISTEN/NOTIFY), so we pivoted to Redis pub/sub —
which we already had on the box for the WS fan-out (PR #56 / Wave E6).

## Architecture

```
apps/api         packages/perps              Redis              apps/keeper-perps-matcher
  │                  │                          │                          │
POST /perps    createIntent  publishChannel("perps:intent:inserted")  subscribeChannel(...)
  intents     ┌─►store.put  ────► realtimePublish ───► PUBLISH ────►  on message → runMatchPass("notify")
              │
              └──► EIP-712 verify, dedupe by nonce
                                                                    parallel: poll tick → runMatchPass("poll")
```

- Channel: `perps:intent:inserted` (single global channel, payload carries
  `marketId` + `chainId`).
- Payload shape: `PerpsIntentInsertedMessage` in `@bufi/realtime/channels`.
- Producer: `packages/perps/src/service.ts` immediately after `store.put`.
- Consumer: `apps/keeper-perps-matcher/src/index.ts`,
  `attachIntentInsertedSubscribe`.

## Configuration

| Env var | Producer (apps/api) | Consumer (matcher) | Effect |
|---|---|---|---|
| `REDIS_URL` set on both | publishes to Redis | subscribes via Redis | Cross-process sub-second latency (~100ms). |
| `REDIS_URL` set only on one | publish or subscribe silently no-ops | Notify path is dead. Poll fallback (30s) covers it. |
| `REDIS_URL` unset on both | publish lands on in-process `EventEmitter` | subscribe listens on the same emitter | Works ONLY when api + matcher run in the *same Bun process* (rare). In separate processes the emitter doesn't cross — poll fallback only. |

**Production must set `REDIS_URL` on every replica.** Without it the
Wave H1 latency win is gone and the matcher falls back to the 30s poll
cadence.

## Verifying the notify path locally

Two terminals. Both need a real Redis (e.g. `brew services start redis`
or `docker run -p 6379:6379 redis:7`).

```bash
# Terminal 1 — apps/api with realtime publish enabled
REDIS_URL=redis://localhost:6379 bun run --filter ./apps/api dev

# Terminal 2 — matcher with realtime subscribe enabled
REDIS_URL=redis://localhost:6379 KEEPER_PRIVATE_KEY=0x... \
  bun run --filter ./apps/keeper-perps-matcher dev
```

Watch the channel:

```bash
redis-cli MONITOR | grep perps:intent:inserted
```

Post a signed intent. Expected log sequence:

```
# apps/api
POST /perps/intents 200 OK

# redis-cli MONITOR
1716200000.123456 [0 127.0.0.1:54321] "PUBLISH" "perps:intent:inserted" "{...}"

# matcher (within ~100ms of the POST)
[@bufi/keeper-perps-matcher.notify] perps_matcher.subscribe_ready ...
[@bufi/keeper-perps-matcher] perps_matcher.scan {"trigger":"notify",...,"matches":1,"settled":[...]}
```

If the matcher's `perps_matcher.scan` log shows `"trigger":"poll"`
instead of `"notify"`, the notify path is broken — see troubleshooting.

## Fallback cadence

`KEEPER_POLL_MS` (default 30s) is the upper bound on intent → match
latency when the notify path is unavailable. Originally 5s; bumped to
30s because the notify catches ~all real traffic and 5s polling was
floor-noise. To force-tune polling cadence (e.g. for a demo box without
Redis):

```bash
KEEPER_POLL_MS=5000 bun run --filter ./apps/keeper-perps-matcher dev
```

## Idempotency

The matcher serialises match passes through an in-process mutex
(`running` flag in `apps/keeper-perps-matcher/src/index.ts`). If a
notify arrives mid-pass, `pendingRerun` queues exactly one re-run after
the current pass completes — coalescing avoids unbounded queue growth.

Double-attempts on the same intent are safe at the DB layer too:
`recordFill` flips status from `pending` → `partially_filled` /
`filled`, so `matchPriceTimePriority` filters the intent out on the
next pass.

## Troubleshooting

| Symptom | Diagnosis | Fix |
|---|---|---|
| `WS fan-out disabled, no REDIS_URL` in api or matcher logs | `REDIS_URL` not set on that process | Set it. |
| Matcher logs `perps_matcher.subscribe_ready` but no `notify` triggers fire | Producer (api) isn't publishing — check api logs for `realtimePublish` errors | Verify api has `REDIS_URL` + `packages/perps/src/service.ts` is the H1 version with the publish call after `store.put`. |
| Matcher crashes on boot with `subscribe_attach_failed` | ioredis client error during subscribe — usually wrong URL | Fix URL. Subscribe retries every 5s; no manual restart needed once Redis is reachable. |
| `redis-cli MONITOR` shows PUBLISH but matcher doesn't react | Different Redis instances (api and matcher pointing at different brokers) | Make both processes point at the same `REDIS_URL`. |

## Related

- PR #56 (`feat/wk1e-bun-ws-redis`) — original Redis pub/sub + channel
  taxonomy.
- `apps/api/src/lib/REALTIME.md` — channel-by-channel docs.
- `packages/realtime/src/channels.ts` — payload schemas and the canonical
  `PERPS_INTENT_INSERTED_CHANNEL` constant.
