# LP backstop design

**Status:** draft v1, Phase 4 design gate. **No LP code lands until this doc is signed off.**
**Owner:** matcher lead (TBD).
**Audience:** anyone implementing, reviewing, or auditing the LP backstop.
**Companion docs:**
- `docs/matcher-architecture.md` (spec) — §Matching algorithm, §Critical invariants
- `docs/matcher-reading-notes.md` — Phase 0 reference findings (esp. §Source 4)
- `fx-telarana/docs/INTEGRATION_HANDOFF.md` — sprint-1 contract surface

---

## North star

A Phase-4 LP backstop that **cannot get JELLY'd**. Concretely, when the CLOB
walk exhausts and the taker still has residual size, the matcher routes
that residual to an LP counterparty that:

1. Has a **hard per-market notional cap** the matcher checks before quoting.
2. Has a **fresh oracle** (gated on age + deviation) before quoting.
3. Charges a **size-dependent spread** so adverse selection is priced in.
4. Carries **its own dedicated insurance** layer so a single bad-debt event
   doesn't socialise across user positions.

A successful Phase 4 means: the matcher can route 100% of CLOB residual to
LP under healthy market conditions, AND a JELLY-style attack can't drain
more than a bounded loss the LP is sized to absorb.

---

## What we're building against

### The JELLY incident (March 2025)

The Hyperliquid HLP (Hyperliquid Liquidity Pool) lost ~$13M USDC to a
single coordinated trade against a thinly-listed perp market. Attack
mechanic in 6 steps:

1. **Pick the market.** Attacker chose a low-volume, low-OI listed perp
   (JELLY, a meme token) with a thin oracle and minimal book depth.
2. **Wait for the oracle gap.** Pyth's price feed for JELLY had a
   ~minutes-long stale window where the on-chain oracle and the real
   off-chain market price had drifted ~10%+.
3. **One-sided saturation.** Attacker submitted a market order >50% of
   the 24h volume in one direction. HLP, the only meaningful liquidity
   counterparty, absorbed the **entire** opposite side with no per-market
   OI cap and no per-intent size limit.
4. **Delta concentration.** HLP's position ballooned to a directional
   extreme. HLP had no hedging path; funding rate alone was nowhere near
   strong enough to rebalance against the attacker's flow.
5. **Mark-price corruption.** As HLP's AMM-style position spiked, the
   AMM reserve price drifted further from the oracle. Subsequent trades
   benefited the attacker more — a positive-feedback loss spiral.
6. **No backstop sized for the loss.** Insurance fund was small relative
   to HLP; LP shares took the haircut. ~$13M socialised across LPs.

### What Drift v2 BAL does differently

`references/drift-labs-protocol-v2/programs/drift/src/`:

- **Per-market max OI cap** at `state/perp_market.rs` field
  `max_open_interest`, enforced in `controller/orders.rs` before any
  position grows.
- **Mark-oracle divergence guard rails** at `state/state.rs`
  `PriceDivergenceGuardRails` — default 10% mark-vs-oracle and 50%
  oracle-vs-5min-TWAP; trips the matching engine itself, not just the LP.
- **Oracle freshness guard rails** — `ValidityGuardRails.slots_before_stale_for_amm`
  rejects fills if the oracle hasn't updated in N slots.
- **Insurance fund as first-loss layer** — `state/insurance_fund_stake.rs`
  holds USDC stakers separately from LP positions; bad debt burns IF
  shares before touching LPs.
- **Dynamic spread tied to market state** — `math/amm.rs` reserve-price
  function widens the AMM spread as the AMM's net position deviates from
  zero, charging adverse-selection takers more.

Every safeguard in Drift's BAL that JELLY proved Hyperliquid needed is in
the 12 invariants below.

---

## The 12 invariants — acceptance criteria

These are the **gating** requirements for Phase 4. No LP code merges
without all 12 covered by proptest + golden + (where applicable) an
on-chain check. Each row's "acceptance" column is the testable assertion.

