# Matcher mainnet-readiness checklist

**Status:** draft v1 — Phase 6 gate doc.
**Owner:** matcher lead.
**Purpose:** sign-off doc before any commit to a mainnet `FxOrderSettlement`
deployment. Every row needs an explicit ✅ or a written waiver from the
operator before the matcher signer key is ever pointed at a mainnet RPC.

The matcher currently operates on **Arc Testnet only** (chainId 5_042_002).
Any chainId in `MATCHER_CHAIN_ID` that isn't in the testnet allow-list
below MUST be reviewed against this checklist first.

Testnet allow-list (no readiness checklist required):
- `5_042_002` (Arc Testnet)
- `43_113` (Avalanche Fuji)

Mainnet target list (each row of this doc applies):
- TBD — fx-telarana hasn't broadcast a mainnet sprint yet. This doc
  exists so the matcher side is unblocked the day it does.

---

## §1 — Wire format & EIP-712 (Phase 2a)

| Row | Check | Status |
|---|---|---|
| 1.1 | `proto/matcher.v1.proto` `SignedOrder` mirrors `FxOrderSettlement.SignedOrder` field-for-field on the mainnet contract. Compare contract `SIGNED_ORDER_TYPEHASH` to the typehash computed by `bufi_matcher_types::eip712::SignedOrder::eip712_signing_hash` against the mainnet domain. | ✅ for sprint-1 Arc; **re-verify per deploy** |
| 1.2 | EIP-712 domain name `"TelaranaFxOrderSettlement"` matches mainnet contract constructor (`fx-telarana/contracts/src/perp/FxOrderSettlement.sol:60`). | ✅ for sprint-1 Arc |
| 1.3 | Nonce semantics — Permit2 bitmap (`nonce >> 8` word index, `1 << (nonce & 0xff)` bit). Unchanged across the audit. | ✅ |
| 1.4 | `deadline` field treated as unix **seconds** (matches `block.timestamp`), not millis. | ✅ |
| 1.5 | Self-trade prevention enforced on-chain via `maker.trader != taker.trader`. Matcher MUST not pair an intent with itself. | ✅ — `settle_one` debug_asserts opposite sides |

---

## §2 — Matcher determinism (Phase 2b)

| Row | Check | Status |
|---|---|---|
| 2.1 | `crates/orderbook` has zero IO, time, RNG, floats, unsafe. `Cargo.toml` denies float lints; `clippy.toml` blocks `SystemTime::now` / `Instant::now` / `HashMap` / `HashSet`. | ✅ |
| 2.2 | All 8 matcher invariants have proptest properties in `crates/orderbook/tests/properties.rs`. | ✅ |
| 2.3 | Golden replay corpus in `crates/orderbook/tests/golden/*.json` covers simple cross, partial fill, multi-level walk, FOK reject, expired reject. | ✅ — 5 fixtures |
| 2.4 | `bufi-matcher-replay seed` regenerates the corpus from canonical Rust constructors; no JSON hand-editing required. | ✅ |
| 2.5 | Replay determinism property (invariant 5) passes under `proptest` with `PROPTEST_CASES=10_000`. | 🟡 — Phase 7c bumped CI default to 1_024 via `crates/orderbook/proptest.toml`; audit-prep MUST run the full sweep via `PROPTEST_CASES=10000 cargo test -p bufi-orderbook --release` |

---

## §3 — Phase 3 integrations (DB + chain)

| Row | Check | Status |
|---|---|---|
| 3.1 | `BUFI_DB_PATH` points at the same SQLite file `apps/api` writes to. The schema (`perp_order_intents`) is byte-equivalent to `@bufi/db`. | ✅ — same `migrate()` DDL, validated via integration test |
| 3.2 | `record_fill` matches `applyFillToIntent` in `@bufi/db` exactly: same-sign check, no-zero-fill, overfill guard, flips to `filled` when residual hits zero. | ✅ |
| 3.3 | `perp-stack-{chainId}.json` exists and is loadable; addresses verified against the broadcast manifest. | ⬜ — mainnet manifest TBD |
| 3.4 | `PERP_KEEPER_PRIVATE_KEY` holds a mainnet-funded EOA with `SETTLER_ROLE` on `FxOrderSettlement`. | ⬜ |
| 3.5 | Settled fills survive a matcher restart — write the fill, kill `-9` the process, restart, confirm the next tick doesn't replay or double-settle. | ⬜ — manual canary required for mainnet |

---

## §4 — LP backstop (Phase 4)

