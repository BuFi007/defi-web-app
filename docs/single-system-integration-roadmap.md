# Single-system integration roadmap — BUFX + matcher + defi-web-app

**Goal:** One `bun run dev:complete` boots the whole stack (apps/api,
apps/web, apps/ponder, Rust matcher, all keepers) on a developer's
localhost, talking to live Arc Testnet + Fuji contracts. End-user-visible
surfaces: spot FX (in-Trade-UI lev=1 + BUFX cross-chain) + perp orderbook +
lend/borrow + arcade.

**Audience:** matcher lead + fx-telarana owner + BUFX owner + frontend owner.

**Status:** Draft v2 — corrected 2026-05-23 after reading the actual
frontend + API code. v1 incorrectly assumed the Trade UI didn't exist;
it does, and most integration surfaces are already wired.

---

## 0 — What's actually built (audited 2026-05-23)

| Surface | State | Notes |
|---|---|---|
| **Trade UI** (Spot + Perp) | ✅ `apps/web/components/trade-island/panels.tsx` | One panel, leverage slider Spot→100x. "Spot" = `leverage=1`. Buy/Sell labels swap to Long/Short above lev=1. |
| **`usePlaceOrder` hook** | ✅ `apps/web/lib/perps/hooks.ts` | wagmi `useSignTypedData` over EIP-712 (`TelaranaFxOrderSettlement` domain), POSTs to `/perps/intents`. |
| **`/perps/intents` API route** | ✅ `apps/api/src/routes/perps.ts` | Handles BOTH spot (lev=1) AND perp (lev≥2). Writes to `perp_order_intents` SQLite table. |
| **`/spot/intents` API route** | ✅ `apps/api/src/routes/spot.ts` | Separate cross-chain BUFX venue flow via `@bufi/fx-spot`. Builds `BuFxVenueRequestRouter` calldata. NOT used by the Trade UI panel. |
| **MCP tool surface** | ✅ `apps/api/src/routes/mcp.ts` | `bufx.intent.spot` / `bufx.intent.perp.open` / `bufx.intent.perp.replace` / `bufx.quote.*` / `bufx.preview.borrow` / `bufx.bento.room.create` |
| **Loan/Borrow UI** | ✅ Morpho markets on Fuji (EURC/USDC, MXNB/USDC, etc.) | Visible in the Loan/Borrow tab |
| **Positions / Leaderboard / History / ARCADE** | ✅ Built | Per the screenshots |
| **BUFX venue + telarana routers** | ✅ Live on Fuji + Arc | Phase A v0.1 audit-fix smoke passed (`fuji-usdc-to-arc-eurc`, applied mid 0.860746) |
| **BUFX SDK + ABIs vendored** | ✅ `packages/contracts/src/abis/BuFx*.ts` | Already exported |
| **Ponder indexes BUFX events** | ✅ `apps/ponder/src/handlers/bufx.ts` | `bufxRequest` table fed by venue + telarana router events |
| **Ponder indexes perp settlement** | ✅ existing | `perp_fills` etc |
| **fx-telarana sprint-1 perp stack** | ✅ live on Fuji + Arc | Addresses in `~/coding-dojo/fx-telarana/deployments/perp-stack-*.json` |
| **Rust matcher (Phases 0–7.1)** | ✅ PR #107 open | Verified live boot on Arc Testnet 2026-05-23 |
| **Rust matcher in `bun run dev:complete`** | ❌ no `package.json` shim | turbo `--filter` only sees workspace members |
| **F3 — Pyth pusher (LP gate + BUFX FxSpotExecutor)** | 🔴 unresolved | `apps/keeper-pyth` exists as TS stub but never pushes; Rust pyth_pusher chosen for Phase 7.2 |

### The integration is mostly already done

