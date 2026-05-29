# Privacy Re-Dogfood — Confirmation Run

Amnesia-loop dogfood of **prod** BUFI HYPER MCP, run to confirm the privacy slices
(`b31a993`) shipped and behave correctly from a cold-start agent's view, with a
trading control to catch regressions.

> Supersedes the prior contract-level privacy audit (kept in git history). This run
> is the post-deploy confirmation that the MCP-side slices are live and discoverable.

## Run metadata

| Field | Value |
|---|---|
| Target | `https://mcp.bu.finance` (prod) |
| Date | 2026-05-28 |
| Method | 4 fresh amnesia sub-agents, canonical surfaces only, source reads forbidden |
| Wallet | `…6cc7` (Arc Testnet agent wallet) |
| MCP tools | 40 (6 ghost: `privacy_check`, `pools`, `deposit`, `relay`, `swap`, `pnl`) |
| llms.txt | 8,974 B |
| openapi.json | 11,431 B |
| Canonical surfaces | `/`, `/llms.txt`, `/openapi.json`, `/mcp`, `/health` — all 200 |

## Per-task results

| Task | Status | Calls→1st success | Guesses | Source leak | Wrong-tool | Unhelpful 4xx |
|---|---|---|---|---|---|---|
| privacy-check linter | ✅ | 4 | 1 | 0 | 0 | 0 |
| ghost deposit leak-check | ✅ | 3 | 0 | 0 | 1 | 1 |
| ghost withdraw / relay | ✅ | 1 | 1 | 0 | 0 | 0 |
| spot trade (control) | ✅ | 1 | 1 | 0 | 0 | 0 |

**All 4 succeeded. Zero source-leakage across all loops** — docs were sufficient; no
agent needed to read project source. Discovery efficient (1–4 calls to first
success, all far under the 30-call budget).

### 1. privacy-check linter — ✅ CONFIRMED
Fresh agent found `POST /api/ghost/privacy-check` via OpenAPI path-grep, called it
worst- and best-case:
- Worst (unique amount, reused recipient, self-submit, 0s): **score 0 / "deanonymizing"**, 4 risks (`AMOUNT_FINGERPRINT` high, `RECIPIENT_CLUSTERING` high, `MSG_SENDER_LEAK` critical, `TIMING_CORRELATION` high), each with a concrete fix.
- Best (round 100, fresh recipient, relayer, 86400s): **score 100 / "best-effort-clean"**, 2 residual it refuses to hide (`AMOUNT_PUBLIC_BASELINE` medium, `MSG_SENDER_RELAYER_UNVERIFIED` low).
- **Honesty verdict: fully honest, never says "anonymous."** `privacyNotice.level="weak"`; `bestEffortDisclaimer` states a high score means "you avoided self-inflicted leaks, not unlinkable" and that the anonymity set is ≈1 by amount-matching regardless of score.
- Independently corroborated by `GET /api/ghost/pools` → `latestRoot=null` (near-empty tree → anon set ≈1), matching the warning.

### 2. ghost deposit leak-check — ✅ CONFIRMED (the response-trim slice works)
- Prepare response **does NOT echo depositor/trader address** — the response-trim slice is live and effective.
- Amount (`amountAtomic:"5000000"`) is cleartext **by on-chain design and explicitly disclosed**, not an accidental leak.
- Structured `privacyNotice` present on the response **including the `offChain` field** (single-operator correlation warning) — the off-chain-disclosure slice is live.

### 3. ghost withdraw / relay — ✅ CONFIRMED + ⚠️ OPERATIONAL FINDING
- `relayerSubmission` block present and honest; relay/swap explain how to avoid `msg.sender` linkage via the relayer; cross-currency flagged as leaking more (`amountIn`+`amountOut`) and on-chain-gated (`SwapAdapterNotSet`).
- **⚠️ `relayerSubmission.available = FALSE` on prod right now** (`GHOST_RELAYER_URL` unset). The single biggest privacy lever (relayer as `msg.sender`) is **designed-for but not functional on this deployment**. The linter correctly warns about exactly this and tells the agent to verify `relayerSubmission.available===true` before relying on it. This is the known, tracked, review-gated infra item (relayer deploy + funded key + set `GHOST_RELAYER_URL`) — confirmed still pending on prod.