| Row | Check | Status |
|---|---|---|
| 4.1 | All 12 LP-backstop invariants from `docs/lp-backstop-design.md` have either a Rust gate, an on-chain enforcement, or a tracking watchdog. | 🟡 — 10 fully covered; invariants 6 + 9 documented as Path B work |
| 4.2 | `LP_OPERATOR_PRIVATE_KEY` is a distinct EOA from `PERP_KEEPER_PRIVATE_KEY` (contract rejects `maker == taker`). | ✅ — fail-fast at boot |
| 4.3 | `lp_positions.tvl_usdc_e6` matches the LP_OPERATOR's actual margin balance on `FxMarginAccount`. Reconcile via a manual `FxMarginAccount.marginOf(LP_OPERATOR)` query at boot. | ⬜ — mainnet requires a reconciliation tick |
| 4.4 | Pure-compute LP path (`crates/orderbook/src/lp_gate.rs::pure_check`) passes proptest determinism property. | ✅ — `pure_check_is_deterministic` |
| 4.5 | `if_burn_floor_usdc_e6` is set per-market for mainnet (`max(0.01 × LP TVL, 10_000 USDC)` per Phase 4a). | ⬜ — admin call required before LP enabled |
| 4.6 | Path B (`FxPerpLpVault`) audit complete OR Path A operator-key-risk waiver signed. | ⬜ |

---

## §5 — Oracle + funding (Phase 5)

| Row | Check | Status |
|---|---|---|
| 5.1 | `FX_ORACLE_ADDRESS` or `perp-oracle-{chainId}.json` resolves to the mainnet `FxOracle`. | ⬜ — mainnet manifest TBD |
| 5.2 | Oracle freshness gate ceiling (`ORACLE_MAX_AGE_SECS`) is tuned for mainnet liveness. Default 30s on Arc; mainnet may need looser per chain finality. | ⬜ |
| 5.3 | Funding poker (`MATCHER_FUNDING_MARKET_IDS`) includes every enabled mainnet market. | ⬜ |
| 5.4 | `FUNDING_POKE_MIN_INTERVAL_MS` matches the on-chain funding interval. Arc = 1h; mainnet TBD. | ⬜ |
| 5.5 | Liquidation keeper (untouched by Phase 5) is independently mainnet-ready or explicitly disabled. | ⬜ — out of matcher scope |

---

## §6 — Operator surface

| Row | Check | Status |
|---|---|---|
| 6.1 | All env vars documented in `services/matcher/README.md` AND in the relevant module's docstring. | 🟡 — README has the dev set; mainnet vars need an addendum |
| 6.2 | Tracing output goes to the operator's log sink (axiom / datadog / etc), not just stdout. `MATCHER_OTEL_ENDPOINT` wired. | ⬜ |
| 6.3 | SIGTERM unwinds the tick loop, event subscriber, IF watchdog, funding poker WITHOUT losing in-flight fills. Confirmed via process-stop integration test. | ⬜ — manual mainnet canary |
| 6.4 | Boot logs both keys' addresses (PERP_KEEPER + LP_OPERATOR) so operators can confirm they pointed the right keys at the right contracts. | ✅ — already prints both |
| 6.5 | Cursor file path (`MATCHER_EVENT_CURSOR_PATH`) is on durable storage (not `/tmp`). | ⬜ — operator deploy concern |

---

## §7 — Threat model recap

What we defended against (and where):

| Threat | Defence | Where it lives |
|---|---|---|
| Off-chain price tampering | EIP-712 signature re-verification in Rust before matching | `intent_translator::translate` |
| Replay of stale signed orders | Permit2 bitmap nonce check on-chain + deadline rejection | `FxOrderSettlement` + `intent_translator` |
| Self-trade | Contract `maker != taker` revert + matcher filter | `settlement::settle_one` |
| Crossed book | Invariant 3 in `orderbook` + match-loop logic | `match_engine::match_intent` |
| JELLY-style thin-market drain | 12 LP invariants in `lp_gate::pure_check` + RPC-gated checks in `lp_router` | `crates/orderbook/src/lp_gate.rs` + `crates/matcher-server/src/lp_router.rs` |
| Stale oracle price exploit | Invariant 4 (30s freshness gate) | `lp_gate::pure_check` |
| Race / wasted-tx on funding poke | Per-market throttle seeded from `FxFundingEngine.fundingState.lastUpdate` | `funding_poker::seed_from_chain` |
| Reorg-induced double-process of an event | HTTP-poll subscriber at `head - confirmations` + cursor file | `event_subscriber::tick` |
| LP cap breach via concurrent fills | Sequential `settle_batch`; single matcher process per chain | `tick::run` |