| # | Invariant | Acceptance criteria | Source |
|---|---|---|---|
| 1 | Per-market max OI cap | Property test: a sequence of LP fills that would push `max(long_oi, short_oi) + fill_size > market.max_oi` must reject before the on-chain `settleMatchAgainstLp` call. Mirrors Drift `controller/orders.rs` enforcement. | Drift |
| 2 | Mark-oracle divergence circuit breaker | Property test: LP quote is rejected when `\|mark − oracle\| / oracle > 0.10` OR `\|oracle − twap_5min\| / twap_5min > 0.50`. Both thresholds configurable per market; defaults from Drift `PriceDivergenceGuardRails`. | Drift |
| 3 | LP delta cap per market | Property test: `\|lp_long − lp_short\| ≤ lp_delta_limit` after every LP fill. LP can't accumulate unbounded directional risk. | Own design (Drift uses share-rebasing; we use an explicit cap for auditability) |
| 4 | Oracle freshness gate | Property test: LP fill rejected when `now_ms − oracle.last_update_ms > ORACLE_MAX_AGE_MS` (proposed 30s on Arc). | Drift `ValidityGuardRails` |
| 5 | Reduce-only on LP-cap breach | When `\|lp_position\| ≥ 0.95 × lp_delta_limit`, the LP serves ONLY reduce-only fills (opposite-sign to current position) until unwound. Property test: post-cap-breach long-direction fills reject. | Drift `MarketStatus::ReduceOnly` |
| 6 | Insurance fund first-loss | When LP realised PnL drops by `≥ 1%` in a single block (configurable), the insurance fund covers up to its balance before LP shares haircut. Integration test asserts IF balance decreases before LP TVL on a forced-loss scenario. | Drift `insurance_fund_stake.rs` |
| 7 | Size-dependent LP spread | LP quote = `mark + sign × (base_spread + f(size / avg_24h_volume, current_utilisation))`. Property test: doubling `size` at constant utilisation strictly widens the quoted spread. | Drift `math/amm.rs` reserve-price |
| 8 | Per-intent LP fill size cap | Single LP fill ≤ `max_lp_fill_per_intent` (proposed: 10% of LP TVL, configurable per market). Property test: a single intent requesting > cap matches against LP up to cap, then either partials (IOC) or rests (GTC, but flagged for replacement). | Own design (JELLY was a single-order whale; Drift relies on liquidation, we add an ingress cap) |
| 9 | Reserve-price vs oracle band | If `\|amm_reserve_price − oracle\| / oracle > 5%`, LP is paused for that market until reserve and oracle reconverge. Different from invariant 2 — that's mark-vs-oracle; this is the AMM's own reserve. | Drift `controller/orders.rs` `validate_market_within_price_band` |
| 10 | Market-status veto | LP respects `FxPerpClearinghouse.marketConfig(market_id).enabled` AND a future `pausedForLp` flag. Property test: when either is false, LP routing skips that market. | Drift `MarketStatus::ReduceOnly` / `Paused` |
| 11 | Funding settles before LP unwind | If the matcher decides to reduce an LP position (cap breach or admin call), pending funding accrual must settle first. Integration test: pre-vs-post position values include the funding adjustment. | Drift `controller/funding.rs` |
| 12 | LP fills audit trail | Every LP fill emits `Fill { is_lp_fill: true }` on the wire AND inserts a row in `domain_events` so the reconciler can diff matcher's LP position delta against the on-chain (if Path B) or accounting (if Path A) view. | Own design |

Each invariant has a **proptest** in `crates/orderbook/tests/lp_properties.rs`
(once we pick topology) and at least one **golden fixture** in
`tests/golden/lp_*.json`.

---

## JELLY walkthrough — which invariants trip when

