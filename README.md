# BUFI · FX Telaraña · FX² Arcade

Bun workspaces monorepo. Three product surfaces converge on a single web frontend.

```
apps/
  web/              Next.js 16 frontend                    (the product)
  api/              Hono API: realtime + agentic surface   (port 3002)
  ponder/           Onchain indexer                        (port 42069)
  keeper-*          Always-on Bun services for Gateway, spot, perps, Pyth, Bento
packages/
  liveblocks/       Realtime rooms (wallet-scoped session auth)
  x402/             Nanopayment-gated route middleware
  mcp/              Tool registry + workflow state machine
  logger/           JSON structured logger
  db/               Durable SQLite trading DB + read-store contracts
  keeper-runtime/   Shared keeper loop, health endpoint, viem clients
  market-data/      Pyth Hermes client + oracle freshness helpers
  fx-spot/          BUFX Venue spot intent typed-data + calldata builders
  perps/            Perps domain interface + zod schemas
  fx-bento/         Arcade domain interface + zod schemas
  fx-telarana/      Lending domain interface + zod schemas
  shared-types/     Cross-package types
  env/              Zod-validated env
  contracts/        Per-chain address book
services/           Future split-out backend services
```

## Quickstart

```bash
bun install
bun run dev               # frontend on :3000
bun run dev:api           # api on :3002
bun run dev:ponder        # indexer on :42069
bun run keeper:spot       # one keeper service, same pattern for all keepers
bun test --filter '@bufi/*'
```

Per-package: `bun run --filter @bufi/<name> typecheck` / `test`.

## Vercel

The Next.js app lives at `apps/web`, **not** the repo root. In the Vercel dashboard:

> **Project Settings → General → Root Directory → `apps/web`**

Once set, Vercel auto-detects Next.js inside `apps/web` and the workspace install resolves correctly from the monorepo root.

## Worktrees — who owns what

Three parallel feature branches each own one backend domain. Every worktree shares the same monorepo (rebase off `origin/main` to pick up changes here).

| Worktree | Branch | Package | Routes |
|---|---|---|---|
| `../fx-telarana-perps-backend` | `feature/perps-backend-final` | `@bufi/perps` | `/perps/*` |
| `../fx-telarana-bento-backend` | `feature/fx-bento-backend` | `@bufi/fx-bento` | `/fx-bento/*` |
| `../fx-telarana-lending-backend` | `feature/fx-telarana-lending-backend` | `@bufi/fx-telarana` | `/fx-telarana/*` |

Each package has a README with concrete TODO list and definition of done.

### Worktree onboarding (per worktree owner)

```bash
cd ../<worktree>
git fetch origin
git rebase origin/main          # inherit the monorepo + shared packages
bun install
bun test --filter '@bufi/<your-package>'
```

Then fill in the `⬜ TODO` files listed in `packages/<your-package>/README.md`. Wire your `createXxxService()` factory into `apps/api/src/routes/<your-domain>.ts` — the routes already validate inputs with zod and return 501 stubs; replace the stub bodies with `service.xxx(parsed)`.

### Ponder

Each backend domain has a handler file in `apps/ponder/src/handlers/`. When the contract is deployed, the worktree:

1. Drops the ABI into `apps/ponder/abis/<Domain>.abi.ts`.
2. Adds the `address` + `startBlock` env vars (see `apps/ponder/ponder.config.ts`).
3. Uncomments `import "./handlers/<domain>";` in `apps/ponder/src/index.ts`.
4. Writes the event handlers using the schema in `apps/ponder/ponder.schema.ts`.

## Architecture rules

These are non-negotiable and the worktrees must respect them:

- **Money lives onchain.** Contracts settle. Ponder indexes. Backend coordinates. Liveblocks is never source of truth for balances, orders, escrow, positions, liquidations, or scores-of-record.
- **No client-supplied price is trusted.** Quotes come from oracles + indexed state, verified against `oracle.freshness`.
- **No financial action without:** wallet signature, valid nonce, valid deadline, fresh oracle, optionally an x402 receipt for paid endpoints.
- **AI tools never bypass gates.** The MCP runner enforces `requiresSignature` / `requiresPaymentUsdc` before `execute()` runs.
- **MCP signatures are EIP-712.** Signature-gated workflows sign `BUFX MCP Workflow` with the workflow id, tool name, actor, and canonical input hash before execution.
- **No Clerk. No SaaS auth.** Wallet sessions only (`X-Wallet-*` SIWE-style headers, verified server-side with viem).
- **All inputs validated with zod.** All envs validated with zod.
- **Pin deps.** No `^` or `~` in `package.json`.

## Stack

- **Bun** 1.3 — package manager + runtime
- **Next.js** 16 (Turbopack), **wagmi**, **viem**, **Dynamic Labs SDK** in `apps/web`
- **Hono** in `apps/api` (`@bufi/api`)
- **Ponder** 0.16 (pglite for dev, Postgres for prod) in `apps/ponder`
- **Liveblocks** 2.24 for realtime
- **zod** 3.25 everywhere
- **TypeScript** 5

## Liveblocks room map

| Room id | Owner | What's in storage |
|---|---|---|
| `bufi:<chainId>:perps:<marketId>` | @bufi/perps | nothing (presence only) |
| `bufi:<chainId>:arcade:fx-bento:<roomId>` | @bufi/fx-bento | countdown, tile preview, indexed leaderboard snapshot |
| `bufi:<chainId>:fx-telarana:<marketId>` | @bufi/fx-telarana | nothing (presence only) |
| `bufi:mcp:workflow:<workflowId>` | @bufi/mcp | workflow progress |

## Routes

