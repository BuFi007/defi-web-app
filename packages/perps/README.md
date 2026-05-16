# @bufi/perps

Worktree owner: `feature/perps-backend-final`

## Scope

FX/stablecoin perpetuals backend domain. This package owns market metadata, EIP-712 trade intents, the quote engine, and indexer-fed position state. It does NOT own the contract — Solidity lives elsewhere.

## What to build

| File | Status | What it does |
|---|---|---|
| `src/schemas.ts` | ✅ scaffolded | Zod request/response shapes |
| `src/index.ts` | ⬜ interface only | `PerpsService` — implement each method |
| `src/quote.ts` | ⬜ TODO | indexer + oracle → indicative price + funding |
| `src/intent.ts` | ⬜ TODO | build EIP-712 typed data + digest |
| `src/positions.ts` | ⬜ TODO | read Ponder, reconcile w/ contract |
| `src/liquidation.ts` | ⬜ TODO | health-factor scanner |

Wire `createPerpsService()` into `apps/api/src/routes/perps.ts`.

## Definition of done

- All routes under `/perps/*` return live data (no 501s).
- `/perps/quote/premium` runs an oracle simulation behind x402.
- `/perps/intents` returns a verifiable EIP-712 digest a trader can sign in viem.
- `/perps/liquidations/candidates` matches a contract read of every returned position.
- Tests cover: quote determinism, intent signature verify, HF math.

## Money rules

- No client-supplied price is trusted.
- Oracle freshness must be enforced (`oracle.freshness` MCP tool).
- All intents have a deadline and a nonce — both verified server-side before forwarding to the contract.
- Liveblocks is NEVER source of truth for positions.