Replaying the 6-step JELLY mechanic against the 12 invariants. Each step
asks: "given an attacker following this playbook against BUFI, which
invariant fires first and stops the attack?"

| JELLY step | What stops it under BUFI's Phase 4 design | Why |
|---|---|---|
| 1. Pick a thin-volume perp | — | Selection alone isn't an attack. |
| 2. Wait for oracle gap | Invariant 4 (oracle freshness) | LP rejects all quotes once `oracle_age > 30s`. Attacker can't quote during the gap. |
| 2 alt. Quote crossed price during volatility | Invariant 2 (mark-oracle divergence) | Even if oracle is fresh, a 10%+ mark/oracle divergence trips the circuit breaker. |
| 3. Submit market order > 50% of 24h volume | Invariant 8 (per-intent size cap) | Single intent capped at 10% of LP TVL. Excess size either partials (IOC) or rests on book (GTC, drains slowly via CLOB). |
| 4. HLP absorbs unbounded directional risk | Invariant 1 (per-market OI cap) AND Invariant 3 (LP delta cap) | Cap fires first. Even if cap allows the trade, invariant 3 prevents accumulated delta from going unbounded. |
| 5. AMM reserve drifts from oracle | Invariant 9 (reserve-vs-oracle band) | LP paused on that market until the band reconverges. No more LP fills until manual or automatic reconciliation. |
| 6. Loss socialised across LP shares | Invariant 6 (insurance fund first-loss) | IF burns first; LPs only haircut what IF couldn't cover. Lossestainted to a known, bounded layer. |

The attack stops at step 3 in the worst case. If oracle freshness and
mark-oracle divergence are functioning, it stops at step 2. **No single
invariant is the only line of defence.**

---

## LP topology — design fork (decision needed)

This is the **biggest open decision** in Phase 4 and the one this doc
needs the user to lock before any code lands. The 12 invariants apply
regardless; the topology determines how/where they're enforced.

### Option A — synthetic in-matcher LP (faster ship)

The matcher tracks a virtual LP position in its own state. The
`bufi-perps-db` layer gets a `lp_positions` table; the matcher updates
it on every LP fill. Settlement still calls `FxOrderSettlement.settleMatch`,
but the "maker" side is a pre-funded `LP_OPERATOR` EOA holding a margin
account on `FxMarginAccount`. The LP operator signs synthetic SignedOrders
that look like normal trader orders to the contract.

- **Pros**
  - Ships in 2-3 weeks.
  - No new Solidity, no new audit surface, no new deploy.
  - The 12 invariants are entirely matcher-side gating; matcher is the only
    surface that needs auditing.
- **Cons**
  - LP capital sits in `FxMarginAccount` like any other trader. No
    LP-specific accounting, no LP shares, no public yield.
  - The `LP_OPERATOR` EOA is a single high-value private key — same key
    risk we already flagged for the deployer.
  - LP position is matcher-state-only between settlements; a matcher
    restart that loses state could miscount LP exposure.
  - Insurance fund (invariant 6) has nowhere to live — would need a
    separate USDC escrow contract anyway.
  - Investor / depositor UX is impossible — no LP "shares" to buy.

### Option B — on-chain LP vault contract (audit-correct)