What we **explicitly deferred**:

- **Cross-margin** between perp markets (v1 is isolated margin per market — would require margin engine changes).
- **Self-trade prevention beyond same-intent** — same trader's two intents CAN match against each other in v1. Polymarket has none either.
- **Cross-market LP rebalancing** — Phase 4's LP is strictly per-market. Cross-market belongs in a Phase 5+ market-maker layer.
- **WebSocket event subscription** — HTTP polling at the confirmation buffer is reorg-safe by construction. WS is an optimisation, not a correctness gap.
- (~~Canary keeper~~ — landed in Phase 7. See §9 below.)

---

## §8 — Audit scope

The audit surface for the matcher is, in priority order:

1. **`crates/orderbook/`** — pure-core matching + LP gate. No IO, no clock,
   no RNG, no floats, no unsafe. Determinism contract is enforced by
   `Cargo.toml` lints + `clippy.toml` denials.
2. **`crates/matcher-types/`** — EIP-712 schemas. Typehash must match the
   on-chain `SIGNED_ORDER_TYPEHASH` byte-for-byte.
3. **`crates/perps-onchain/`** — alloy bindings + JSON loaders. Security
   surface is mostly the env-var resolution path (where addresses come
   from) and the override semantics (`CONTRACT_ADDRESSES_JSON`).
4. **`crates/perps-db/`** — SQLite store. `record_fill` arithmetic must
   match the TS `applyFillToIntent` exactly.
5. **`crates/matcher-server/`** — orchestration. `lp_router`, `lp_signer`,
   `settlement` are the highest-value review targets; the rest is plumbing.

Out of scope (third-party):

- `alloy-*`, `sqlx`, `tokio`, `tonic` — upstream crates, separately audited.
- `protoc-bin-vendored` — vendored protoc binaries.
- `reqwest` — HTTP client.

---

## §9 — Canary keeper (Phase 7)

The canary keeper is a synthetic-intent liveness probe. It signs a tiny
`SignedOrder` from a dedicated EOA (`CANARY_TRADER_PRIVATE_KEY`), inserts
it into the matcher's intent table, then polls the row until it reaches
a terminal status (`filled`, `rejected`, `expired`). A row that stays in
`pending` / `partially_filled` past `CANARY_TIMEOUT_SECS` emits an
`ERROR` log — operators wire that into alerting.

| Row | Check | Status |
|---|---|---|
| 9.1 | `CANARY_TRADER_PRIVATE_KEY` is a distinct EOA from both `PERP_KEEPER_PRIVATE_KEY` and `LP_OPERATOR_PRIVATE_KEY` (boot fails fast on collision). | ✅ — `canary::Canary::new` enforces |
| 9.2 | Canary EOA is funded with at least 10× `CANARY_NOTIONAL_USDC_E6` margin on the canary market — enough for the LP backstop to take the other side. | ⬜ — operator deploy concern |
| 9.3 | `CANARY_INTERVAL_SECS` is set in the 600–3_600 range. Default 1_800 (30 min). | ⬜ |
| 9.4 | `CANARY_TIMEOUT_SECS` matches the matcher's worst-case settle latency at the chain's finality (block time × `MATCHER_EVENT_CONFIRMATIONS` × 4× safety). Default 120 (2 min). | ⬜ |
| 9.5 | Canary alerts land in the operator's pager. The error string is `canary tick failed; alerting operators` — match on it. | ⬜ |
| 9.6 | Canary key is rotated alongside the keeper + LP_OPERATOR keys on the operator's rotation cadence. | ⬜ — operator runbook |

Env-var glossary for §9:

```text
  CANARY_TRADER_PRIVATE_KEY        hex of the canary EOA (no prefix or 0x...)
                                   omit ⇒ canary disabled
  CANARY_INTERVAL_SECS             default 1800 (30 min)
  CANARY_TIMEOUT_SECS              default 120  (2 min)
  CANARY_MARKET_ID                 bytes32 hex (default = EURC/USDC perp)
  CANARY_NOTIONAL_USDC_E6          default 1_000_000 (= 1 USDC)
```

---

## §10 — Sign-off

Three reviewers needed before a mainnet target is added to
`MATCHER_CHAIN_ID`:

| Role | Reviewer | Status |
|---|---|---|
| Matcher lead | TBD | ⬜ |
| Protocol owner (fx-telarana) | TBD | ⬜ |
| Operator | TBD | ⬜ |

Sign-off signatures land at the bottom of this doc in a separate commit
once all three reviews are in.
