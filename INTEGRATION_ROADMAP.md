# Integration Roadmap

**Status as of branch `codex/all-backends-integration`** (commit `750c23a`).

This is the single source of truth for: where each backend integration stands,
what's blocking "transactable on testnet end-to-end", what the canonical
TypeScript stack is, and what the next sprint queue looks like. Agents reading
this before a sprint should not need to re-discover the same context.

---

## North star

A **typed perp exchange** that behaves like a finalised product on Arc
Testnet + Fuji:

- Sign + place a perp order → see the position appear in Positions tab → close
  it → see the trade in History.
- Lend USDC → see the position + APY in LoanTab; borrow against it → see HF;
  withdraw or repay.
- Join an Arcade room → commit/reveal tile picks → settle → claim prize on-chain.

Not "every flag polished, every chart indicator wired" — that's another
quarter. The bar is: a new user can complete one happy-path action per surface
without confusion, and on-chain state survives a server restart.

---

## Architecture frame

Do **not** treat this as "a frontend that calls contracts." Treat it as a
typed trading system:

```
contracts emit events
  → Ponder indexes canonical state
  → Hono exposes typed trading APIs
  → WebSocket streams market updates
  → React Query owns server cache
  → Zustand owns active trading form state
  → Lightweight Charts renders candles + overlays
  → viem/wagmi execute signed actions
```

Every bucket below maps to one layer of that stack. When a bucket is stuck,
the cause is almost always at the layer boundary (events not firing, indexer
not writing, API not reading the read-store, hook not invalidating, etc.).

---

## Bucket scorecard

| # | Bucket | % | Status | Blocker for "transactable" |
|---|---|---|---|---|
| 1 | Perps — contracts | 90 | ABIs real, deployed Arc | Reconcile two address sources |
| 2 | Perps — keepers (matcher/funding/liquidator) | 85 | Live, polling, settling on-chain | None |
| 3 | Perps — indexer → API reads | 75 | `/positions/:address` + `/trades/:address` read Ponder via `PerpsPositionReader`/`perpsSettlementReader`; mark + unrealized PnL still snapshot | No |
| 4 | Perps — frontend wiring | 95 | Long/Short signs + posts intent, hooks ready | None |
| 5 | Perps — order book / chart live data | 55 | WS scaffold end-to-end: Bun-native `/ws/markets/:marketId` (1s ticks + 250ms OB deltas, deterministic mock), reconnecting client, `useLiveMarket` hook, chart opt-in via `liveSource='ws'`. Pyth/real OB pending. | No |
| 6 | Perps — chart engine swap to lightweight-charts | 80 | `lightweight-charts` v5 candle + volume + line, kawaii tokens preserved, mock + Ponder + WS adapter | No (PriceLines wire-up pending live position data) |
| 7 | Telarana — contracts | 100 | Deployed Fuji + Arc | None |
| 8 | Telarana — SDK + math | 95 | quote/health/oracle real | None |
| 9 | Telarana — backend routes | 80 | All endpoints wired | None |
| 10 | Telarana — indexer (loan events) | 75 | Handlers wired against actual subscribed events (GatewayHubHook/SpotExecutor/FxOracle/Receiver) + 3 new schema tables | No |
| 11 | Telarana — frontend wiring | 90 | Lend/Borrow/Withdraw/Repay sign + post | None |
| 12 | Telarana — liquidation keeper | 80 | `apps/keeper-telarana-liquidator` scaffolded with safety guards; awaiting live candidates from #10 | No for MVP; ready for prod |
| 13 | Telarana — oracle staleness UX | 85 | `emitOracleStaleToast` with 5s cooldown; loan.tsx short-circuit window | No |
| 14 | Bento — contracts | 100 | 9 contracts deployed Arc + Fuji | None |
| 15 | Bento — game engine + TX builders | 95 | Full port, simulator, Merkle tree | None |
| 16 | Bento — backend API | 90 | All routes ported | None |
| 17 | Bento — frontend Lobby + Join | 90 | Live rooms, calldata + tx broadcast | None |
| 18 | Bento — commit-reveal UI binding | 90 | Real tile hash via `buildSelectionCommitment`; per-round nonce cached | None |
| 19 | Bento — claim flow UI | 85 | `useBentoClaim` poll + "Claim prize" CTA on RoundEndOverlay; wagmi broadcast + toast | None |
| 20 | Bento — settlement persistence | 95 | `createFxBentoSqlitePersistenceStore` (bun:sqlite, atomic txn, 2 tables); opt-in via `BENTO_DB_PATH` | None |
| 21 | Bento — Liveblocks presence | 95 | `/api/liveblocks/auth` route mints player-scoped tokens; wallet-session verified | None |
| 22 | Bento — merkle proof verification | 85 | Proof + leaf + root rendered as monospace block in Claim modal | None |
| 23 | Cross — wallet session auth | 85 | Works across surfaces; 3 patterns to unify | No |
| 24 | Cross — env/secrets/addresses | 80 | Zod schema + cached `CONTRACT_ADDRESSES_JSON` parser + RPC env vars + `getContractAddressOverride` helper | No |
| 25 | Cross — ponder schema + handlers | 80 | Perps + Telarana + BUFX handlers shipped; Bento gated on config update (empty ABI + Fuji address) | No |
| 26 | Cross — error recovery + retry | 80 | `resilientFetch` shipped: retry/backoff/Retry-After, auto-Idempotency-Key, 401 hook, AbortSignal. Adopted across all 3 clients. 16 tests. | No |
| 27 | Cross — observability | 70 | `@bufi/logger` middleware on every API route; Sentry no-op scaffold (web+api) opt-in via DSN env | No |
| 28 | Cross — testing | 35 | Unit in perps + perps-math (39 new) + fx-bento sqlite | Recommended |
| 29 | Cross — deployment | 50 | Web/API individually deployable; keepers need infra | Yes for prod |
| 30 | Cross — financial math package | 85 | `@bufi/perps-math` with 39 tests; panels migrated; loan was already SDK-sourced | No |

