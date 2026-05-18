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
| 3 | Perps — indexer → API reads | 30 | `MatchSettled` handler exists; `/positions`, `/trades` return `[]` | **Yes** |
| 4 | Perps — frontend wiring | 95 | Long/Short signs + posts intent, hooks ready | None |
| 5 | Perps — order book / chart live data | 5 | Mock only | No (UX works) |
| 6 | Perps — chart engine swap to lightweight-charts | 0 | Custom canvas in place | No (perf-only, see Sprint D) |
| 7 | Telarana — contracts | 100 | Deployed Fuji + Arc | None |
| 8 | Telarana — SDK + math | 95 | quote/health/oracle real | None |
| 9 | Telarana — backend routes | 80 | All endpoints wired | None |
| 10 | Telarana — indexer (loan events) | 5 | Schema only | Yes for history; no for "open loan" |
| 11 | Telarana — frontend wiring | 90 | Lend/Borrow/Withdraw/Repay sign + post | None |
| 12 | Telarana — liquidation keeper | 0 | Not implemented | No for MVP; yes for prod |
| 13 | Telarana — oracle staleness UX | 30 | SDK throws; UI swallows | No |
| 14 | Bento — contracts | 100 | 9 contracts deployed Arc + Fuji | None |
| 15 | Bento — game engine + TX builders | 95 | Full port, simulator, Merkle tree | None |
| 16 | Bento — backend API | 90 | All routes ported | None |
| 17 | Bento — frontend Lobby + Join | 90 | Live rooms, calldata + tx broadcast | None |
| 18 | Bento — commit-reveal UI binding | 40 | Hooks exported; not wired to tiles | **Yes** |
| 19 | Bento — claim flow UI | 20 | Endpoint exists; no "Claim prize" CTA | Yes for finalised |
| 20 | Bento — settlement persistence | 30 | In-memory only | Yes for prod |
| 21 | Bento — Liveblocks presence | 60 | Client ready; `/api/liveblocks/auth` missing | **Yes** for multiplayer feel |
| 22 | Bento — merkle proof verification | 60 | Tree built backend; UI doesn't surface proof | Yes |
| 23 | Cross — wallet session auth | 85 | Works across surfaces; 3 patterns to unify | No |
| 24 | Cross — env/secrets/addresses | 40 | Hardcoded fallbacks + partial CONTRACT_ADDRESSES_JSON | Yes for prod |
| 25 | Cross — ponder schema + handlers | 35 | Schema solid; handlers mostly stubs | Yes |
| 26 | Cross — error recovery + retry | 30 | Best-effort; no idempotency keys | Yes for prod trust |
| 27 | Cross — observability | 10 | console.warn + toast | No for MVP |
| 28 | Cross — testing | 25 | Unit in packages/perps; no e2e per surface | Recommended |
| 29 | Cross — deployment | 50 | Web/API individually deployable; keepers need infra | Yes for prod |
| 30 | Cross — financial math package | 0 | Inline calc in components | No for MVP; yes for safety |

**Overall: ~62%.**

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

1. **Perps positions visible after fill** (1 day CC)
   - Wire `service.listPositions()` to read from `perpPositions` snapshot store.
   - Wire `/perps/trades/:address` to read from `perpsSettlement` indexer table.
   - Confirm ponder handler upserts on `PositionIncreased`/`PositionDecreased`.
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

### Sprint A — "Make perps positions visible" (1 day CC)

Highest leverage. Trade is the most visible surface; right now it's deceptively
dead (you can place an order, can't see it confirm).

Tasks:
- Replace `service.listPositions()` stub at `packages/perps/src/service.ts:289`
  to read from `TradingMachineReadStore.perpPositions(trader)`.
- Replace `/perps/trades/:address` stub at `apps/api/src/routes/perps.ts:195`
  to read from `perpsSettlementReader` (ponder).
- Verify ponder handler upserts at `apps/ponder/src/handlers/perps.ts` by
  triggering a settlement on testnet and checking the DB row appears.
- Smoke test: place a small Long on EUR/USD, confirm position row renders.

### Sprint B — "Bento finishes the game loop" (1.5 days CC)

Most distinctive product feature; biggest UX wow.

Tasks:
- `apps/web/app/api/liveblocks/auth/route.ts` (30 min).
- Lift tile selection from `ArcadeBoard` to `multiplayer.tsx` (2 hours).
- Per-round nonce + commit-reveal wiring (2 hours).
- SQLite adapter for `FxBentoPersistenceStore` (4 hours).
- "Claim prize" CTA on `RoundEnd` overlay using `getBentoClaim` proof (1 hour).
- Smoke test: 2 players join, commit, reveal, settle, claim.

### Sprint C — "Operational readiness" (1 day CC + 1 day human)

Lower flash, higher production safety.

Tasks:
- Address book reconciliation (2 hours).
- Zod env validation in `apps/web/lib/env.ts` and `apps/api/src/env.ts`
  (0.5 day).
- Sentry frontend + backend with structured logger from `packages/logger`
  (0.5 day).
- One e2e smoke test per surface in `scripts/` (0.5 day).
- Human: deploy keepers (Railway/Fly/Render), Ponder (Railway + Neon), API
  (Vercel/Render).

### Sprint D — "Lightweight charts migration" (1-1.5 days CC)

Performance + indicator overlays without disturbing layout.

**Spec:**
- Replace `apps/web/components/trade-island/chart.tsx` (custom canvas) with
  `lightweight-charts`-backed component.
- Preserve current pastel/kawaii FX styling. Map design tokens
  (`--profit: #a89ce8`, `--loss: #ffecb4`, `--primary: #6954CF`, etc.) into
  `LineStyle`, `CandlestickSeries` colors, grid colors. No green/red.
- Series to support:
  - `CandlestickSeries` — primary OHLC.
  - `HistogramSeries` — volume below candles.
  - `LineSeries` — oracle/mid price overlay.
  - `PriceLine` overlays — liquidation price (user-position), entry price
    (user-position), mark price, oracle price band, funding window markers.
- Typed market data adapter (`packages/market-data/src/candles.ts`) so candles
  can come from:
  - Mock generator (current `makeCandles()` in `data.tsx`).
  - Ponder API (`GET /perps/candles/:marketId?tf=15m`).
  - WebSocket stream (Sprint when realtime ships).
- Do NOT change the surrounding layout (`.mt-chart-wrap`, `.chart-area`,
  responsive breakpoints) — chart component is a drop-in.
- Pass mobile-trade tab integration: chart fills ~58% of viewport, no
  regressions on iPad portrait or desktop 3-col Trade layout.
- Reuse existing timeframe selector (`1m / 5m / 15m / 1H / 4H / 1D`).
- Hover crosshair shows OHLC + volume + funding values in the existing
  `.chart-substats` row pattern.
- Add `d3-array` for depth math and order-book overlays if Sprint E expands.

**Deps to add:**
- `lightweight-charts` (~45kb, Apache-2.0)
- `d3-array` (small subset only)
- `date-fns` (already in workspace? confirm)

**Verification:**
- `bunx tsc --noEmit -p apps/web/tsconfig.json` clean.
- `/browse` screenshots at 375 / 768 / 1440 viewports — chart present, no
  layout regression.
- Mock data renders correctly at all 6 timeframes.
- Brand colors preserved (no green/red leaking from default lightweight-charts
  theme).

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
