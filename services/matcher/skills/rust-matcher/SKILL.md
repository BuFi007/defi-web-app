---
name: rust-matcher
description: |
  Master entrypoint for any work on the BUFI Rust matcher service at
  services/matcher/. Loads the architecture spec, Phase 0 reading notes, and
  the relevant slice of installed Rust skills before answering. Use when the
  user mentions: matcher, matching engine, orderbook, services/matcher, CLOB,
  match loop, fills, intents, EIP-712 intent signing, gRPC matcher API,
  proto/matcher.v1.proto, LP backstop, JELLY, BAL, Drift backstop, Polymarket
  CLOB, dYdX streaming, joaquinbejar, matcher reconciler, golden replay, or
  any Phase 2-6 work on this service. Also use when designing the proto wire
  format, EIP-712 schemas, or the keeper/Ponder integration on the matcher
  side. Triggers on: rust-matcher, /rust-matcher, BUFI matcher, BUFX matcher,
  perp matcher, CLOB engine, hybrid CLOB + LP, orderbook crate, matcher-server,
  matcher-reconciler, matcher-test-harness, bufi-orderbook, bufi-matcher-types,
  Telaraña matcher.
license: MIT
metadata:
  author: BUFI matcher team
  version: "0.1.0"
  domain: fintech
  scope: implementation
  output-format: code
  related-skills:
    - rust-router
    - domain-fintech
    - m01-ownership
    - m04-zero-cost
    - m07-concurrency
    - m10-performance
    - m15-anti-pattern
    - rust-engineer
    - rust-async-patterns
    - rust-testing
    - rust-best-practices
    - rust-mcp-server-generator
    - coding-guidelines
    - unsafe-checker
---

# /rust-matcher — BUFI matcher master skill

You're working on the BUFI / FX Telaraña perp DEX matching engine, a
standalone Rust service at `services/matcher/`. This is the safety-critical,
audit-targeted, longest-lived component in the BUFI stack. Treat every
choice accordingly.

> **Iron law.** The matcher pure core (`crates/orderbook`) does no IO, no
> time, no RNG, no floats, no unsafe. If a tool would let you violate any of
> those, you're in the wrong crate — write the IO-touching code in
> `crates/matcher-server` instead. This rule is enforced by
> `crates/orderbook/Cargo.toml` (denied lints) + `clippy.toml` (denied APIs).
> Don't try to work around it; revisit the design.

---

## Mandatory pre-flight reading (read these first, every time)

Before answering any matcher question or writing any matcher code, load all
of these into the working context. They are short and they contain decisions
that override your priors.

1. **Spec.** `docs/matcher-architecture.md` — the source of truth. North-star,
   determinism contract, proto sketch, matching algorithm pseudo-code,
   invariants table, integration map, phasing.
2. **Phase 0 findings.** `docs/matcher-reading-notes.md` — distillation of
   the 4 reference repo passes (Polymarket CLOB, dYdX v4 proto,
   joaquinbejar/OrderBook-rs, Drift v2 + JELLY). Bottom-line decisions table
   at the top, per-source detail below, 12 LP-backstop invariants.
3. **Wire format.** `services/matcher/proto/matcher.v1.proto` — the actual
   proto. Diff this against the sketch in the spec when they drift.
4. **Crate boundaries.** `services/matcher/README.md` and the `lib.rs` files
   in each of the 5 crates — they document the contract each crate must
   uphold.

If any of these files are missing in the working tree you're inspecting,
stop and tell the user. We're on the `rust-matcher` branch in a worktree at
`/Users/criptopoeta/coding-dojo/defi-web-app-rust-matcher/` — the main
working tree at `/Users/criptopoeta/coding-dojo/defi-web-app/` is shared
with ~50 parallel agent worktrees and is unsafe for this work.

---

## Reference repos — read directly, not from memory

All of these are cloned under `references/` (gitignored, ~1.5 GB total).
Grep, code-read, and cite by file path + line number. Do NOT rely on what
you remember from training; the canonical version is the file on disk.

### Hybrid CLOB + LP (closest publicly readable analog)

- `references/Polymarket-ctf-exchange-v2/` — Solidity CLOB v2, EIP-712 v2
  domain, settlement model.
