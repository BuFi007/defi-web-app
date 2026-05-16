# @bufi/fx-telarana

Worktree owner: `feature/fx-telarana-lending-backend`

## Scope

FX Telaraña is a decentralized stablecoin-FX lending/borrowing protocol. Markets are USDC paired against international stablecoins: EURC, MXNB, BRL, JPYC, QCAD. The backend exposes indexed positions, builds borrow quotes from oracles, and forms borrow-intent digests. The contracts settle.

## What to build

| File | Status | What it does |
|---|---|---|
| `src/schemas.ts` | ✅ scaffolded | Zod request/response shapes |
| `src/index.ts` | ⬜ interface only | `FxTelaranaService` |
| `src/markets.ts` | ⬜ TODO | per-chain market registry hydration |
| `src/quote.ts` | ⬜ TODO | rate model, HF projection |
| `src/intent.ts` | ⬜ TODO | EIP-712 borrow intent digest |
| `src/risk.ts` | ⬜ TODO | liquidation candidate scanner |

Wire `createFxTelaranaService()` into `apps/api/src/routes/fx-telarana.ts`.

## Future integrations to keep room for

- Morpho-style vault adapter
- Uniswap v4 hook adapter (FX swap routing during liquidations)
- Circle CCTP / Gateway routes for crosschain collateral

## Definition of done

- All `/fx-telarana/*` routes return live data.
- Quotes refuse stale oracles (`MAX_STALE_SECONDS` constant per market).
- Borrow intent digest is verifiable in viem and matches the contract's typehash.
- Liquidation scanner output equals contract HF read for every returned position.
