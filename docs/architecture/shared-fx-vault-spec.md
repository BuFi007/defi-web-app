# SharedFxVault — single JIT liquidity source for empty FX pools

**Status:** spec / design (pre-implementation)
**Author:** generated 2026-05-28, grounded in `/v4-security-foundations` + `/adversarial-uniswap-hooks` (B4 rule)
**Threat surface:** lender capital · JIT settlement · oracle (Pyth on Arc)

---

## 0. TL;DR

Today each `FxSwapHook` (USDC/EURC `0xC6F894…`, USDC/AUDF `0xe66db5…`, USDC/MXNB `0x5410b9…`, QCAD/USDC `0x04a160…`) holds its **own** reserves. Capital is fragmented (~$10k × 4, USDC the binding reagent). We seed each pool separately.

**SharedFxVault** consolidates all reserves into **one** vault. Every FxSwapHook draws its fill from the vault just-in-time and settles back to it. The same dollar backs all pairs. Idle capital rehypothecates to Morpho (the hook already does this via `hotReservePct`). Lenders deposit into the vault and earn blended yield.

> The key realization: **our v4 pools carry zero concentrated liquidity by design.** The hook fully serves each swap through `beforeSwapReturnDelta` from its reserves — the pool is just a routable `PoolKey`. So "JIT" for us is *not* Aqua0's inject-a-`modifyLiquidity`-range-then-burn dance. It is simply **"pull the fill from a shared reserve vault at swap time."** Leaner, fewer moving parts, and it deletes Aqua0's worst surfaces (range accounting, transient-storage round-trip, backend-signed liquidity authorizations).

---

## 1. What we borrow from Aqua0 vs. what we drop

Aqua0 (`avax-aqua0-main`, MIT) validated the *shared-vault* thesis. But its mechanics are built for `x·y=k` pools that need real v4 liquidity injected per swap. We don't.

| Aqua0 piece | Keep / Drop | Why |
|---|---|---|
| Shared vault holds capital, hooks draw from it | **Keep (the thesis)** | Solves our fragmentation |
| `modifyLiquidity(+range)` in beforeSwap, burn in afterSwap | **Drop** | Our PMM custom-accounts; pools stay empty. No ranges. |
| Transient-storage range round-trip (`tstore`/`tload`) | **Drop** | No ranges to round-trip |
| EIP-712 backend-signed JIT authorization | **Drop** | Pricing is the oracle-anchored PMM, on-chain; no off-chain signer in the swap path |
| Vault-as-source/sink settlement (`fundHookSettlement` / `take→vault`) | **Keep (pattern)** | This is exactly the reserve plumbing we need |
| `poolId`-match guard | **Keep** | Per-pair isolation |
| ERC165 `onlyHook` "any inheritor is trusted" gate | **Drop — it was a flagged vuln** | Replace with an explicit per-hook **allowlist** |
| No on-chain LP accounting; backend-signed withdrawals | **Drop — unacceptable** | We build a real on-chain ERC-4626 ledger + solvency invariant |
| Zero tests | **Drop** | Fuzz + invariant suite is mandatory (Section 6) |

---

## 2. Architecture

```
            ┌──────────────────────── SharedFxVault (ERC-4626, USDC base) ─────────────────────────┐
 Lenders ──▶│  senior tranche: USDC supplied to Morpho Blue (M1/M2/M5) — safe overcollateralized   │
            │  hot buffer:    capped % of USDC + FX inventory held liquid for fills                  │
            │  junior tranche: protocol/active-LP first-loss equity (absorbs trading losses first)   │
            │  allowlist[hook] · perSwapCap · perBlockCap · paused · oracle handle                    │
            └───────▲───────────────────────────────────────────────────────────────────▲──────────┘
                    │ pull output / push input (settle/take)                              │
        ┌───────────┴──────────┐  ┌────────────┴─────────┐  ┌──────────┴───────┐  ┌──────┴──────────┐
        │ FxSwapHook USDC/EURC │  │ FxSwapHook USDC/AUDF │  │ …USDC/MXNB       │  │ QCAD/USDC (inv) │
        │ empty v4 pool +      │  │                      │  │                  │  │                 │
        │ beforeSwapReturnDelta│  │  oracle-anchored PMM (spread 30bps, k 50bps), per-pair immutable │
        └──────────────────────┘  └──────────────────────┘  └──────────────────┘  └─────────────────┘
                    │ getMid (Pyth, maxAge 60s, conf ≤30bps)
              ┌─────┴─────┐
              │ FxOracle  │◀── pyth-fx-pusher.sh keeps feeds fresh (no Chainlink/RedStone on Arc)
              └───────────┘
```