- `references/Polymarket-ctf-exchange/` — v1, simpler, useful warmup.
- `references/Polymarket-rs-clob-client-v2/` — Rust client types, wire
  encoding patterns.
- `references/ahollic-polymarket-architecture/` — third-party writeup.
- `references/KaustubhPatange-polymarket-trade-engine/` — reimplementation,
  cross-check.

### Perp DEX CLOB + gRPC streaming patterns

- `references/dydxprotocol-v4-chain/proto/` — **read this first** for any
  proto edit. Streaming book + diff patterns are gold.
- `references/drift-labs-protocol-v2/` — Rust, BAL design, insurance fund,
  oracle gating.
- `references/drift-labs-drift-rs/` — Rust client SDK.
- `references/drift-labs-gateway/` — their gRPC gateway shape.
- `references/drift-labs-keep-rs/` — Rust keeper for on-chain settlement.

### Rust orderbook structural templates

- `references/joaquinbejar-OrderBook-rs/` — primary structural template for
  `crates/orderbook/src/match_engine.rs`. Adopt the loop shape +
  `StopCondition` enum. Reject `f64` prices (we use `i64` WAD).
- `references/auralshin-orderbook/` — alternative structure.
- `references/dylanlott-orderflow/` — more feature-complete; read after the
  simpler ones.
- `references/hroptatyr-clob/` — C, exceptionally clean matching loop.

### LP backstop / vault references

- `references/drift-labs-protocol-v2/` — BAL = the post-JELLY safer
  alternative to Hyperliquid HLP. **Required before any Phase 4 LP code.**
- `references/gmx-io-gmx-contracts/` — GLP, older simpler model.
- `references/gmx-io-gmx-synthetics/` — GMX v2, per-market isolated pools.
- `references/Fkleppe-awesome-perp-trading/` — curated survey, use as ToC.

### Crate / tooling references

- `references/hyperium-tonic/` — gRPC server + client, read the `streaming`
  example.
- `references/paupino-rust-decimal/` — the fixed-point decimal crate we use.

---

## Linked Rust skills (load contextually, not all at once)

These come from the installed skill packs (actionbook/rust-skills,
wshobson/agents, github/awesome-copilot, apollographql/skills,
affaan-m/everything-claude-code, jeffallan/claude-skills). Load only the
ones relevant to the current sub-task.

| Sub-task | Skills to load |
|---|---|
| Designing crate boundaries | `rust-router`, `domain-fintech`, `m11-ecosystem` |
| Writing the match loop core | `m01-ownership`, `m04-zero-cost`, `rust-engineer` |
| Async gRPC server work | `m07-concurrency`, `rust-async-patterns` |
| EIP-712 signature verify | `rust-engineer`, `m13-domain-error` |
| Proptest / golden replay | `rust-testing`, `m05-type-driven` |
| Performance profiling | `m10-performance`, `rust-best-practices` |
| Anti-patterns review | `m15-anti-pattern`, `unsafe-checker` |
| Auditable / unsafe review | `unsafe-checker`, `coding-guidelines` |
| External MCP integration | `rust-mcp-server-generator` |
| Domain framing (fintech) | `domain-fintech`, `m13-domain-error` |

If a skill triggers automatically from a keyword, let it. The dual-load rule
from `rust-router` applies: fintech keywords always pair an L1 mechanics
skill with `domain-fintech`.

---

## The 12 LP-backstop invariants (memorise — these gate Phase 4)

Every LP fill code path MUST check all of these. No exceptions. Cited from
`docs/matcher-reading-notes.md` §Source 4.

1. Per-market max OI cap: `oi_after <= market.max_open_interest`.
2. Mark-oracle divergence circuit breaker: block if `|mark - oracle| /
   oracle > 10%` OR `|oracle - twap_5min| / twap > 50%`.
