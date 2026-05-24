# Team BRAVO — Iteration 1

## BRAVO.1 — Matcher live-fire

- **Test approach:**
  - Installed `grpcurl` via brew.
  - Wrote `scripts/bravo-matcher-livefire.ts` to sign an EIP-712
    `SignedOrder` (TelaranaFxOrderSettlement domain, chain 5042002,
    verifyingContract `0x0F62FCdA2de63d905Cb167301C00251A9bB6dAa1`) and
    submit it via `grpcurl -plaintext -import-path
    services/matcher/proto -proto matcher.v1.proto -d <wire-json>
    127.0.0.1:3005 matcher.v1.Matcher/SubmitOrder`.
  - Submitted three test orders to the EURC/USDC market id
    `0x565a6e2f…2063cab8`:
    1. `CANARY_TRADER` taker MARKET LONG 0.01 EURC → status
       `MATCH_STATUS_RESTING` (intentId
       `0xba1b53ec55f75f1032ce04e2b9d0e73900ed5f9503f8ca4fa9dbe1af4fea182`).
    2. `LP_OPERATOR` maker LIMIT SHORT 0.01 EURC @ 1.161 → status
       `MATCH_STATUS_RESTING`.
    3. Second `CANARY_TRADER` MARKET LONG 0.005 EURC → also
       `MATCH_STATUS_RESTING` (no fill produced).
  - Verified via direct sqlite query on
    `.bufi/trading-machine.sqlite` (table `perp_order_intents`):
    matcher correctly stored side+priceE18+sigDeltaE18 for every
    submission.

- **Result:** **NO settleMatch tx produced on Arc.** End-to-end ingestion
  works (gRPC parse + EIP-712 verify + sqlite persist + tick observation
  + `match_seq` advances every 30s) but every order — including IOC
  MARKET takers — ends in `MATCH_STATUS_RESTING`. Two root causes
  surfaced:

  1. **Tick loop never produces fills against the live book.**
     `bufi_matcher_last_fill_timestamp_ms = 0` with uptime 50,000s+ →
     matcher Health = `STATUS_DEGRADED` (per `grpc.rs:565`). 51 pending
     intents in DB for EURC/USDC, 5 expired, 0 filled. The orderbook
     in `tick.rs:133` rebuilds a fresh book *per tick* from the
     translated pending set — but `match_intent` returns no fills even
     when the book contains crossable bids+asks (longs @ 1.1607 vs
     shorts @ 1.1619 produced by a background canary process). MARKET
     orders submitted with `priceE18=0` did not consume the asks.
  2. **TIF wire field is ignored.** `intent_translator.rs:282` hard-
     codes every intent to `TimeInForce::GoodTilCancel`; the `tif`
     proto field on `SignedOrder` is silently dropped, so IOC/FOK
     takers can't surface to the matcher.

- **Failing layer:** matcher orderbook crate — gRPC ingestion + DB
  persistence + tick loop all healthy; settlement layer not yet
  exercised because matching never produces a fill on the canary
  workload.

- **Status:** **RED** — `last_fill_timestamp_ms = 0` is the canary
  signal the matcher is not yet shipping fills to Arc.

## BRAVO.2 — Hardcoded values

- **Hits found: 4 | Replaced: 1 | Remaining (categorized):**

  | File:line | Value | Category | Disposition |
  |---|---|---|---|
  | `.env.local:48` | `FX_ORACLE_ADDRESS=0xF9D0442D…aFf03` | **(c) bug** | **FIXED → `0x77b3A3B420dB98B01085b8C46a753Ed9879e2865`**. The ghost address reverts on every read (`pythFeedOf` = zero); canonical address comes from `packages/contracts/src/index.ts:280` and `fx-telarana/deployments/perps-config-5042002.json`. |
  | `.env.local:50` | `MATCHER_FUNDING_MARKET_IDS=<EURC only>` | **(c) bug** | **FIXED → added MXNB, CIRBTC, tJPYC**. `pyth_pusher.rs` only refreshes feeds for markets listed here, so the other 3 perp markets fell stale 43h ago. |
  | `apps/web/components/trade-island/arcade.tsx:136-137` | `useState(125420.5)` / `useState(316.14)` | **(a) intentional sample** | Arcade minigame display only; explicit comment "Will read from useBalance(USDC) once token wiring lands." Leave. |
  | `apps/web/components/trade-island/multiplayer.tsx:697` | `useState(125420.5)` | **(b) demo placeholder** | Same — display-only opaque wallet. Real entry fee leaves wagmi when tx sends. Leave. |
  | `apps/web/components/trade-island/data.tsx:41-54` | `price: 0` seeds | **(a) intentional** | Verified by `trade-island/index.tsx:1218-1234` — `useLiveMarket` (Pyth Hermes WS) + `useMarketStats` override at render; 0 is the cold-start sentinel. |
  | `apps/web/components/trade-island/loan.tsx:211-225` | `LOAN_MARKETS` (supply/borrow/util/lltv/tvl all `null`) | **(a) intentional** | Cells render "—" until `useMarkets()`/`usePositions()` lands real values. Comment at line 1361-1366 confirms the legacy hardcoded supply/borrow numbers were already removed 2026-05-18. |
  | `apps/web/components/perps-replacement-agent/**` | (none) | n/a | No suspicious literals found. |