**Overall: ~85%.** (Simple average across 30 buckets after the 9-PR superpower fleet.)

---

## Canonical TypeScript stack

These are the libraries we standardize on. If an agent wants to add something
not in this list, it's a flag — push back or escalate.

### Charting
- **`lightweight-charts`** — main candle chart; replaces custom canvas. Use
  `CandlestickSeries`, `HistogramSeries` (volume), `LineSeries` (oracle/mid),
  `PriceLine` (liq/entry/mark/oracle bands). Theme via existing CSS vars.
- **`d3-array` / `d3-scale`** — order book depth math, volume buckets, overlays.
- **`date-fns`** — timeframe aggregation (`1m`, `5m`, `15m`, `1H`, `4H`).

### Trading state
- **`zustand`** — local trading panel state (selectedMarket, orderType, side,
  leverage, marginMode, price, size, reduceOnly, postOnly, tpSl).
- **`@tanstack/react-query`** — server state (markets, positions, openOrders,
  fills, balances, fundingRates, oraclePrices).
- **`@tanstack/react-virtual`** — order book, trades table, history, positions
  if rows grow.
- **`react-hook-form` + `zod`** — order forms + validation. Schemas:
  `PlaceLimitOrderSchema`, `PlaceMarketOrderSchema`, `UpdateLeverageSchema`,
  `ClosePositionSchema`, `TpSlSchema`.

### Realtime
- **`partysocket`** or native WebSocket — prices, candles, OB deltas, trades,
  liquidations, funding. **Hot path** — do not route through Liveblocks.
- **`liveblocks`** — Arcade rooms, multiplayer game state, shared watchlists,
  agent collaboration, social trading rooms. Already installed.

### Blockchain
- **`viem`** — base EVM client. Already in.
- **`wagmi`** — React wallet hooks on viem. Already in.
- **`abitype`** — type ABIs, avoid unsafe calls.
- **`ox`** — low-level Ethereum primitives (ABI, addresses, bytes, signatures,
  tx, JSON-RPC). Worth adding for typed-data helpers.