### 2.1 Components

- **SharedFxVault** — ERC-4626 (asset = USDC). Holds USDC + each FX token. Three accounting buckets:
  - *senior (lenders):* USDC supplied to Morpho Blue → safe base yield; redeemable from Morpho liquidity.
  - *hot buffer:* capped liquid reserve (USDC + FX) that fills swaps. Refilled from Morpho on a low-water mark.
  - *junior (first-loss):* protocol + active-LP equity, takes JIT losses before senior. Locked / withdrawal-delayed.
  - Real on-chain per-share accounting (NO backend signer). Swap PnL accrues to share price.
- **FxSwapHook (refactored)** — keeps immutable `TOKEN0/TOKEN1` (per-pair isolation = Section H). Reserves move from "self-held" to "vault-backed": on a fill, `beforeSwap` computes the PMM price, returns the `BeforeSwapDelta`, pulls output token from the vault and pushes input token to the vault via the v4 settle/take plumbing. The hook becomes a thin **pricing + settlement** layer; the vault is the single reserve.
- **FxOracle + pyth-fx-pusher** — unchanged; the staleness fix (running pusher) is a hard dependency of this design.

### 2.2 Swap flow (one pool, empty)

1. Router calls `PoolManager.swap(poolKey, params)`; pool has zero v4 liquidity.
2. `beforeSwap(sender, key, params, hookData)`:
   - `onlyPoolManager` + `allowedRouter[sender]` (Section A/Verification).
   - validate `key.toId()` ∈ this hook's pool (Section H).
   - read oracle mid (`getMid`, reverts if stale >60s / conf >30bps / dev >50bps).
   - **enforce per-swap notional cap** vs hot buffer (the single most important lender-capital guard given Arc has only one oracle).
   - compute PMM output (spread + k), build `BeforeSwapDelta(specified, unspecified)` — **never exceeds input** (Section A NoOp guard).
   - settle: pull output token from vault → `take`/`settle` so `sum(deltas)==0` (Section C). Input token lands in the vault.
3. `afterSwap`: record fee/PnL to the vault; refill hot buffer from Morpho if below low-water.

---

## 3. What makes sense / what doesn't

**Makes sense**
- Shared *reserve* vault (not range-JIT) — matches our custom-accounting PMM; minimal new surface.
- Reuse `hotReservePct` Morpho rehypothecation already in `FxSwapHook` — idle lender capital earns safe yield.
- Senior(lend)/junior(first-loss) tranching — lets the senior tranche be near lending-grade.
- Per-hook allowlist on the vault + per-swap / per-block caps + pause.
- One vault backs N pairs → exactly dissolves the seeding fragmentation.