### 4. spot trade (control) — ✅ NO REGRESSION
- Reached a complete unsigned spot quote (10 USDC → 8.585404 EURC) in 5 calls, first-success on the first market read. Preflight correctly flags `allowance=0` + exact spender/token/amount to approve.
- **Privacy changes are well-isolated** — ghost warnings live in their own llms.txt section and do not intrude on the spot/perp path.

## Aggregate gaps (frequency × severity)

| # | Gap | Freq | Sev | Fix surface |
|---|---|---|---|---|
| G1 | **OpenAPI 200 responses declare NO schema** for every ghost endpoint (+`spot/quote`). The load-bearing bodies (`score`/`risks[]`/`privacyNotice`/`relayerSubmission`/contract payload) are undocumented — agents must blind-call to learn the contract. | 4/4 | High | OpenAPI response schema (route output schemas) |
| G2 | **Dangling pointers** — `privacyNotice.trackedFix`/risk text cite `audit #3/#6/#7` and `DOGFOOD_PLAN.md Phase 3`, unresolvable from the 5 canonical surfaces. | 3/4 | Med | Replace with a public URL or inline one-liner |
| G3 | **`relayerSubmission.available=false` + no relayer submission API documented** — even when configured, no endpoint/fee/proof-POST shape is given. | 2/4 | Med (infra) | Relayer deploy (review-gated) + doc the submit shape |
| G4 | **Precommitment/proof construction undocumented** — response says "hash client-side with snarkjs" but no hash fn (Poseidon?), field ordering, circuit-artifact location, or how to obtain the current merkle root (`latestRoot=null`). | 2/4 | Med | llms.txt "build a proof" section + artifact URLs |
| G5 | **MCP `body` wrapper not named in 400** — `tools/call` wraps REST args under `body`; the validation error says `path:[] Required` without naming `body`. | 1/4 | Low | Error message: name the `body` field |
| G6 | **Doc vs live market drift** — `/api/markets` returns 6 perps incl. QCAD; llms.txt lists only 5. No machine-readable spot-market registry. | 1/4 | Low | Regenerate llms.txt market list from registry |

## Suggested patches (review — do not auto-apply)

1. **G1 (highest leverage, in-lane, additive):** declare output/response schemas on the ghost + `spot/quote` routes so OpenAPI emits the real body shape. Touches the route definitions in `apps/hyper-mcp/src/routes/{ghost,spot}.ts` + the OpenAPI projection. Pure doc-quality; no behavior change.
2. **G2:** swap `audit #N` / `DOGFOOD_PLAN.md` references in `PRIVACY_NOTICE` for a public URL or a one-line inline explanation (those files aren't agent-reachable).
3. **G4:** add a short "constructing a ghost proof" block to llms.txt (Poseidon hash, field order, circuit-artifact CDN URL, where to read `latestRoot`).
4. **G5:** have the MCP request-validation error name the missing top-level `body` field for `tools/call`.
5. **G6:** regenerate the llms.txt Markets list from the live registry (QCAD missing).
6. **G3 (infra, review-gated, NOT in this lane):** deploy `relayer-privacy` + funded key, set `GHOST_RELAYER_URL` so `relayerSubmission.available` flips true and the `MSG_SENDER_LEAK` lever actually works on prod.

## What's working (keep)

- The **privacy-check linter is the standout** — honest, conservative, never over-promises; corroborated by live pool state.
- **Every ghost response self-describes** via embedded `privacyNotice` (incl. `offChain`) + `relayerSubmission` — discoverable just by calling prepare.
- **Deposit response respects the depositor dimension** (no address echo) — the trim slice works.
- **llms.txt is the hero surface** — candid "Ghost Mode — maximizing privacy today" section with the 5 mitigation knobs; spot routing table enabled first-call trade success.
- **Privacy work is well-isolated** — zero regression to the mainline trading UX.
- MCP tool descriptions (`GET /mcp`) are richer and more honest than the OpenAPI descriptions.
