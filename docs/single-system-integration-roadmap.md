# Single-system integration roadmap — BUFX + matcher + defi-web-app

**Goal:** One `bun run dev:complete` boots the whole stack (apps/api,
apps/web, apps/ponder, Rust matcher, all keepers) on a developer's
localhost, talking to live Arc Testnet + Fuji contracts. End-user-visible
surfaces: spot FX (BUFX) + perp orderbook (matcher). One shared SQLite +
Ponder DB. One `.env.local`. Three signing-key EOAs (keeper / lp_operator /
canary), one shared Pyth oracle pusher.

**Audience:** matcher lead + fx-telarana owner + frontend owner. Read
top-to-bottom; each phase has a single owner and a single concrete exit
criterion.

**Status:** Draft v1, 2026-05-23. Locks the sequence; phase-by-phase
detail lands in companion design docs.

---

## 0 — Where we are today (post-PR #107)

| Surface | State | Owner | Notes |
|---|---|---|---|
| **Matcher (Rust)** | PR #107 open against `defi-web-app:main` | matcher lead | Phases 0–7.1 shipped, runs against Arc, blocked on F3 for LP-backstop end-to-end |
| `services/matcher/` in monorepo | ✅ (in PR #107) | matcher lead | Already at `services/matcher/`; lands on merge |
| fx-telarana sprint-1 perp stack | ✅ live on Fuji + Arc | fx-telarana owner | Addresses pinned in `~/coding-dojo/fx-telarana/deployments/perp-stack-*.json` |
| BUFX venue + telarana routers | ✅ live on Fuji + Arc | BUFX owner | `BuFxVenueRequestRouter`, `BuFxTelaranaRequestRouter` deployed both chains; v0.1 audit-fix smoke passed |
| Ponder indexes BUFX | ✅ wired | ponder owner | `apps/ponder/src/handlers/bufx.ts` — venue + telarana events flow to `bufxRequest` table |
| Ponder indexes perp settlement | ✅ wired | ponder owner | `apps/ponder/src/handlers/perps.ts` (existing) |
| BUFX SDK + ABIs | ✅ vendored | BUFX owner | `packages/contracts/src/abis/BuFx*.ts` exported |
| `apps/api/bufx` routes | ❌ not built | api owner | no HTTP surface for BUFX spot intent submission yet |
| `apps/web` spot FX UI | ❌ not built | frontend owner | no user-facing spot FX page; perp UI exists partial |
| BUFX → matcher bridge | ❌ not built | matcher lead + BUFX owner | `BuFxPerpLiquidityAccepted` event indexed but no consumer; this is the "perp-liquidity request layer" BUFX promises |
| `apps/keeper-pyth` | 🟡 stub | infra owner | Fetches Hermes payloads, never pushes. Has to be filled before BUFX FxSpotExecutor + matcher LP backstop work on Arc |
| Rust matcher in `bun run dev:complete` | ❌ | matcher lead | turbo `--filter` only sees `package.json`; matcher has none today |

**F3 unification:** the missing Pyth pusher is the same gap on both sides.
`FxOracle.getMid` (matcher LP) and `FxSpotExecutor` (BUFX) both depend on
fresh Pyth feeds. Solving it once unblocks both.

---

## 1 — Architecture target

```
┌──────────────────────────────────────────────────────────────────────┐
│                     defi-web-app monorepo                             │
│                                                                       │
│  apps/web ────► apps/api ─────────┬──► perp_order_intents (SQLite)   │
│  (spot UI +   (bufx + perps      │     ↑                              │
│   perp UI)     routes)            │     │ poll                        │
│                                   │     ▼                              │
│                                   │   services/matcher (Rust binary)  │
│                                   │     │                              │
│                                   │     ├─► settleMatch ──► FxOrderSettlement
│                                   │     ├─► funding poke ──► FxFundingEngine
│                                   │     └─► canary keeper              │
│                                   │                                    │
│                                   └──► BuFxVenueRequestRouter ──► CCTP/Hyperlane
│                                              │                         │
│                                              ▼                         │
│                                      BuFxTelaranaRequestRouter         │
│                                              │                         │
│                                              ▼                         │
│                                      FxSpotExecutor (executes spot FX) │
│                                                                       │
│  apps/ponder ──► indexes BOTH BUFX + perp settlement events           │
│                  (writes to bufxRequest + perp_fills tables)          │
│                                                                       │
│  apps/keeper-liquidator ──► FxLiquidationEngine (TS, kept)            │
│  services/matcher::pyth_pusher ──► Pyth.updatePriceFeeds (NEW)        │
│      ↑ unblocks both BUFX (FxSpotExecutor) and matcher (LP gate)      │
└──────────────────────────────────────────────────────────────────────┘
```

Three signing-key EOAs, one optional fourth:
- `PERP_KEEPER_PRIVATE_KEY` — settleMatch + funding poke + Pyth push (Phase 7.2 can reuse)
- `LP_OPERATOR_PRIVATE_KEY` — synthetic LP signed orders
- `CANARY_TRADER_PRIVATE_KEY` — liveness probe
- (`BUFX_KEEPER_PRIVATE_KEY` — if BUFX's executor wants its own EOA, future)

One shared SQLite, one shared Postgres (for Ponder), one shared `.env.local`.

---

## 2 — Sequencing (calendar weeks)

### Week 1 — F3 unblock + matcher monorepo integration

**Owner: matcher lead.** No frontend work; no contract changes. Pure
backend + DevOps.

#### 1.1 — Phase 7.2: `pyth_pusher` in matcher-server

- **Goal:** make `FxOracle.getMid` reliably return fresh data on Arc, so
  both the matcher's LP gate AND BUFX's `FxSpotExecutor` can read it
  without `CalldataMustHaveValidPayload` reverts.
- **Where:** new `crates/matcher-server/src/pyth_pusher.rs` module,
  spawned alongside `funding_poker` under `tokio::select!` in `main.rs`.
- **Pattern:** mirror `funding_poker` — per-market throttle, in-memory
  state, `seed_from_chain()` reads the current Pyth on-chain `publishTime`
  at boot so we don't re-push immediately after restart.
- **Hermes client:** vendor or call directly via `reqwest` against
  `https://hermes.pyth.network/api/latest_vaas?ids[]=<feed_id>`. Returns
  base64 VAAs; concatenate + ABI-encode for `Pyth.updatePriceFeeds`.
- **Feeds to push:** read from `MATCHER_FUNDING_MARKET_IDS` env (already
  wired); resolve each market → baseToken → `FxOracle.pythFeedOf` →
  Hermes feed id. Cache the (market_id → feed_id) map at boot.
- **Cadence:** every `PYTH_PUSH_INTERVAL_MS` (default 5_000 = 5s). Skip
  push if on-chain `publishTime + 30s > now`.
- **Cost:** Pyth charges a small fee in native gas per feed update. Arc
  uses USDC as native gas — confirm the keeper has USDC headroom.
- **Tests:** unit-test the Hermes payload parser; integration-test the
  per-market throttle (no double-push within window).
- **Exit:** `cargo test --workspace` green; matcher boots; oracle gate
  succeeds on Arc; the LP-backstop smoke from
  `docs/matcher-integration-runbook.md` §5.6 passes end-to-end.

#### 1.2 — Add matcher to `bun run dev:complete`

- **Goal:** one `bun run dev:complete` launches the matcher alongside
  apps/api, apps/web, apps/ponder, and the kept TS keepers.
- **Approach:** add `services/matcher/package.json` (workspace shim):
  ```json
  {
    "name": "@bufi/matcher",
    "private": true,
    "scripts": {
      "dev": "cargo run --release -p bufi-matcher-server --bin bufi-matcher",
      "build": "cargo build --release --workspace",
      "test": "cargo test --workspace"
    }
  }
  ```
- Update root `package.json` `dev:complete` to include the matcher (or
  rely on `bun run --filter './apps/*' --filter './services/*' dev`).
- Add a `prebuild` step that confirms `cargo` is on PATH and runs
  `cargo build --release` once before the first `dev` invocation.
- **Operator note:** the matcher binary takes ~30-60s to first-build on
  a clean checkout. Cache it in CI; surface a `bun run setup` script
  that builds it once.
- **Exit:** fresh clone + `bun install && bun run setup && bun run dev:complete`
  boots the whole stack; matcher logs interleave with TS app logs in
  the same terminal.

#### 1.3 — Decommission `apps/keeper-pyth` (or scope-cut it)

- The TS stub at `apps/keeper-pyth/src/index.ts` is a placeholder for
  exactly the Rust pyth_pusher we're building. After 1.1 lands, either:
  - **Delete** `apps/keeper-pyth/` (and the root `keeper:pyth` script), or
  - **Repurpose** as a TS Hermes-only fallback for the BUFX team (no
    on-chain push).
- Decision: matcher lead + BUFX owner pick at end of week 1.

**Week 1 exit criteria:**
- ✅ F3 resolved on Arc — both matcher LP-backstop and BUFX FxSpotExecutor work without manual Pyth pushes
- ✅ `bun run dev:complete` boots the matcher
- ✅ PR #107 merged; matcher lives at `services/matcher/` on main
- ✅ `apps/keeper-pyth` decision committed

---

### Week 2 — BUFX → matcher bridge + frontend surface

**Owners: matcher lead + BUFX owner + frontend owner (parallel).** This
is where BUFX and the matcher become a **single perp-liquidity venue**
instead of two independent systems.

#### 2.1 — BUFX `BuFxPerpLiquidityAccepted` → matcher consumer

- **Goal:** when BUFX accepts a "perp liquidity injection" request
  (`BuFxPerpLiquidityAccepted` event), the matcher picks it up and
  routes it through the orderbook + LP backstop, instead of just
  indexing it into `bufxRequest` for the dashboard.
- **Decision needed first (BUFX owner):** does the BUFX perp-liquidity
  request:
  - (a) carry its own EIP-712 SignedOrder that the matcher just settles, OR
  - (b) carry the trader + market + size, and the matcher synthesizes a
    SignedOrder on its behalf using a 5th EOA (`BUFX_RELAY_PRIVATE_KEY`)?
  - Recommendation: (a) — keeps the matcher dumb, BUFX owns the trader-
    intent shape, no new signing key.
- **Where (matcher side):** new poller in `matcher-server` that reads
  rows from the Ponder DB (Postgres) `bufx_request` table where
  `status = 'perp_accepted'`, translates to `perp_order_intents` (same
  table the API uses), and lets the existing tick loop pick them up.
- **Where (BUFX side):** confirm `BuFxPerpLiquidityAccepted` emits enough
  data to reconstruct an EIP-712 SignedOrder. If not, contract amendment
  needed first.
- **Exit:** a BUFX perp-liquidity request submitted via
  `BuFxVenueRequestRouter` on Arc gets matched + settled by the matcher
  within one tick, observable in both the matcher logs and the perp UI.

#### 2.2 — `apps/api/bufx/*` routes

- **Goal:** HTTP surface for the frontend to submit BUFX spot FX
  intents. Wraps `BuFxVenueRequestRouter.requestSpotFx` via the SDK.
- **Endpoints:**
  - `POST /api/bufx/spot-fx` — submit a spot FX intent (signs + relays)
  - `POST /api/bufx/rfq` — submit an RFQ
  - `GET /api/bufx/request/:requestId` — read status from Ponder
  - `GET /api/bufx/quotes?pair=EURC/USDC` — read latest Pyth-based quote
- **Reuse:** the BUFX SDK at `packages/contracts/` already has the ABI +
  helpers. API layer is mostly request validation + relay.
- **Exit:** `curl POST /api/bufx/spot-fx` from local API submits a Fuji
  request, indexed by Ponder within 30s, reaches `gateway_prepared`
  status on Arc within 5 minutes.

#### 2.3 — `apps/web` spot FX UI

- **Goal:** user-facing spot FX swap page. Pair selector (EURC/USDC, etc),
  amount input, quote preview (live Pyth via the API), submit button.
- **Reuses:** Dynamic.xyz wallet connection (already wired); BUFX SDK
  for request construction; new `useBufxQuote` hook calling
  `/api/bufx/quotes`.
- **Layout:** new `/app/spot` route alongside the existing `/app/perps`.
  Top-level nav shows both venues with the user's open positions per side.
- **Exit:** Connect wallet → select EURC/USDC pair → enter 1 USDC →
  preview shows ~0.86 EURC → submit → tx appears in MetaMask → request
  shows up in the dashboard within 30s.

#### 2.4 — Unified perp UI status events

- **Goal:** the perp UI currently inserts intents but doesn't show
  matcher-side state (matched, settled, rejected, replacement-needed).
  Hook into the matcher's emit-event surface.
- **Reuse:** the matcher already emits `bufx.perps.replacement_needed`
  domain events to a Postgres table; API exposes via SSE; web subscribes.
  Most of this exists — wire the consumer.
- **Exit:** a user submitting a perp intent sees status transitions
  (`pending → matched → settled` or `pending → expired`) within 10s.

**Week 2 exit criteria:**
- ✅ BUFX perp-liquidity requests reach the matcher and settle
- ✅ Spot FX UI submits real Fuji→Arc swaps
- ✅ Perp UI shows real-time matcher status
- ✅ One user wallet can use both spot + perp on one logged-in session

---

### Week 3+ — Hardening + audit-prep (out of scope for this roadmap)

Below the line, captured here so the reader sees what's NOT in week 1-2:

- **Mainnet-readiness rows** still ⬜ in `docs/matcher-mainnet-readiness.md`
  (e.g. §3.5 fill durability, §4.3 LP TVL reconciliation, §4.5 IF burn
  floor, §6.2 OTEL exporter).
- **Audit-prep proptest sweep** (`PROPTEST_CASES=10000`).
- **Sign-off signatures** (§10).
- **Path B `FxPerpLpVault`** Solidity work and audit.
- **Cross-margin** between perp markets (explicitly out of v1 per spec).
- **Mobile / responsive UI** for the spot + perp surfaces.

---

## 3 — Risks + sequencing rationale

### Why F3 first
The Pyth pusher unblocks BOTH the matcher's LP backstop AND BUFX's spot
FX execution. Without it, neither can run autonomously on Arc. Anything
else built on top hides the same bug. Highest leverage.

### Why bridge before frontend
The BUFX → matcher bridge proves the "single venue" hypothesis. If
`BuFxPerpLiquidityAccepted` can't reconstruct a SignedOrder (contract
amendment needed), the frontend's "perp liquidity via BUFX" surface
doesn't exist yet — better to know in week 2 than week 4.

### Why monorepo integration in week 1
A developer who can't `bun run dev:complete` to see the matcher running
will silently skip integration testing. Putting the matcher on the same
dev launcher as everything else makes "I broke the matcher" an obvious
red banner, not a discovered-three-days-later regression.

### Risk: Pyth fee on Arc Testnet
Arc uses USDC as native gas. The Pyth push fee is small but accumulates
over 5-second cadence × N markets. Confirm KEEPER USDC headroom before
shipping 1.1.

### Risk: BUFX `BuFxPerpLiquidityAccepted` event shape
If the event doesn't carry enough data to reconstruct a SignedOrder
(specifically: nonce, deadline, maxFee, signature), week 2.1 stalls on a
contract amendment. **Mitigation:** matcher lead + BUFX owner read the
event ABI together in week 1 to confirm before week 2 starts.

### Risk: SQLite under cross-process write contention
matcher + apps/api + Ponder reconciler all write the same SQLite file
today. SQLite's WAL handles concurrent reads fine but write-write
conflicts return `BUSY` errors. Mitigation already in matcher's
`record_fill` (uses transactions); confirm Ponder + apps/api do the
same. If contention shows up, the Phase 5+ Postgres migration is the
real fix (already on a branch per `feat/wk1j-db-postgres-ready`).

---

## 4 — Single-system .env.local (target)

After week 1, one file at `~/coding-dojo/defi-web-app/.env.local`
configures everything:

```bash
# --- Chains + RPCs ---
ARC_RPC_URL=https://rpc.testnet.arc.network
AVALANCHE_FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc

# --- Three signing EOAs (boot fails fast on collision) ---
PERP_KEEPER_PRIVATE_KEY=0x...    # SETTLER_ROLE on FxOrderSettlement, also pushes Pyth
LP_OPERATOR_PRIVATE_KEY=0x...    # synthetic LP signed orders
CANARY_TRADER_PRIVATE_KEY=0x...  # liveness probe

# --- Shared DB ---
BUFI_DB_PATH=/Users/<you>/coding-dojo/defi-web-app/.bufi/trading-machine.sqlite

# --- Deployment manifest source ---
FX_TELARANA_DEPLOYMENTS=/Users/<you>/coding-dojo/fx-telarana/deployments
BUFX_DEPLOYMENTS=/Users/<you>/coding-dojo/BUFX/deployments/testnet

# --- Frontend ---
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID=<your dynamic env id>

# --- Ponder (Postgres) ---
DATABASE_URL=postgres://postgres@localhost:5432/bufi
PONDER_BUFX_START_BLOCK_FUJI=<sprint-1 deploy block>
PONDER_BUFX_START_BLOCK_ARC=<sprint-1 deploy block>

# --- Matcher tunables (defaults work for testnet) ---
MATCHER_CHAIN_ID=5042002
PYTH_PUSH_INTERVAL_MS=5000
CANARY_INTERVAL_SECS=1800
FUNDING_POKE_MIN_INTERVAL_MS=3600000
```

---

## 5 — Sign-off

Three reviewers needed before this roadmap is treated as committed:

| Role | Reviewer | Status |
|---|---|---|
| Matcher lead | TBD | ⬜ |
| BUFX owner | TBD | ⬜ |
| Frontend owner | TBD | ⬜ |

Once all three sign off, week 1 work begins.