A new Solidity contract `FxPerpLpVault` (ERC-4626 over USDC) deposits LP
capital, mints shares, and exposes a `quote(market_id, side, size) →
(price, max_fillable_size)` view + a `settleMatchAgainstLp(taker, takerSig,
fill_size, fill_price) → fill_id` mutator that only `FxOrderSettlement` can
call. The matcher reads the quote, gates against the matcher-side
invariants 1-12, then calls `settleMatchAgainstLp` (or a settleMatch
variant that's LP-aware).

- **Pros**
  - LP capital + accounting + shares all live in a single audited contract.
  - Insurance fund (invariant 6) is its own ERC-4626 vault, same pattern.
  - LP yield is publicly accountable; can be wrapped in a frontend "deposit
    USDC, earn LP yield" surface.
  - Most of the 12 invariants can be enforced **both** in the matcher AND
    in the contract — defence in depth as a design property, not just a
    bullet point.
  - Mirrors Drift's BAL almost 1:1, which means the Drift v2 audit
    artefacts become a usable template.
- **Cons**
  - Solidity work outside the matcher repo. Sprint-2+ on fx-telarana:
    `FxPerpLpVault`, insurance-fund vault, LP-spread oracle, broadcast,
    audit.
  - 4-6 weeks for the contract + audit before the matcher's LP code
    can talk to anything real.
  - Phase 4 timeline elongates.

### Option C — hybrid (compromise)

Ship Path A on testnet today as a synthetic-LP proof-of-concept (rapid
iteration on the 12 invariants in Rust + Postgres). In parallel, design
+ audit the Path B contracts. Once Path B is deployed, the matcher swaps
its `lp_router` backend from synthetic to on-chain. The 12 invariants
stay the same; only the counterparty topology changes.

- **Pros**
  - No-blocking on Solidity for Phase 4 testnet ship.
  - Real iteration on the invariants before they hit mainnet.
  - Audit surface deferred but not skipped.
- **Cons**
  - Two surfaces to maintain for the duration; risk of synthetic-vs-contract
    drift during the transition.
  - Re-audit when the swap happens.

---

## Matcher-side LP routing (topology-agnostic)

Once topology is locked, the matcher gains a new module:

```
crates/matcher-server/src/lp_router.rs

pub async fn try_route_to_lp(
    db: &PerpsDb,
    onchain: &PerpsOnchain,            // queries OI, oracle, reserve
    lp_state: &LpStateView,            // path-A in-memory or path-B on-chain read
    intent: &TranslatedIntent,
    residual_size: Size,
    market_cfg: &MarketConfig,
    oracle: &OracleSnapshot,
    now_ms: u64,
) -> Result<Option<Fill>, LpRouterError>
```

Order of invariant checks (cheapest first, so we fail fast):

1. Invariant 10 (market enabled + not paused for LP) — pure read.
2. Invariant 4 (oracle freshness) — pure read.
3. Invariant 2 (mark-oracle divergence) — pure read.
4. Invariant 9 (reserve-vs-oracle band) — pure read.
5. Invariant 8 (per-intent size cap) — pure compute.
6. Invariant 1 (per-market OI cap) — `query_oi` RPC.
7. Invariant 3 (LP delta cap) — view query (path-dependent).
8. Invariant 5 (reduce-only on cap breach) — depends on (3); if breached
   and intent side doesn't reduce, reject.
9. Invariant 7 (size-dependent spread) — compute quote.
10. (Settlement path now triggers, which then handles 11 — funding settles
    before LP unwind — and 12 — `Fill { is_lp_fill: true }`.)

Invariant 6 (insurance fund first-loss) fires not on the per-intent path
but on a separate post-fill watchdog: after every LP fill that lands, the
watchdog re-computes LP realised PnL and triggers IF withdrawal if the
loss-threshold is hit. Path B implements this as a contract function the
matcher calls; Path A implements it as a Rust task.

---

## What this design does NOT cover

To keep the doc small and the gate clear:

- **LP yield distribution mechanics.** Depositor APR, share dilution math,
  redemption windows — all post-MVP. The Phase 4 design just needs to know
  LP shares exist (Path B) or LP positions exist (Path A); yield is layered
  on top.
- **Multi-asset LP backing.** Phase 4 is USDC-only LP. EURC / MXNB /
  cirBTC / TJPYC perp markets all settle against USDC LP via the
  clearinghouse's existing per-market collateral math.
- **LP curator role.** Who decides invariant 8's `max_lp_fill_per_intent`
  or invariant 9's band threshold? Phase 4 punts to "the deployer EOA
  can update these via `setLpConfig(market_id, ...)`"; governance is
  later.
- **Cross-market LP rebalancing.** Phase 4's LP is strictly per-market.
  Cross-market hedging belongs in a Phase 5+ market-maker layer.
- **LP withdrawals during stress.** Path B should have a `withdrawalQueue`
  with a cool-down to prevent bank-runs during volatile windows;
  exact mechanics are a Phase 4.1 spec extension once topology is locked.

---

## Open questions — answer before code

These are blockers for starting Phase 4 implementation. They are NOT
blockers for finalising this design doc — but resolving them turns the
doc from "design" into "implementation spec".

1. **Topology: A, B, or C?** This is the big one.
2. **`lp_delta_limit` default.** Drift sets this implicitly via share
   rebasing; we want an explicit number. Strawman: 25% of LP TVL per
   market, configurable per market.
3. **Oracle source for invariants 2 / 4 / 9.** Today the matcher doesn't
   read oracle data directly — `FxPerpClearinghouse._priceVerified` is
   strict (needs RedStone payload) and `_priceView` is lenient. The LP
   router probably needs a third path: a matcher-side oracle adapter that
   reads `FxOracle.latestAnswer()` or the Pyth feed directly via the
   `bufi-perps-onchain` crate. Strawman: a new `OracleSnapshot` type +
   `PerpsOnchain::oracle_snapshot(market_id) -> OracleSnapshot` view that
   pulls (last_update_ms, mark_e18, twap_5min_e18, confidence_bps).
4. **`max_lp_fill_per_intent` default.** Strawman: 10% of LP TVL per
   market.
5. **Reserve price** (invariant 9). Only meaningful if Path B has an AMM
   reserve. Path A's "reserve" is the matcher's synthetic LP position
   relative to spread quote; invariant 9 collapses into the spread
   function (invariant 7) under Path A.
6. **Insurance fund threshold** (invariant 6). Drift fires IF on any LP
   loss; we want a noise floor. Strawman: `if (lp_pnl_loss_in_window >
   max(0.01 * lp_tvl, $10_000_USDC)) burn_if(loss)`.

Strawman answers above are non-binding suggestions; the user/operator
locks each before the implementation PR.

---

## Phase 4 work breakdown (after topology lock)

| Sub-phase | Scope | Gates before next |
|---|---|---|
| 4a | This design doc + topology lock | User signs off on Option A/B/C |
| 4b | `crates/orderbook/src/lp.rs` — `LpStateView` trait + `Fill.is_lp_fill` plumbing | Compiles, 0 behaviour change for non-LP paths |
| 4c | `crates/matcher-server/src/lp_router.rs` — the 9 ordered invariant checks + spread quote | Unit + proptest for invariants 1, 3, 5, 7, 8, 10 |
| 4d | Oracle adapter (`bufi_perps_onchain::oracle_snapshot`) | Live `#[ignore]` test reads real oracle from Arc |
| 4e | Path-A only: `lp_positions` SQLite table + Rust task | Migration test |
| 4e' | Path-B only: `FxPerpLpVault` Solidity + deploy + ABIs | Audit pass |
| 4f | Wire into `tick.rs`: try_route_to_lp after CLOB walk | End-to-end golden against testnet |
| 4g | Insurance-fund watchdog (Path-A task or Path-B contract function) | Forced-loss integration test |
| 4h | Spec doc Phase 4 amendment, deletion of `is_lp_fill: false` defaults, audit checklist | All 12 invariants green |

Total estimated work post-design-lock: **6-8 weeks**, with the long pole
being Path B audit (if chosen) or operator-key risk acceptance (if A).

---

## Sign-off

This design doc is the source of truth for Phase 4. Any deviation in
implementation updates this doc in the same PR. Anyone reviewing LP code
starts here.

Two reviewers needed:
1. Matcher lead (correctness of the 12 invariants against Drift / JELLY).
2. Operator (risk acceptance for whichever topology is picked).