Trade UI → API → matcher works end-to-end. I verified live: matcher
booted, picked up an intent (canary's), exercised the LP route, tried
to read FxOracle (hit F3). The only path-of-execution gaps are:

1. **F3 / Phase 7.2** — `FxOracle.getMid` reverts on Arc when Pyth feeds
   aren't fresh. Blocks matcher LP-backstop end-to-end. Same root cause
   blocks BUFX `FxSpotExecutor` when someone tries to settle a BUFX
   cross-chain spot request without the smoke script's manual Pyth push.
2. **Monorepo boot** — `bun run dev:complete` doesn't include the
   matcher, so a fresh checkout developer can't see the system run end
   to end without manually launching the Rust binary.
3. **Trade UI ↔ live matcher status loop** — UI submits intents and the
   matcher settles them, but the UI's "Pending Intents" column doesn't
   yet show post-match transitions (matched/settled/expired) because the
   replacement-events stream hasn't been hooked into the UI subscription.

Everything else (BUFX UI, BUFX routes, MCP, Ponder, lending) is already
wired and works on its own surface today.

---

## 1 — Architecture (current reality)

```
┌─────────────────────────── defi-web-app monorepo ────────────────────────────┐
│                                                                              │
│  apps/web Trade UI ──► usePlaceOrder ──► /perps/intents ──► perp_order_intents
│  (Spot + Perp,                                                       │       │
│   leverage slider)                                                   │       │
│                                                                      ▼       │
│                                                       Rust matcher (services/)
│                                                          │  (PR #107)        │
│                                                          ├─► settleMatch     │
│                                                          ├─► funding poke    │
│                                                          ├─► canary          │
│                                                          └─► [Phase 7.2]    │
│                                                              pyth_pusher     │
│                                                                              │
│  apps/web (other surfaces) ──► /spot/intents ──► BuFxVenueRequestRouter      │
│                                                  │                           │
│                                                  ▼ CCTP / Hyperlane          │
│                                            BuFxTelaranaRequestRouter         │
│                                                  │                           │
│                                                  ▼ on destination chain      │
│                                            FxSpotExecutor (reads Pyth) ──────┘
│                                                  ▲
│                                                  │ needs fresh Pyth
│                                                  │
│  services/matcher::pyth_pusher (Phase 7.2) ──► Pyth.updatePriceFeeds         │
│      ↑ unblocks BOTH matcher LP gate AND BUFX FxSpotExecutor                 │
│                                                                              │
│  apps/ponder ──► indexes BUFX request events + perp settlement events        │
│  apps/keeper-perps-liquidator ──► FxLiquidationEngine (TS, kept)             │
│  apps/keeper-pyth ──► TS stub, decommission after Phase 7.2 lands            │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Key insight:** in the Trade UI, "Spot" is just `leverage=1` through the
perp orderbook/clearinghouse path. The position has no funding cost (no
leverage means no leveraged-funding accrual) but otherwise uses the same
matcher + settleMatch + clearinghouse flow as a leveraged perp. The
matcher doesn't need to know whether it's "spot" or "perp" — same code
path.

The **separate** BUFX `BuFxVenueRequestRouter` flow is for **cross-chain
spot FX** (Fuji USDC → Arc EURC) where the user originates a request on
the home chain and gets the destination asset delivered after CCTP +
Telarana hub execution. This is a different surface (not the Trade
panel), and it already works.

---

## 2 — Sequencing (revised — much smaller than v1 claimed)

### Step 1 — `bun run dev:complete` boots the matcher (1 day)

**Owner:** matcher lead.

#### 1.1 — `services/matcher/package.json` workspace shim

```json
{
  "name": "@bufi/matcher",
  "private": true,
  "scripts": {
    "dev": "cargo run --release -p bufi-matcher-server --bin bufi-matcher",
    "build": "cargo build --release --workspace",
    "test": "cargo test --workspace",
    "clippy": "cargo clippy --all-targets -- -D warnings"
  }
}
```

#### 1.2 — Root `package.json` updates

- Add `services/matcher` to the bun workspace `workspaces` array (or the
  root `bun --filter` pattern in `dev:complete`).
- Add `bun run setup` script that runs `cd services/matcher && cargo build --release` once. Document in README.

#### 1.3 — Operator note (logging interleave)

Rust matcher emits JSON logs; TS apps emit pretty logs. Either:
- Add a `--log-format=pretty` flag to matcher-server, or
- Document piping through `jq` in the README.

**Exit:** fresh clone → `bun install && bun run setup && bun run dev:complete`
boots the whole stack including the matcher; an intent submitted via the
Trade UI shows up in the matcher logs and reaches `filled` status (for a
non-LP CLOB match).

### Step 2 — Phase 7.2 pyth_pusher (1–2 days)

**Owner:** matcher lead.

#### 2.1 — `crates/matcher-server/src/pyth_pusher.rs`

Mirror `funding_poker` pattern:
- Per-market throttle (default push every 5s)
- `seed_from_chain()` reads current Pyth on-chain `publishTime` at boot
- Hermes payload fetch via `reqwest` against `https://hermes.pyth.network/api/latest_vaas?ids[]=<feed_id>`
- Base64 VAA decode → concat → ABI-encode for `Pyth.updatePriceFeeds`
- Skip push if on-chain `publishTime + 30s > now`

#### 2.2 — Env config

```bash
PYTH_PUSH_INTERVAL_MS=5000         # cadence
PYTH_PUSH_MAX_AGE_SECS=30          # skip if fresh
PYTH_PUSHER_PRIVATE_KEY=<optional> # defaults to PERP_KEEPER_PRIVATE_KEY
```

#### 2.3 — Tests

- Unit-test Hermes payload parser
- Integration-test the per-market throttle (no double-push)
- Live-arc-testnet `#[ignore]` test that exercises one real push

#### 2.4 — Decommission `apps/keeper-pyth`

After Phase 7.2 ships, delete the TS stub or repurpose as a Hermes-only
mirror for the BUFX team. matcher lead + BUFX owner pick.

**Exit:** matcher's LP-backstop smoke (runbook §5.6) succeeds end-to-end
on Arc without manual Pyth pushes.

### Step 3 — Trade UI ↔ matcher status loop (1 day)

**Owner:** frontend owner.

The matcher already emits `bufx.perps.replacement_needed` domain events
when a partial fill needs a replacement intent. The API can serve these
via SSE; the Trade UI's `usePlaceOrder` result page should subscribe and
show transitions: `pending → matched → settled` or `pending → expired`.

This is glue, not new work. Likely 4–6 hours.

**Exit:** a user-submitted intent visibly transitions through statuses
in the UI without a page refresh.

### Step 4 — BUFX `BuFxPerpLiquidityAccepted` consumer (OPTIONAL, 2–3 days)

**Owner:** matcher lead + BUFX owner.

This is the "perp-liquidity injection" surface BUFX promises. It's
already indexed (Ponder); nothing consumes it. Whether to build the
consumer NOW or defer depends on whether anyone's submitting
`BuFxPerpLiquidityAccepted` requests today.

If yes: build the consumer (matcher reads `bufxRequest` rows where
`status = 'perp_accepted'`, translates to `perp_order_intents`, tick loop
picks them up).

If no: defer until a real user shows up wanting that path.

**Recommendation:** defer until a stakeholder asks for it. The Trade UI
serves spot + perp without needing this bridge.

---

## 3 — Risk + sequencing rationale (revised)

### Why monorepo boot first
Without `bun run dev:complete` including the matcher, every other
integration step needs the developer to remember to manually launch the
matcher binary. That's the kind of friction that silently breaks
integration testing. Putting it on the same dev launcher as everything
else is highest leverage per hour.

### Why Phase 7.2 second
Unblocks the matcher's LP-backstop on Arc. Also unblocks BUFX
`FxSpotExecutor` if/when the BUFX cross-chain spot flow is exercised on
Arc (today it's a smoke-script-driven flow).

### Why Trade UI status loop third
Visible quality win for users. Without it, the UI shows "submitted" but
no progress; the matcher silently settles in the background. Trivial work.

### Why BUFX bridge is optional
The Trade UI's spot + perp already work end-to-end without it.
`BuFxPerpLiquidityAccepted` is for a different user journey (BUFX-side
request → matcher-side liquidity injection) that may or may not be a
real product need.

### Risk: Pyth fee on Arc
Arc uses USDC as native gas. Pyth push fee is small but accumulates over
5s cadence × N markets. Confirm KEEPER USDC headroom before Phase 7.2 ships.

### Risk: matcher build time blocks `bun run dev:complete`
First `cargo build --release` takes ~90s on a clean checkout. Cache
target/ in CI; surface `bun run setup` script + README note so devs know
to expect it once.

---

## 4 — Steady-state ops (after all steps land)

Three signing-key EOAs (boot fails fast on collision):
- `PERP_KEEPER_PRIVATE_KEY` — settleMatch + funding poke + Pyth push
- `LP_OPERATOR_PRIVATE_KEY` — synthetic LP signed orders
- `CANARY_TRADER_PRIVATE_KEY` — liveness probe

One `.env.local` at the monorepo root (see `services/matcher/README.md`
for the matcher-specific block, already documented).

Five long-running processes under `bun run dev:complete`:
- `apps/web` (Next.js)
- `apps/api` (Hono)
- `apps/ponder` (Ponder indexer)
- `services/matcher` (Rust matcher; tick loop + LP + canary + funding + pyth)
- `apps/keeper-perps-liquidator` (TS, kept — separate concern from matcher)

Decommissioned by this work:
- `apps/keeper-perps-matcher` (TS) — replaced by Rust matcher
- `apps/keeper-perps-funding` (TS) — replaced by Rust matcher's funding_poker
- `apps/keeper-pyth` (TS) — replaced by Rust matcher's pyth_pusher (Phase 7.2)

---

## 5 — Total effort

Revised from v1's 2-week ambition: **~3–4 days total** for the
monorepo-boot + Phase 7.2 + UI status loop trio, deferring the BUFX
bridge until product demand surfaces.

Owner allocation:
- Matcher lead: 2–3 days (Phase 7.2 + monorepo shim)
- Frontend owner: 1 day (status loop)
- BUFX owner: 0 days unless step 4 is prioritized

---

## 6 — Sign-off

Three reviewers needed before this roadmap is treated as committed:

| Role | Reviewer | Status |
|---|---|---|
| Matcher lead | TBD | ⬜ |
| BUFX owner | TBD | ⬜ |
| Frontend owner | TBD | ⬜ |

Once all three sign off, work begins.

---

## 7 — What changed from v1 (audit trail)

v1 of this roadmap (commit `8187755`) claimed:
- ❌ "apps/api/bufx routes — NOT BUILT" → reality: `/spot/intents` +
  MCP tool surface are built
- ❌ "apps/web spot FX UI — NOT BUILT" → reality: Trade UI handles
  spot via leverage=1 in the same panel; BUFX-specific UI may exist
  in other surfaces (verify with frontend owner)
- ❌ "Build apps/web /app/spot route" → reality: spot is in the Trade
  panel; no separate route needed for the perp-clearinghouse path
- ✅ "Phase 7.2 pyth_pusher" → still correct, kept
- ✅ "BUFX → matcher bridge for BuFxPerpLiquidityAccepted" → still
  correct, downgraded to optional pending stakeholder demand
- ✅ "matcher in `bun run dev:complete`" → still correct, kept

The user corrected v1 by sharing screenshots showing the live Trade UI
+ Loan/Borrow UI on `localhost:3001`. v2 is built from the actual
`apps/web/components/trade-island/panels.tsx` + `apps/api/src/routes/perps.ts`
+ `/spot/routes.ts` source.
