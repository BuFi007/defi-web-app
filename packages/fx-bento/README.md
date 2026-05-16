# @bufi/fx-bento

Worktree owner: `feature/fx-bento-backend`

## Scope

FX² Arcade / FX Bento backend. Multiplayer arcade prediction game built around FX market outcomes. Fixed entry fee in USDC. Equal chip budgets. Place chips on price tiles. Winners share the player-funded prize pool minus capped protocol rake.

## What to build

| File | Status | What it does |
|---|---|---|
| `src/schemas.ts` | ✅ scaffolded | Zod request/response shapes |
| `src/index.ts` | ⬜ interface only | `FxBentoService` |
| `src/rooms.ts` | ⬜ TODO | createRoom / getRoom / listRooms |
| `src/commit-reveal.ts` | ⬜ TODO | hash verify, salt storage, reveal forwarding |
| `src/scoring.ts` | ⬜ TODO | tile score given oracle snapshot |
| `src/settle.ts` | ⬜ TODO | distribute prize pool, emit settle tx |

Wire `createFxBentoService()` into `apps/api/src/routes/fx-bento.ts`.

## Definition of done

- `/fx-bento/rooms` (POST) creates a room behind the x402 room-creation fee.
- `/fx-bento/rooms/:id/join` returns a signable EIP-712 entry digest.
- `/fx-bento/rooms/:id/{commit,reveal}` enforce the hash relation
  `commitment == keccak256(abi.encode(salt, tileId, chips))`.
- `/fx-bento/rooms/:id/settle` distributes the prize pool, deducts capped rake, emits the tx.
- Liveblocks room (`arcade:fx-bento:{roomId}`) carries presence, hover, countdown — never balances or scores-of-record.

## Money rules (the contract must enforce these; backend must not paper over)

- `prize_pool == sum(entry_fees)` strictly.
- `rakeBps ≤ 2000` (20% hard cap; protocol never takes uncapped directional risk).
- No protocol top-up to the prize pool.
- Refunds only when the room failed to start (insufficient players, etc).
- Settlement payouts sum to `prize_pool - rake` exactly.