### Backend
- **`hono`** — already used in apps/api.
- **`ponder`** — already used in apps/ponder. Indexes
  `PositionOpened/Increased/Decreased/Closed`, `OrderPlaced/Filled`,
  `FundingPaid`, `Liquidated`, `CollateralDeposited`, `Borrowed`, `Repaid`,
  `ArcadeRoundSettled`.
- **`drizzle-orm`** — typed SQL on Postgres/Neon. Migrate off raw SQL in
  `packages/db/src/index.ts` when convenient.
- **`pg-boss`** or **`bullmq`** — background jobs (funding settlement, keeper
  checks, liquidation checks, oracle reconciliation, notification jobs).

### Financial math
- **`decimal.js`** or **`big.js`** — UI/backend decimal math.
- **`viem` bigint utilities** — onchain fixed-point.
- **`effect`** or **`neverthrow`** — safer order validation + risk checks.
- **Never use JS floats for money.** bigint/fixed-point on-chain, decimal at
  UI/API boundaries only.

Create `packages/perps-math` with: `calculateInitialMargin`,
`calculateMaintenanceMargin`, `calculateLiquidationPrice`,
`calculateUnrealizedPnl`, `calculateFundingPayment`, `calculateMaxLeverage`,
`calculateHealthFactor`, `calculateSlippage`, `calculatePriceImpact`.

### Order book UI
- **`@tanstack/react-virtual`** — virtualized rows. Apply deltas, do not
  re-render the whole book per tick.
- **`framer-motion`** (already in) — subtle row flash on price changes.
- **`react-number-format`** — formatted price/size inputs.
- **`use-debounce`** — quote requests on input change.

Order book normalized shape:
```ts
type OrderBookLevel = { price: string; size: string; total: string };
type OrderBookSnapshot = {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  sequence: number;
};
```

### Observability + safety
- **`sentry`** — frontend + backend errors.
- **`pino`** — structured backend logs (already have `packages/logger`).
- **`consola`** — pretty terminal logs in dev.
- **`zod`** — runtime validation everywhere. Already in.
- **`ts-pattern`** — clean state machines for order lifecycle.

Order lifecycle states:
```ts
type OrderState =
  | "created"
  | "quoted"
  | "signed"
  | "submitted"
  | "indexed"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "failed"
  | "reconciled";
```

This is the contract that prevents the race condition called out in bucket 4
(user signs intent → matcher fills → replacement agent re-prompts on stale
state). Reconciliation must consult `OrderState` before re-prompting.

---

## Critical path to MVP transactable

Minimum sequence to demo each surface on testnet with real on-chain state
visible. Order matters — earlier items unblock later ones.

1. **Perps positions visible after fill** — **SHIPPED** (Sprint A).
   `service.listPositions()` + `/perps/trades/:address` read Ponder via
   `PerpsPositionReader` / `perpsSettlementReader`. Smoke test packaged at
   `scripts/smoke-perps.ts`; live keeper-fed run still pending.
2. **Liveblocks auth route** (30 min CC)
   - `apps/web/app/api/liveblocks/auth/route.ts` — 4-line wrapper minting
     access tokens scoped to `arcade:fx-bento:{roomId}`.
3. **Bento commit-reveal binding** (4-6 hours CC)
   - Lift tile selection state from `ArcadeBoard` to `multiplayer.tsx`.
   - Per-round nonce generation.
   - Wire `useCommitSelectionPrepare` → `wagmi.sendTransaction`.
4. **Bento settlement persistence** (4 hours CC)
   - SQLite adapter for `FxBentoPersistenceStore` (interface exists in
     `packages/fx-bento/src/results.ts`).
5. **Bento "Claim prize" CTA** (1 hour CC)
   - Button on `RoundEnd` overlay using `getBentoClaim` proof.
6. **Telarana ponder handler** (1 day CC)
   - Wire 5 event handlers (`MarketRegistered`, `PositionOpened`,
     `PositionRepaid`, `PositionLiquidated`, `RatesUpdated`) to write
     `telarana_loan` rows.
