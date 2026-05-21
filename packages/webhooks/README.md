# @bufi/webhooks

Webhook delivery surface for BUFI: HMAC signing, retry/backoff, nonce-based
dedup, and a Redis-backed fan-out worker.

Two consumer audiences:

1. **apps/api** consumes the full surface — subscription store + delivery
   worker + management routes.
2. **Integrators** verifying inbound BUFI webhooks consume only `/verify`.

For end-to-end integrator docs (filter shapes, retry table, event payloads)
see [`docs/integrator/WEBHOOKS.md`](../../docs/integrator/WEBHOOKS.md).

## Verifying an inbound webhook

```ts
import { verifyWebhookRequest } from "@bufi/webhooks/verify";

const result = verifyWebhookRequest({
  body: await req.text(),
  signature: req.headers.get("X-Bufi-Signature")!,
  nonce: req.headers.get("X-Bufi-Nonce")!,
  timestamp: Number(req.headers.get("X-Bufi-Timestamp")!),
  secret: process.env.BUFI_WEBHOOK_SECRET!,
});
if (!result.valid) {
  return new Response(`bad webhook: ${result.reason}`, { status: 401 });
}
```

Canonical signing input is `${timestamp}.${nonce}.${body}` hashed with
HMAC-SHA256 keyed by your subscription secret. The verifier:

1. validates `timestamp` is within `toleranceSeconds` of now (default 300s)
2. validates `signature` is a 64-char hex string
3. constant-time compares against the expected HMAC

## Wire format

| Header             | Description |
|--------------------|-------------|
| `X-Bufi-Signature` | lowercase hex sha256-hmac |
| `X-Bufi-Nonce`     | deterministic per-event nonce — use as your idempotency key |
| `X-Bufi-Timestamp` | unix seconds (verifier rejects if skew > 5 min) |
| `X-Bufi-Event`     | `"fill"`, `"liquidation"`, or `"funding"` |
| `X-Bufi-Attempt`   | 1-based delivery attempt count |

## Server-side surface (apps/api)

The `apps/api` server consumes the rest of the package — these are not
stable surfaces for integrators:

- `createSqliteWebhookStore({ path })` — subscription + delivery-attempt store
- `startDeliveryWorker({ store, subscribe, fetcher? })` — fan-out worker
- `cacheRawSecret(subscriptionId, secret)` / `evictRawSecret(...)` — secret cache
  fed by route handlers on create / rotate / delete

## Retry schedule

```
attempt 1 -> immediate
attempt 2 -> wait 1m
attempt 3 -> wait 5m
attempt 4 -> wait 30m
attempt 5 -> wait 6h
       and 24h before dead-letter? No — the table is:

  delay-before-NEXT-attempt indexed by attempt:
    [60s, 300s, 1800s, 21600s, 86400s]   = [1m, 5m, 30m, 6h, 24h]
```

After attempt 5 fails the subscription is flipped to `status: "disabled"`
with `disabledReason: "dead_lettered_after_5_attempts"`.

## Tests

```
cd packages/webhooks && bun test
```

Covers hmac sign/verify, retry decisions, nonce derivation, subscription
filter matching, end-to-end synthetic delivery (2xx), retry scheduling on
non-2xx, dead-letter after MAX attempts, and dedup against succeeded nonces.
