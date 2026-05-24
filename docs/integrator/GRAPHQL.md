# BUFI Public GraphQL Gateway

The BUFI API exposes a public read-only GraphQL surface backed by
`apps/ponder` — our event indexer. The gateway sits in front of
Ponder's internal `:42069/graphql` and adds per-IP / per-API-key
rate limiting and a mutation guard.

> **Read-only.** Mutations are rejected at the gateway. The
> indexer is a derived view; writes happen onchain.

## Endpoints

| Method | Path           | Purpose                                    |
| ------ | -------------- | ------------------------------------------ |
| POST   | `/graph`       | Run a GraphQL query against the indexer    |
| GET    | `/graph/schema`| Cached introspection payload for codegen   |

The default base URL is `https://api.bu.finance`. In local dev that's
`http://localhost:3002`.

## Authentication

Two modes:

1. **Anonymous (default).** No header required. Lower rate-limit
   tier — useful for one-off curls and exploratory tooling.
2. **API key.** Send `X-Bufi-Api-Key: <prefix>.<secret>`. The gateway
   keys the bucket by the prefix; the secret is never logged. Higher
   rate-limit tier (see below).

API keys are minted out-of-band; ask the BUFI team for one. The key
format mirrors most BFFs — a public prefix for routing/keying and a
secret for verification.

## Rate limits

The gateway uses a token-bucket limiter. Each request consumes one
token; tokens refill linearly at the rate below.

| Route      | Anon (IP)              | Tier 1 (API key)         |
| ---------- | ---------------------- | ------------------------ |
| `/graph`   | 100 burst, 10 / sec    | 1000 burst, 100 / sec    |
| `/markets` | 200 burst, 50 / sec    | 2000 burst, 500 / sec    |
| `/perps`   | 200 burst, 50 / sec    | 2000 burst, 500 / sec    |

On rejection you get HTTP `429` with:

```json
{
  "error": "rate_limited",
  "retryAfter": 3,
  "bucket": "graph"
}
```

…and a `Retry-After: <seconds>` header. Every response also carries
`X-RateLimit-Limit` and `X-RateLimit-Remaining` so SDKs can pace
themselves.

## Sample queries

### List recent perps settlements

```graphql
query Settlements {
  perpsSettlements(limit: 50, orderBy: { ts: desc }) {
    items {
      id
      trader
      marketId
      pnl
      ts
      txHash
    }
  }
}
```

```bash
curl -X POST https://api.bu.finance/graph \
  -H "Content-Type: application/json" \
  -H "X-Bufi-Api-Key: pk_xxx.sk_yyy" \
  --data '{"query":"query { perpsSettlements(limit: 5) { items { id trader marketId pnl ts } } }"}'
```

### Inspect available types via the schema endpoint

```bash
curl https://api.bu.finance/graph/schema
```

The schema endpoint caches the introspection response for ~60 seconds
on the server side, so codegen runs don't burn rate limit. Pair it
with `graphql-code-generator` or `graphql-codegen-cli`.

## Mutations

```bash
curl -X POST https://api.bu.finance/graph \
  -H "Content-Type: application/json" \
  --data '{"query":"mutation { __typename }"}'
```

…responds with HTTP `405`:

```json
{
  "error": "mutations_not_allowed_on_public_gateway",
  "hint": "The public GraphQL gateway is read-only. Mutations are blocked at the perimeter."
}
```

Submit writes via the dedicated REST surfaces (`/perps`, `/spot`,
`/fx-telarana`, …) or directly onchain.

## Caching

Successful query responses ship with:

```
Cache-Control: public, max-age=2, stale-while-revalidate=10
X-Bufi-Gateway: ponder-v1
```

The schema endpoint uses `max-age=60` because it changes only when
the Ponder schema is redeployed.

## Errors

| Status | Cause                                                              |
| ------ | ------------------------------------------------------------------ |
| 405    | Mutation rejected by gateway                                       |
| 429    | Rate-limit bucket drained (see `Retry-After`)                      |
| 502    | Upstream Ponder indexer unreachable / timed out (10s upstream cap) |

## Implementation notes

- Per-route limits live in `apps/api/src/middleware/rate-limit-config.ts`.
- Token-bucket storage uses Redis when `REDIS_URL` is set (multi-instance
  prod), otherwise an in-process Map (single-instance dev).
- The mutation guard is a coarse string check — sufficient for v1.
  We'll swap in `graphql` parser-based detection if integrators
  legitimately need nested-string `mutation` payloads in their queries.