7. **Address book reconciliation** (2 hours CC)
   - Single source of truth for contract addresses per chain. Canonical:
     `packages/contracts/src/perps-deployments.ts` for perps, `bento.ts` for
     bento, `telarana.ts` for telarana. Strip duplicates from
     `CONTRACTS[5042002].perps` in `src/index.ts`.
8. **Env validation** (0.5 day CC)
   - Zod-validated env at app startup; fail-fast on missing keys
     (`LIVEBLOCKS_SECRET_KEY`, `PONDER_API_URL`, chain RPCs, etc.).
9. **Smoke tests** (0.5 day CC)
   - One e2e per surface: open + close a perp, lend + withdraw, join + finish
     a round.

**Total: ~4-5 focused CC days + ~1 human day for infra/deploy.**

---

## Risk register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Ponder handler events don't fire on testnet (wrong addresses/ABIs) | Med | High | Manual event trace via `cast logs` before declaring done |
| Wallet session expires mid-trade; user thinks order failed | Med | Med | Refresh + retry on 401 in `client.ts` |
| Liveblocks free tier maxes out with concurrent rooms | Low | Med | Upgrade plan or fall back to polling-only |
| Address mismatch between manifests sends tx to dead contract | Med | High | Reconciliation step (item 7) is non-optional |
| Bento settlement merkle proof lost on restart | High in dev | Med | Persistence adapter (item 4) is non-optional for prod |
| Liquidation keeper missing on Telarana | Med | High | Stand up before mainnet, not before testnet |
| `/perps/quote/premium` uses x402 but UI doesn't pay | High | Low | Document; falls back to free quote |
| User double-prompted: original intent fills before replacement signs | Med | Med | Reconciliation at `/intents/:id/reconciliation` already exists; UI must consult before re-prompting |

---

## Sprint queue

### Sprint A — "Make perps positions visible" — **SHIPPED**

Landed in `codex/all-backends-integration`:
- `packages/perps/src/service.ts` — `PerpsPositionReader` interface +
  `positionReader` / `defaultChainId` options; `listPositions` reads through it
  and maps via `mapIndexedPositionToPerpQuote`.
- `apps/api/src/ponder-client.ts` — `createPonderPerpsPositionReaderFromEnv` /
  `createPonderPerpsPositionReader` GraphQL reader over `perpsPositions.items`.
- `apps/api/src/services.ts` — wires reader from env into `createPerpsService`.
- `apps/api/src/routes/perps.ts` — `/perps/trades/:address` reads from
  `perpsSettlementReader` (cross-market, trader-scoped, maker-OR-taker).
- `scripts/smoke-perps.ts` — signs intent, polls `/perps/positions/:address`.

Bucket #3 30% → 75%. Outstanding to reach 95%: true side derivation on trades
(`perpsPositionEvent` join), live `markPrice` + computed `unrealizedPnl`,
keeper-fed smoke test execution.

### Sprint B — "Bento finishes the game loop" — **SHIPPED**