```
GET    /health

POST   /liveblocks/auth                   wallet-session → scoped token

GET    /markets
GET    /markets/:marketId
GET    /markets/:marketId/price
GET    /markets/:marketId/candles

POST   /spot/intents                       wallet-session

GET    /perps/markets
POST   /perps/quote
POST   /perps/quote/premium               x402 0.0010 USDC
POST   /perps/intents                     wallet-session
GET    /perps/replacement-needed          wallet-session
POST   /perps/intents/:id/replacement/prepare
POST   /perps/intents/:id/replacement
GET    /perps/intents/:id
GET    /perps/positions/:address
GET    /perps/trades/:address
GET    /perps/funding
GET    /perps/liquidations/candidates

POST   /fx-bento/rooms                    x402 0.5000 USDC + wallet-session
GET    /fx-bento/rooms
GET    /fx-bento/rooms/:id
POST   /fx-bento/rooms/:id/join           wallet-session → digest
POST   /fx-bento/rooms/:id/commit
POST   /fx-bento/rooms/:id/reveal
GET    /fx-bento/rooms/:id/leaderboard
POST   /fx-bento/rooms/:id/settle

GET    /fx-telarana/markets
POST   /fx-telarana/borrow/quote
POST   /fx-telarana/borrow/intents        wallet-session
GET    /fx-telarana/positions/:address

GET    /mcp/tools
POST   /mcp/workflows
GET    /mcp/workflows/:id
POST   /mcp/workflows/:id/run             resume w/ signature or x402 receipt

GET    /x402/receipts
GET    /x402/verify
```

## Environment variables

Server (`apps/api`, `apps/ponder`):
- `LIVEBLOCKS_SECRET_KEY` — realtime
- `DATABASE_URL` / `DATABASE_PRIVATE_URL` — postgres for ponder (pglite fallback)
- `PONDER_RPC_URL_ARC_TESTNET`, `PONDER_RPC_URL_AVAX_FUJI`
- `PONDER_BUFX_START_BLOCK_FUJI`, `PONDER_BUFX_START_BLOCK_ARC`
- `PONDER_TGH_START_BLOCK_ARC`, `PONDER_SPOT_EXECUTOR_START_BLOCK_ARC`
- `PONDER_PERPS_ADDRESS_ARC`, `PONDER_PERPS_START_BLOCK_ARC`
- `PONDER_BENTO_ADDRESS_FUJI`, `PONDER_BENTO_START_BLOCK_FUJI`
- `PONDER_TELARANA_ADDRESS_FUJI`, `PONDER_TELARANA_START_BLOCK_FUJI`
- `X402_FACILITATOR_URL`, `X402_RECEIVER_ADDRESS`
- `BUFI_DB_PATH` — durable SQLite path for API/MCP/x402/perps intent state; defaults to `.bufi/trading-machine.sqlite` in local dev
- `TREASURY_ADDRESS`, `CONTRACT_ADDRESSES_JSON` (override addresses without code change)
- `CONTRACT_ADDRESSES_JSON` can override Phase B-E perps addresses under `5042002.perps.{clearinghouse,marginAccount,fundingEngine,healthChecker,liquidationEngine,orderSettlement,markets}`; it also accepts the flat `deployments/perps-5042002.json` keys from `fx-telarana`
- `API_SIGNER_PRIVATE_KEY` — **dev only**, never set in production
- `KEEPER_PRIVATE_KEY`, `KEEPER_POLL_MS`, `GATEWAY_API_BASE`, `PYTH_HERMES_URL`

Client (`apps/web`):
- `NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID`
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY`
- `NEXT_PUBLIC_BG_VARIANT`, `ONE_NEXT_PUBLIC_BG_VARIANT`, `TWO_NEXT_PUBLIC_BG_VARIANT`
- `NEXT_PUBLIC_PERPS_REPLACEMENT_E2E=1` — dev-only mock wallet for the residual-order toast harness
- `NEXT_PUBLIC_PERPS_REPLACEMENT_E2E_PRIVATE_KEY` — optional dev-only private key; defaults to the smoke wallet
- `NEXT_PUBLIC_PERPS_REPLACEMENT_E2E_CHAIN_ID` — optional dev-only chain id; defaults to Arc testnet `5042002`

## Perps replacement smoke

Run the API-only residual flow:

```bash
BUFI_DB_PATH="$PWD/.bufi/perps-replacement-smoke.sqlite" \
BUFI_API_URL=http://localhost:3002 \
bun run smoke:perps-replacement:api
```

Run the browser toast harness with a dev-only mock wallet:

```bash
BUFI_DB_PATH="$PWD/.bufi/perps-replacement-browser.sqlite" \
NODE_ENV=development \
PORT=3002 \
bun run dev:api

NEXT_PUBLIC_API_URL=http://localhost:3002 \
NEXT_PUBLIC_PERPS_REPLACEMENT_E2E=1 \
NEXT_PUBLIC_PERPS_REPLACEMENT_E2E_CHAIN_ID=5042002 \
bun run --filter ./apps/web dev

BUFI_DB_PATH="$PWD/.bufi/perps-replacement-browser.sqlite" \
BUFI_API_URL=http://localhost:3002 \
BUFI_WEB_URL=http://localhost:3000 \
bun run smoke:perps-replacement:browser
```

The browser harness launches headless Chrome, waits for the replacement toast, clicks `Sign`, and then verifies the residual order is back in the pending matcher book.

## Mental model

> Liveblocks makes it realtime.
> Ponder makes it indexed.
> x402 makes paid AI/API actions economically gated.
> MCP makes workflows agent-operable.
> Contracts settle money.
> The backend coordinates.