3. LP delta cap per market: `|lp_long - lp_short| <= lp_delta_limit`.
4. Oracle freshness gate: reject if `now - oracle.ts > ORACLE_MAX_AGE_MS`.
5. Reduce-only on LP-cap breach.
6. Insurance-fund integration before socialising losses.
7. Size-dependent LP spread function.
8. Per-intent LP fill size cap (~10% of LP TVL).
9. Reserve-price vs oracle band check.
10. Respect `MarketStatus::ReduceOnly` / `Paused`.
11. Funding settles before LP unwind.
12. LP fills emit `Fill{is_lp_fill: true}` and reconcile against
    `lp_state.position_delta`.

---

## The 10 matcher invariants (Phase 2 — `crates/orderbook/tests/properties.rs`)

From `docs/matcher-architecture.md` §Critical invariants.

1. Intent never fills more than declared size.
2. Same price level: earlier arrival fills first (FIFO).
3. `best_bid_price < best_ask_price` after every match.
4. Conservation: Σ fill_size + remaining_on_book ≤ original_size.
5. Replay determinism: same input sequence → byte-identical fills.
6. No fill with `price = 0` or `size = 0`.
7. Cancel of already-filled intent is a no-op, not an error.
8. Expired intent never matches.
9. (Phase 4) LP fill never exceeds LP available size cap.
10. (Phase 4) LP fill price ≥ `mark + min_spread_for_size`.

Each invariant is a proptest property and a golden fixture.

---

## How to answer a request — checklist

1. **Confirm the worktree.** Are we at
   `/Users/criptopoeta/coding-dojo/defi-web-app-rust-matcher/`? If not, switch
   before any write.
2. **Confirm the branch.** Should be `rust-matcher` (or a feature branch off
   it). Not `integration/wk1-development` and not `main`.
3. **Read the spec section relevant to the request.** Don't infer — open
   `docs/matcher-architecture.md` and quote the line.
4. **Read the reading-notes section relevant to the request.** If there's a
   row in the bottom-line table that decides this, follow it. If not,
   surface the question.
5. **Decide the crate.** If it does IO, time, RNG, or floats — it goes in
   `matcher-server`, not `orderbook`. If it's purely deterministic — it goes
   in `orderbook`, never `matcher-server`.
6. **Check the reference repo.** Before writing a non-trivial algorithm,
   open the corresponding source repo under `references/` and read the
   relevant file at the cited line numbers. Cite back in code comments only
   when the citation provides genuine value (not for trivial idioms).
7. **Write the code.** Apply the relevant linked skills. Prefer editing
   existing files. Don't write planning docs or summaries unless the user
   asks.
8. **Run cargo check + clippy -D warnings + tests.** All three must be green
   before reporting done.
9. **Update the spec doc** if your code introduces a deviation from
   `docs/matcher-architecture.md`. Spec edits land in the same commit as
   the code change (sign-off rule).
10. **One commit, conventional message** — `feat(matcher):`, `fix(matcher):`,
    `docs(matcher):`, `test(matcher):`. Don't push unless asked.

---

## What this skill explicitly does NOT do

- It does not bless writing matching logic in TypeScript. Anything related
  to the matching engine belongs in Rust. Period.
- It does not let you ship without proptest + goldens for any invariant.
- It does not let you skip the spec update in the same commit as a code
  change that deviates from the spec.
- It does not let you reach for tokio/redis/HashMap/SystemTime inside the
  orderbook crate, even temporarily.
- It does not bless rewriting `apps/api`, `apps/ponder`, or the keepers in
  Rust. Those stay TS. Only the matcher (and the reconciler) move.

---

## Phase map (so you know what's in scope)

| Phase | Scope | State today |
|---|---|---|
| 0 | Reference reading | ✅ committed in `docs/matcher-reading-notes.md` |
| 1 | Spec, proto, scaffolding | ✅ committed at `services/matcher/`, cargo check green |
| 2 | Core orderbook + matching, invariants 1-8, goldens | next |
| 3 | TS integration (API, keeper, Ponder reconciler) | after Phase 2 |
| 4 | LP backstop (invariants 9-10 + the 12 LP gates) | after `docs/lp-backstop-design.md` written |
| 5 | Funding rate + mark-price safety | after Phase 4 |
| 6 | Determinism + invariant suite hardening | ongoing |

Anything outside these phases is out of scope for this skill. Surface it as
a separate doc, not a code change.