- `apps/web/app/api/liveblocks/auth/route.ts` mints player-scoped tokens
  after verifying X-Wallet-* headers (#21 → 95%).
- `multiplayer.tsx` uses `buildSelectionCommitment` with per-round nonce
  cached in useRef — real tile-hash commit, not a placeholder (#18 → 90%).
- `useBentoClaim` hook + "Claim prize" CTA on RoundEndOverlay; wagmi
  broadcast + toast; Merkle proof + leaf + root surfaced (#19 → 85%, #22 → 85%).
- `createFxBentoSqlitePersistenceStore` (bun:sqlite, atomic txn, 2 tables)
  opt-in via `BENTO_DB_PATH` (#20 → 95%).

Remaining: live 2-player smoke run against testnet.

### Sprint C — "Operational readiness" — **PARTIALLY SHIPPED**

Shipped:
- `CONTRACT_ADDRESSES_JSON` parser + `getContractAddressOverride` helper +
  `AVALANCHE_FUJI_RPC_URL` / `ARC_TESTNET_RPC_URL` env vars (#24 → 80%).
- `@bufi/logger` middleware on every API route; per-request requestId +
  bound method/path; structured error + ok events (#27 → 70%).
- Sentry no-op scaffold for web + api; dynamic-import + DSN-gated, no
  forced dep until operator sets `SENTRY_DSN_*`.

Outstanding:
- One e2e smoke per surface in `scripts/` (perps already has
  `smoke-perps.ts`; need bento + telarana smokes).
- Human: deploy keepers (Railway/Fly/Render), Ponder (Railway + Neon), API
  (Vercel/Render).
- Single source of truth on address book is partial — overrides work, but
  `CONTRACTS[5042002].perps` in `src/index.ts` still has duplicates worth
  stripping.

### Sprint D — "Lightweight charts migration" — **SHIPPED**

Landed in `codex/all-backends-integration`:
- `apps/web/components/trade-island/chart.tsx` — full rewrite (220→387 LOC)
  on `lightweight-charts` v5 (`addSeries(CandlestickSeries|HistogramSeries|
  LineSeries)`). Design tokens mapped to series colors; `PriceLine` overlays
  for entry/liq/mark accept optional props.
- `packages/market-data/src/candles.ts` — new adapter exposing
  `getCandles({ source: 'mock'|'ponder'|'websocket', ... })`,
  `makeMockCandles`, `timeframeToSeconds`. Mock is deterministic hashed seed.
- `apps/web/css/trade-island/styles.css` — `.chart-ohlc-tooltip`
  (backdrop-blur, JetBrains Mono).
- `apps/web/package.json` — `@bufi/market-data: workspace:*`, `d3-array`,
  `@types/d3-array`.

Verified live at 1440×900: lightweight-charts canvas (684×376) rendering in
`.t-chart > .chart-card`, EUR/USD mark 1.0846, kawaii flag pair, no green/red
leakage. Bucket #6 0% → 80%. Outstanding to reach 100%: live PriceLines fed
by real position data (Sprint A reader now available), WebSocket source
finalisation (Sprint E).

### Sprint E — "Realtime hot path" (2-3 days CC)

Eventually:
- WebSocket server for OB deltas + candle ticks + trades + funding.
- `partysocket` on client.
- React Query cache invalidation on socket events.
- `@tanstack/react-virtual` for OB rows.
- Liveblocks scoped to Arcade + social only, not market data hot path.

### Sprint F — "Financial math package" (1 day CC)

Defensive but high-value:
- New `packages/perps-math/` with `decimal.js` + viem bigint helpers.
- Centralize all margin/PnL/liquidation calcs.
- `effect` or `neverthrow` Result types for validation.
- Migrate inline calcs in `panels.tsx`, `mobile-trade.tsx`, `loan.tsx`.

---

## Working agreements

- **Address book is the contract.** Any new deployment goes through
  `packages/contracts/src/{bento,telarana,perps-deployments}.ts`. No
  hardcoded addresses in components or API handlers.
- **Profit colors are purple, loss colors are yellow.** Never green/red.
  This is the most distinctive brand decision; preserve everywhere.
- **Hooks own server state, Zustand owns form state, contracts own truth.**
  When in doubt about where state lives: if it's data the backend can
  recompute, it goes in React Query; if it's a UI choice the user is making
  right now, it goes in Zustand; if it's the canonical state of a position
  or order, it lives on-chain and is read via Ponder.
- **No JS floats for money, ever.** bigint on-chain, decimal at boundaries.
- **Every signed intent gets an order-state lifecycle.** Use the 10-state
  enum above. Reconcile before re-prompting.
- **Each surface has one canonical hook entrypoint.** `useMarkets`,
  `usePositions`, `useLendingAction`, `useBentoRooms` — components do not
  call `fetch` directly.

---

## When this doc goes stale

Update the scorecard when a bucket moves more than 10 percentage points.
Update the sprint queue when a sprint ships or scope shifts. Update the
stack section when a new library is adopted. The doc is reference for
every future agent dispatch — if it lies, the next sprint costs more.
