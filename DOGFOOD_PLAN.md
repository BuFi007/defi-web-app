# BUFI HYPER — Consolidated Dogfood Plan

> Condenses `MCP_DOGFOOD_REPORT.md` (discoverability/transport/KISS) + `PRIVACY_DOGFOOD_REPORT.md` (shielded-pool privacy).
> Date: 2026-05-28 · Author: Opus 4.8

## Synthesis

Two findings dominate. **(1) Privacy is false-advertised:** the Groth16 layer is sound but cosmetic — plaintext arbitrary amounts collapse the anonymity set to 1, so the "trade privately" claim does not hold. This is the highest-severity item because it's a financial-privacy product making a promise it doesn't keep. **(2) The API is functional but not yet AI-first-simple:** four signing shapes, two unit conventions, two symbol grammars, fragmented reads. The transport/discoverability/schema gaps from the first report are already fixed this session; what remains is harmonization (KISS) and one residual schema gap.

Sequencing principle: **stop the bleeding → bank the wins → harmonize → fix privacy for real.** Cheap honesty fixes ship today; contract-level privacy is the largest effort and goes last but is tracked as the top severity throughout.

---

## Phase 0 — Stop the bleeding (today, S, low risk)

| # | Action | Why | Files |
|---|---|---|---|
| 0.1 | **Downgrade the privacy claim in llms.txt + ghost tool descriptions.** State plainly: deposits/withdrawals are amount-linkable; this is not unlinkable privacy yet. | Users must not rely on privacy that doesn't exist. Truth-in-advertising for a money product. | `apps/hyper-mcp/src/app.ts` (llmsTxt), `routes/ghost.ts` (mcp descriptions) |
| 0.2 | **Stop echoing plaintext `amount`/`recipient` in ghost responses;** note that one MCP operator sees both legs. | Removes the easiest off-chain correlation surface. | `routes/ghost.ts` |
| 0.3 | **Commit the already-done API fixes** (6 uncommitted files: lending positions route, MCP schema expander, ZodEffects unwrap, llms.txt map, test de-brittle). | Bank verified, test-green work before more churn. | (git) |

## Phase 1 — Close residual dogfood gaps (this week, S–M, low risk)

| # | Action | Why | Files |
|---|---|---|---|
| 1.1 | **Make self-describing MCP schemas a framework default,** not the `app.ts` wire-up. Expand `body` automatically when a converter is registered. | The `inputSchema` fix should apply to every future route for free. | `hyper/core/projection.ts`, `app.ts` |
| 1.2 | **Point the OpenAPI generator at the same `zodConverter`** so it stops emitting generic `Body` refs. Both re-dogfood agents fell back to `tools/list` because OpenAPI was useless. | One schema source → OpenAPI + MCP + client never drift. Closes the top residual gap. | `hyper/openapi*`, `app.ts` |
| 1.3 | **Spot-buy human units.** Accept `amountUsdc:"1"` (decimal string) on `spot_buy`; convert to atomic + derive `minAmountOut` server-side from the quote. Kill `amountInAtomic`/`minAmountOutAtomic` from the public surface. | The only real friction left in the spot path; llms.txt currently over-promises auto-conversion. | `routes/spot.ts` |

## Phase 2 — KISS harmonization (design first, then migrate; M–L, medium risk)

The AI-first-simple core. Each is back-compat-safe (add new, deprecate old on a date).

| # | Action | Why | Notes |
|---|---|---|---|
| 2.1 | **One signing lifecycle.** Every mutating action returns `{ intentId, typedData, digest, cost, expiresAt }`; one executor `POST /api/execute { intentId, signature }`. Spot/perp/lending/ghost all become prepare → execute. | Collapses 4 interaction patterns to 1. Biggest mental-model tax removed. | Design doc before code. Keep `trade/execute` as alias during migration. |
| 2.2 | **Human decimal strings at every boundary** (`"1.5"`), server converts. | Removes the atomic/human split system-wide (generalizes 1.3). | **Interacts with 3.1** — ghost deposits become *denominations*, not free amounts. |
| 2.3 | **One symbol grammar: `BASE/QUOTE` everywhere.** Spot buy = `EURC/USDC` + `side:"buy"`. | Spot's bare-token vs perp's pair is a needless second grammar. | |
| 2.4 | **One `/api/quote`** with `product:"spot"\|"perp"`, single response shape + `kind`. | The "overlap" the first report misread was really two unlabeled products. | |
| 2.5 | **`GET /api/portfolio/:trader`** → `{ perp, lending, spot }`. | Replaces 3-endpoint fan-out with one read. | |
| 2.6 | **Native `trader` field; deprecate aliases** (supplier/borrower/depositor/recipient) on a date. | The alias is a runtime band-aid; the `.refine().transform()` wrappers also broke schema-gen until patched. | |
| 2.7 | **Hide the two-chain split** (spot=Fuji 43113, perp=Arc 5042002) from the request contract. The `typedData` already carries `chainId`. | Agents shouldn't reason about chains. | |

## Phase 3 — Real privacy (contracts; highest severity, L, high effort)

The crypto is sound; the leak is amount handling. Re-dogfood until the adversary's anonymity set > 1.

| # | Action | Why |
|---|---|---|
| 3.1 | **Fixed denominations** (e.g. 1 / 10 / 100 per asset). Withdrawals must equal a denomination. | The single highest-leverage fix — makes amounts collide so a value is no longer a fingerprint. The Tornado lesson. |
| 3.2 | *If arbitrary amounts are a hard requirement instead:* **confidential amounts** (Pedersen commitments + range proofs) and/or **randomized relayer fees/splits** so withdrawn value never equals a single deposit. | Alternative to 3.1 when denominations aren't acceptable. |
| 3.3 | **Anonymity-set gating** — require N same-denomination deposits before a withdrawal; consider batched withdrawals. | Guarantees a set > 1 exists. |
| 3.4 | **Randomized time delays / mixing window.** | Kills the deposit→withdrawal timing proximity signal. |
| 3.5 | **Cross-currency: stop emitting both `amountIn` and `amountOut`; drop the single fixed published rate** (ranges/auctions). | Today `amountOut/0.92` re-links across assets — worse than same-asset. |
| 3.6 | **Re-run the privacy dogfood** (adversary, public-events-only) after each change; gate "private" claims on anonymity set > 1. | Don't restore the privacy claim until the adversary fails. |

---

## Cross-phase interactions (watch these)

- **2.2 (human units) × 3.1 (fixed denominations):** the ghost deposit endpoint is the exception to "arbitrary human amounts" — it must take a *denomination*, not a free value. Resolve 3.1 before finalizing 2.2's ghost surface.
- **0.2 (stop echoing) ⊂ 2.x:** the response-hygiene fix is a down payment on the harmonized envelope.
- **1.1/1.2 (schema source) enables 2.x:** once OpenAPI+MCP share one converter, every harmonized route self-describes for free.

## Do-first

1. **0.1 + 0.2** — privacy honesty (today; the only item with active user-harm risk).
2. **0.3** — commit the banked API wins.
3. **1.2** — OpenAPI converter (closes the residual gap, unblocks Phase 2 self-description).

Phase 3 is the highest *severity* and should start its design track in parallel, but it's contract work — it ships behind the cheap honesty fix in 0.1, not instead of it.
