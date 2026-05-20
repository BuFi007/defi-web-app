# BUFI Webhooks — Integrator Guide

BUFI fans out `fill`, `liquidation`, and `funding` events to integrator
URLs over signed HTTPS POSTs. Each delivery is HMAC-signed, nonce-tagged,
and timestamped so receivers can verify authenticity, dedup against retries,
and reject replays.

This doc covers:

- [Authenticating with the API](#1-getting-an-api-key)
- [Registering a subscription](#2-register-a-subscription)
- [Receiving + verifying webhooks](#3-receive--verify-webhooks)
- [Event shapes](#4-event-shapes)
- [Retry behaviour](#5-retry-behaviour)
- [Replay protection](#6-replay-protection)

---

## 1. Getting an API key

Integrator API keys are provisioned out-of-band. Once you have one, pass it
on every request to `/webhooks/*` as:

```
X-Bufi-Api-Key: <integratorId>.<secret>
```

In local dev (`NODE_ENV !== "production"`) the API accepts any non-empty
value as the integrator id — useful for poking at the surface from a curl
script without provisioning a real key.

---

## 2. Register a subscription

```bash
curl -X POST https://api.bu.finance/webhooks/subscriptions \
  -H "Content-Type: application/json" \
  -H "X-Bufi-Api-Key: int_alpha.5ab…" \
  -d '{
    "url": "https://your-app.example.com/bufi-webhook",
    "filter": {
      "events": ["fill", "liquidation"],
      "markets": ["0xeurusdperp…"],
      "minNotionalUsdc": "1000000"
    }
  }'
```

Response:

```json
{
  "id": "whk_2f…",
  "url": "https://your-app.example.com/bufi-webhook",
  "filter": { "events": ["fill", "liquidation"], "markets": ["0xeurusdperp…"], "minNotionalUsdc": "1000000" },
  "status": "active",
  "createdAt": 1716156000000,
  "secret": "9c7a…"
}
```

The `secret` is shown **once**. Persist it server-side immediately; you can
rotate it later with `POST /webhooks/subscriptions/:id/rotate-secret`.

**Filter fields:**

| Field             | Required | Notes |
|-------------------|----------|-------|
| `events`          | yes      | Subset of `"fill"`, `"liquidation"`, `"funding"` |
| `markets`         | no       | Array of marketIds (lowercase hex). If omitted, all markets the producer publishes (today, requires explicit market list — wildcard subscribe is on the roadmap) |
| `minNotionalUsdc` | no       | USDC-atomic floor (6 decimals). Applies to fills; ignored for funding / liquidation |

Other endpoints on the same surface:

- `GET /webhooks/subscriptions` — list subscriptions scoped to your API key
- `GET /webhooks/subscriptions/:id` — fetch one (metadata only, secret never echoed)
- `DELETE /webhooks/subscriptions/:id` — revoke
- `POST /webhooks/subscriptions/:id/rotate-secret` — issue a fresh secret (old one stops working immediately)
- `POST /webhooks/subscriptions/:id/test` — fire a synthetic event at your URL for endpoint verification

---

## 3. Receive + verify webhooks

Every delivery POSTs to your URL with these headers:

```
Content-Type: application/json
X-Bufi-Signature: <hex sha256-hmac>
X-Bufi-Nonce: <deterministic per-event nonce>
X-Bufi-Timestamp: <unix seconds>
X-Bufi-Event: fill | liquidation | funding
X-Bufi-Attempt: <1-based delivery attempt count>
```

### Verifying (Node.js / TypeScript)

```ts
import { verifyWebhookRequest } from "@bufi/webhooks/verify";

export async function handle(req: Request): Promise<Response> {
  const body = await req.text();
  const result = verifyWebhookRequest({
    body,
    signature: req.headers.get("X-Bufi-Signature") ?? "",
    nonce: req.headers.get("X-Bufi-Nonce") ?? "",
    timestamp: Number(req.headers.get("X-Bufi-Timestamp") ?? 0),
    secret: process.env.BUFI_WEBHOOK_SECRET!,
    // toleranceSeconds: 300, // (default 5 minutes of clock skew)
  });
  if (!result.valid) {
    return new Response(`bad webhook: ${result.reason}`, { status: 401 });
  }

  const event = JSON.parse(body); // typed as WebhookEvent
  // ... do something idempotent keyed on req.headers.get("X-Bufi-Nonce") ...
  return new Response(null, { status: 200 });
}
```

### Verifying without the SDK (any language)

The canonical signing message is:

```
<timestamp>.<nonce>.<raw request body>
```

Compute `HMAC-SHA256(secret, canonical)` and lowercase-hex-encode it. Compare
against `X-Bufi-Signature` using a constant-time comparison. Reject deliveries
whose `X-Bufi-Timestamp` is more than 5 minutes off from your server clock.

Python reference:

```python
import hmac, hashlib

def verify(body: str, sig: str, nonce: str, ts: int, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(),
        f"{ts}.{nonce}.{body}".encode(),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, sig)
```

---

## 4. Event shapes

All amount-like fields are decimal strings. Parse them with `BigInt` /
your language's big-int equivalent — JSON `number` will silently truncate
large `*E18` values.

### Fill

```ts
{
  type: "fill";
  chainId: number;          // e.g. 5042002 for Arc testnet
  marketId: `0x${string}`;
  maker: `0x${string}`;
  taker: `0x${string}`;
  priceE18: string;         // fill price, 18 decimals
  sizeE18: string;          // fill size, 18 decimals
  txHash: `0x${string}`;
  blockNumber: number;
  ts: number;               // unix ms
}
```

### Liquidation

```ts
{
  type: "liquidation";
  chainId: number;
  marketId: `0x${string}`;
  trader: `0x${string}`;
  liquidator: `0x${string}`;
  rewardAtomic: string;            // USDC atomic units
  socializedLossAtomic: string;    // USDC atomic units
  txHash: `0x${string}`;
  blockNumber: number;
  ts: number;
}
```

### Funding

```ts
{
  type: "funding";
  chainId: number;
  marketId: `0x${string}`;
  rateE18: string;                  // per-interval funding rate (E18, signed)
  markE18: string;                  // mark price at the funding moment
  cumulativeFundingE18: string;     // running accrual since market inception
  version: number;                  // on-chain funding-state version
  ts: number;
}
```

---

## 5. Retry behaviour

A delivery is considered successful when your endpoint returns a `2xx`
status code within the timeout (default 30 s — keep your handler fast and
push slow work into a background queue).

Non-2xx responses (or transport-level errors) are retried on this schedule:

| Attempt | Wait before this attempt |
|---------|--------------------------|
| 1       | (initial — immediate)    |
| 2       | 1 minute                 |
| 3       | 5 minutes                |
| 4       | 30 minutes               |
| 5       | 6 hours                  |
| —       | After attempt 5 fails, the delivery is **dead-lettered** and the subscription is flipped to `status: "disabled"` |

The `X-Bufi-Attempt` header tells you which attempt you're on. A 2xx at any
attempt resets the failure counter to 0.

After dead-letter, re-enable the subscription by deleting and recreating it
(or via the operator dashboard — coming soon).

---

## 6. Replay protection

Two layers:

1. **Nonce** — `X-Bufi-Nonce` is deterministic per event (e.g.
   `fill-${marketId}-${txHash}-${blockNumber}-${takerAddress}`). The BUFI
   side guarantees the same on-chain fact always produces the same nonce.
   Persist a `(subscriptionId, nonce)` row when you finish processing and
   ack any future delivery with the same nonce as a no-op.

2. **Timestamp** — `X-Bufi-Timestamp` is bound into the HMAC input.
   Reject deliveries whose timestamp is more than 5 minutes off your
   server clock (the default tolerance in `verifyWebhookRequest`).
   This bounds replay to a 5-minute window even if you forget to dedup
   on nonce.

---

## 7. Operational notes

- **Endpoint URL**: HTTPS only in production. The webhook server does not
  follow redirects — point us at the exact handler URL.
- **Response timeout**: keep responses under 5 s; the delivery worker has a
  hard 30 s timeout but slow endpoints starve the per-instance fan-out.
- **Idempotency**: every retry carries the same `X-Bufi-Nonce`. Use it as
  your idempotency key.
- **Rotation**: rotate your secret with
  `POST /webhooks/subscriptions/:id/rotate-secret`. The old secret stops
  working immediately — update your receiver before calling rotate.
- **Test endpoint**: `POST /webhooks/subscriptions/:id/test` fires a
  synthetic event at your registered URL and returns the delivery status.
  Use this to verify your endpoint after each deploy.