**Doesn't make sense / explicitly avoid**
- Aqua0-style `modifyLiquidity` range injection — unnecessary for an empty-pool PMM; pure added risk.
- Leveraged Morpho *borrow* to fund JIT — leverage on a market-making book + liquidation risk on lender principal. **No.**
- A single hook serving all pairs via mutable pricing state — breaks per-pair immutability (Section H). Keep one hook per pair.
- Auto-trusting any ERC165 hook inheritor (Aqua0's bug) — use an explicit allowlist.
- Single-oracle pricing *without* a per-swap size cap + deviation circuit breaker — on Arc there is **no second oracle** (Chainlink/RedStone absent), so size-capping is load-bearing, not optional.
- Backend-signed withdrawals / off-chain balance ledger — unacceptable for lender funds.

---

## 4. Threat catalog → baked-in mitigations (B4 sections)

| # | Threat (skill section) | Vector | Mitigation in this spec |
|---|---|---|---|
| T1 | **NoOp rug — `beforeSwapReturnDelta` CRITICAL** (Foundations; Sec A) | Hook returns a delta claiming it filled but doesn't deliver / exceeds input → drains | Delta math vendored from existing FxSwapHook PMM; **assert delta ≤ input**; settle exactly what is pulled; invariant test `sum(deltas)==0` per swap |
| T2 | **Oracle stale / manipulated** (Sec E) — *top lender-capital risk* | Mispriced fill drains the vault | `getPriceNoOlderThan(60)` revert (already) + conf ≤30bps + dev ≤50bps + **per-swap notional cap vs hot buffer** + **max-move circuit breaker** vs last-accepted price + pusher must be live. No 2nd oracle on Arc → caps are the real defense. |
| T3 | **Oracle update inside beforeSwap** (Sec E) | `updatePriceFeeds` mid-swap → reentrancy/ordering | Hook only *reads* (view) the oracle; pushing is external (pusher). Never call `updatePriceFeeds` inside the callback. |
| T4 | **Delta accounting drain** (Sec C, B) | bad settle/take, vault re-entered mid-swap | sync→transfer→settle order; vault funds settlement / `take`→vault; vault `nonReentrant` and **never calls PoolManager**; no external token callbacks (no ERC-777) |
| T5 | **Arc USDC blocklist / asset semantics** (Sec J) | USDC (`0x3600`) `transferFrom` hits the `0x1800…0001` blocklist precompile; vault/hook could be blocklisted → settlement + withdrawals brick | Treat blocklist as a liveness risk: monitor; pausable; never assume transfer succeeds (check return / measure balance delta); decimals per token (USDC 6, JPYC 18, cirBTC 8); `SafeERC20` + `forceApprove(exact)`→0 |
| T6 | **Multi-pool cross-contamination** (Sec H) | one pool attacks another; QCAD pair is **token0=QCAD** (inverted) | per-hook allowlist; per-`PoolId` state; never assume `currency0<currency1`; hooks keep immutable pairs |
| T7 | **Adverse selection / sandwich** (Sec F) | toxic flow picks off JIT LP | oracle-anchored PMM means price is **not** reserve-movable (sandwich can't shift it) — structural defense; spread (30bps) + k curvature compensate; per-swap cap bounds a single toxic fill |
| T8 | **Withdrawal griefing** (lender) | attacker drains hot buffer so lenders can't redeem | senior tranche redeems from **Morpho liquidity** (always available); hot buffer is a small capped slice; junior tranche is delay/locked first-loss |
| T9 | **Admin rugpull / over-permission** (Sec G) | `setOracle`/`setSpread`/`hotReservePct`/allowlist abuse | role-gated (`Ownable2Step` + roles); bounded ranges; **timelock** on reserve-touching params; `pause()` kill switch owned by the hook/vault; events on every change |
| T10 | **AI-written hook bugs** (Sec K) | invented signatures, mis-cast int128, fabricated APIs | every interface verified against vendored `v4-core`; `toBeforeSwapDelta(int128,int128)` exact; curve math = existing audited-by-us FxSwapHook, not re-derived; run `/codex:adversarial-review` after build |

---

## 5. Performance / efficiency wins (the "advance the protocol" goal)

- **Capital:** 1 vault backs all pairs → no $10k×N fragmentation; idle earns Morpho instead of sitting dead.
- **Lender product:** passive USDC deposit → blended (Morpho + FX-fee) yield, senior-protected → real TVL inflow vs. us self-seeding.
- **Gas:** `beforeSwap` budget < 50k. Vault pull adds ~one external call (~2.6k + vault logic) — keep vault hot-path branchless; use transient storage for any cross-callback scratch; cache oracle read.
- **Ops:** fewer reserves to manage; one Morpho rehyp loop, not four.

---

## 6. Risk score & audit gate

Per Foundations risk scoring (0–33): permissions (beforeSwap + beforeSwapReturnDelta + afterSwap ≈ CRITICAL band) + external calls (vault, Morpho, oracle) + state complexity (ERC-4626 + tranches) + upgrade (if UUPS) + token handling (blocklist/decimals) ⇒ **HIGH→CRITICAL**.

Gate: professional audit **required** before lender deposits open. Mandatory pre-ship: fuzz tests, invariant tests (`sum(deltas)==0`, vault solvency `assets ≥ senior_claims`, hot-buffer never negative), fork tests on Arc, Slither, and a full `/adversarial-uniswap-hooks` report with no open blockers. (Aqua0 shipped with zero tests — we do the opposite.)

---

## 7. Migration plan (phased, canary, security-gated)

- **P0 — this spec** + adversarial audit of the design. ✅ in progress.
- **P1 — build SharedFxVault** (ERC-4626, Morpho rehyp, allowlist, caps, pause, real accounting) + full test suite. No mainnet money.
- **P2 — refactor one FxSwapHook** (EURC, most liquid) to draw from the vault; keep immutable pair. New hook ⇒ new address (immutable `ORACLE`/reserve wiring) ⇒ redeploy that hook + re-init pool.
- **P3 — migrate EURC reserves**: `redeem()` current hook reserves → deposit into vault → point new EURC hook at vault. We own all LP shares ⇒ clean. Canary swaps; watch invariants.
- **P4 — roll out AUDF/MXNB/QCAD** (MXNB also needs the oracle redeploy for inverted USD/MXN — already parked).
- **P5 — open senior-tranche lender deposits** only after the external audit + bug bounty.

Each phase is independently revertible; no phase opens lender deposits before the audit gate.

---

## 8. Open decisions

1. **Vault upgradeability:** immutable (safest, Section G) vs UUPS (Aqua0's choice; adds rugpull surface). Lean immutable + new-deploy migrations.
2. **One hook per pair (recommended) vs one multi-pair hook** — recommend per-pair for immutability/isolation.
3. **Junior tranche source:** protocol treasury only, or open junior deposits with a lockup?
4. **Circuit-breaker thresholds:** per-swap cap (% of hot buffer) and max-price-move bps — needs sizing against expected FX vol.
5. **Does the senior tranche stay 100% in Morpho** (pure rehyp) **or also directly fill?** Purer senior = safer = lower yield.

---

*Build references: Aqua0 `avax-aqua0-main` (MIT) for the vault thesis; OZ `BaseCustomCurve`/`BaseCustomAccounting` for settle/take safety; existing `FxSwapHook.sol` for the PMM math (do not re-derive). Run `/adversarial-uniswap-hooks` against the implementation, not just this spec.*

---

## P1 build + adversarial audit (2026-05-28)

Built: `fx-telarana/contracts/src/vault/SharedFxVault.sol` (UUPS, OZ-upgradeable v5.0.2) + `interfaces/ISharedFxVault.sol` + `test/vault/SharedFxVault.t.sol` (**16/16 passing**). Adversarial pass via `/codex challenge` (gpt high). ERC-7201 slot verified against `cast index-erc7201`. Findings + resolutions:

| Sev | Finding | Fix (committed) |
|---|---|---|
| **CRITICAL** | `DEFAULT_ADMIN` is admin of all roles → admin self-grants `UPGRADER_ROLE`, bypasses timelock, upgrade-rugs | `_setRoleAdmin(UPGRADER_ROLE, UPGRADER_ROLE)` in `initialize` — UPGRADER is self-administered; only the timelock can grant it. Tests: `upgraderRoleIsSelfAdministered`, `adminCannotSelfGrantUpgrader`, `adminCannotUpgrade`. |
| **HIGH** | Stale Morpho NAV (principal-only) → enter-low/redeem-high yield theft | `totalAssets()` reads live Morpho assets (`position`+`market`+`SharesMathLib.toAssetsDown`). Test `morphoRehyp_liveNavIncludesPosition`. (Pre-P5: add accrual-on-entry/exit for exactness.) |
| **HIGH** | `poolManager` arbitrary → allowlisted hook redirects junior funds to itself | Canonical `poolManager` pinned in `initialize`; `fundFill` reverts `PoolManagerMismatch` otherwise. Test `fundFill_rejectsWrongPoolManager`. |
| **HIGH** | Hook-reported `usdcNotional` makes caps fiction (`fundFill(asset, big, attacker, 0)`) | USDC-out requires `usdcNotional >= outAmount` (`NotionalBelowOutput`); FX-out bounded by inventory + caps. Test `fundFill_rejectsUnderstatedNotional`. (P2: vault-side oracle pricing of FX-out.) |
| **MED** | `recordInflow` inflates the cap denominator mid-block | Cap denominator is a start-of-block snapshot (`capBaseJuniorUsdc`). Test `recordInflow_cannotInflateCapDenominatorMidBlock`. |
| **MED** | `recordInflow` not paused | `whenNotPaused` added. Test `pause_blocksDepositFillAndInflow`. |
| **MED** | exact-transfer assumption | `fundJunior` credits the measured balance delta. |
| **LOW** | donation → junior | acknowledged/intended (any inflow is junior); documented. |

Verified clean by Codex: ERC-7201 slot correct, `_disableInitializers()` present, no `selfdestruct`/`delegatecall`.

---

## P2 — FxSwapHook vault-backed (2026-05-28)

`FxSwapHook` now sources reserve custody from `SharedFxVault` (PMM pricing unchanged). New `beforeSwap` settlement (custody moves to vault; PM-side deltas identical):
```
inputCurrency.take(POOL_MANAGER, address(VAULT), amountIn, false);  // input → vault
POOL_MANAGER.sync(outputCurrency);
VAULT.fundFill(outputToken, amountOut, address(POOL_MANAGER));      // vault → PoolManager
POOL_MANAGER.settle();
```
`afterSwap` → `VAULT.recordInflow(inputToken)`. Reserve reads + `sync()` + quote views → `_vaultReserve` (= `juniorUsdc`/`juniorTokenBalance`). `deposit()`/`redeem()` deprecated (`UseVault()`). Constructor adds `VAULT`. **Vault-side oracle pricing of FX-out notional**: `fundFill` dropped the trusted `usdcNotional` param — vault computes it (`outAmount` for USDC-out, `getMid` for FX-out, reverts if stale). Net −13 LOC on the hook; ~85 more LOC of dead Morpho/LP code to remove in cleanup.

Tests: `test/hub/FxSwapHookVaultBacked.t.sol::test_swapRoutesThroughVault` — real v4 `PoolManager` + `FxV4RouterHarness`, mined hook salt: a 1000 USDC→EURC swap routes through the vault (junior USDC +1000, junior EURC −output, senior untouched). Vault suite still 16/16.

### Adversarial pass (`/codex challenge`, hook surface) — settlement CONFIRMED SAFE
Codex verified the v4 custom-accounting is correct (input `take` = hook debt, vault-transfer + `settle` = hook credit, `(+amountIn,−amountOut)` nets the hook, **cap reverts are atomic** → no NoOp/delta bug). Fixed immediately: MED `redeem()` could mutate live PMM targets → now reverts `UseVault()`; LOW quote views read self-custody → repointed to `_vaultReserve`.

**Two architectural findings — contained for the EURC canary, GATING before multi-pool + lender deposits:**
1. **Shared buffer has no per-pool allocation** (`juniorUsdc` is global). Fills are oracle-priced so there's no *value* theft, only inventory consumption — BUT a single pool with a stale/mispriced oracle would endanger the *shared* junior buffer. Mitigation now: only allowlist oracle-fresh pools (pusher-backed) + per-swap/per-block caps. Before multi-pool: add per-hook/per-pool reserve slices keyed by `poolId`.
2. **An allowlisted hook is fully trusted** (it can `take` from the PoolManager inside an unlock after `fundFill`). `HOOK_ROLE` IS the trust boundary. Mitigation: keep the allowlist tiny + audited + **timelock `allowHook`** before production; only our audited hook is allowlisted for the canary.

Neither is exploitable for the single-pool, single-audited-hook, oracle-fresh EURC canary. **Next: P3** — deploy the vault-backed EURC hook (mined salt) + `allowHook` + fund junior + migrate the EURC pool; then per-pool allocation + timelocked `allowHook` before AUDF/MXNB/QCAD join the shared buffer.