- **Commits:** see git log on `feat/wk1n14-privacy-pools-live`. Fixes
  scoped to `.env.local` (untracked — env file, intentionally not
  committed) and new probe scripts in `scripts/`.

## BRAVO.3 — Oracle health

- **Oracle:** `0x77b3A3B420dB98B01085b8C46a753Ed9879e2865` (NOT the
  `0xF9D0442D…` address in the mission prompt — that's a ghost address
  that reverts; see BRAVO.2 fix). MaxOracleAge = 60s. Pyth contract
  `0x2880aB155794e7179c9eE2e38200202908C17B43`.

- **Table** (snapshot at unix 1779639958, 2026-05-24 ~14:00 UTC):

  | symbol  | feedId (Pyth, abbrev) | price (raw) | exp | publishTime | age (s) | status |
  |---------|-----------------------|-------------|-----|-------------|---------|--------|
  | EURC    | `0x76fa…fa5c`         | 116100320   | -8  | 1779639958  | 17      | **fresh** (passes priceOf) |
  | USDC    | `0xeaa0…c94a`         | 99973471    | -8  | 1779639958  | 17      | **fresh** (passes priceOf) |
  | cirBTC  | `0xe62d…b43e`         | 7639223156448 | -8 | 1779634372  | 5,603   | STALE (~93min) — priceOf reverts |
  | MXNB    | `0xe13b…77ca`         | 1732755     | -5  | 1779483604  | 156,371 | VERY STALE (~43h) — priceOf reverts |
  | tJPYC   | `0xef2c…fd52`         | 159195      | -3  | 1779483604  | 156,371 | VERY STALE (~43h) — priceOf reverts |
  | tCHFC   | (not in API)          | —           | —   | revert      | n/a     | REMOVED per asset-rules (matches CHFC removal directive) |
  | AUDF    | (not in deployment)    | —           | —   | n/a         | n/a     | **NOT YET DEPLOYED** on Arc Testnet — `apps/api/v1/perps/markets` lists only EURC/tJPYC/MXNB/CIRBTC; mission prompt's 5-market list (MXNB/QCAD/cirBTC/AUDF/EURC) does not match on-chain reality. QCAD also absent. |

- **Pyth pusher status:** `MATCHER_PYTH_USE_WS` is unset → matcher runs
  HTTP polling path (see `pyth_pusher.rs:19`, default
  `PYTH_PUSH_INTERVAL_MS=5000`). Pre-fix only EURC was in
  `MATCHER_FUNDING_MARKET_IDS`, so the pusher refreshed exactly that
  one feed + USDC (the quote-side companion). With the env fix above,
  on next matcher restart MXNB, CIRBTC, tJPYC will also be pushed.
  Matcher process must be restarted to re-read env.

- **Freshest publishTime per feed (now):**
  - EURC: `1779639958` (2026-05-24 14:25:58 UTC)
  - USDC: `1779639958`
  - cirBTC: `1779634372`
  - MXNB: `1779483604` (2026-05-22 ~21:00 UTC — stuck)
  - tJPYC: `1779483604`

## Handoffs

- **To ALPHA:**
  - The UI's `data.tsx` lists FX symbols (`USD/MXN`, `USD/JPY`, etc.)
    that don't map 1:1 to the matcher's market ids (which are
    `MXNB/USDC`, `tJPYC/USDC`, `EURC/USDC`, `CIRBTC/USDC` per
    `/perps/markets`). If the trade-island chart pulls a live mark for
    `USD/MXN`, it won't find one. Confirm the symbol→marketId map.
  - The trader will see "RESTING" forever on any submitted order until
    the orderbook-tick fill bug is resolved. Consider a UI banner when
    `bufi_matcher_health = DEGRADED`.

- **To CHARLIE:**
  - Three EOA gate: `CANARY_TRADER` and `LP_OPERATOR` are configured;
    no `PERP_KEEPER_PRIVATE_KEY` in `.env.local`. If the matcher
    boots and these three pks collide (mission spec says boot fails on
    collision), validate the three distinct values are populated.
  - Settlement EOA (`0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69`,
    nonce 3459) has never settled an EURC/USDC match — when fills
    start landing, monitor Arc balance + revert reason if settleMatch
    reverts.

- **To DELTA/ECHO/FOXTROT:**
  - **Top blocker for "beta-ready":** matcher matching loop produces 0
    fills against a live book. `last_fill_timestamp_ms=0` after 13.9h
    uptime, with 51 cross-able pending intents queued. Without a fill,
    settleMatch + on-chain perp open-interest stays at literal genesis.
    Next iteration should bisect `match_intent` on the live book or
    swap to a pre-loaded fixture to confirm whether the bug is in
    `orderbook::match_intent`, `intent_translator::translate`
    (`TIF` drop), or in the tick loop's `arrival_order` sort.
