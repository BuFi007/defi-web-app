# MCP Dogfood Report

> Run: 2026-05-28
> Target MCP: `bufi-hyper-local` → `http://localhost:4002`
> Model: Opus 4.8 (1M context)
> Loops: 4 (mvp pack: markets → quote → positions → spot dry-run)
> Wallet (read-only, known test addr): `…E21Eb`
> Skill: `/circle-agent-wallet-to-mcp-dogfooding`

## Canonical surface snapshot

| Surface | Status | Bytes | Notes |
|---|---|---|---|
| `GET /` | 200 | 343 | Landing JSON. Advertises `tools: 40`, links llms.txt + openapi + mcp. Clean. |
| `GET /llms.txt` | 200 | 18,954 | Rich, agent-readable. Conceptual flow good; concrete request bodies missing. |
| `GET /openapi.json` | 200 | 25,934 | 38 paths. Thin response schemas; required-field flags inconsistent. |
| `GET /mcp` (landing) | 200 | 1,426 | 40 tools listed. This is the discoverable MCP path. |
| `POST /mcp` `tools/list` (cold) | error | 341 | **`NO_SESSION`** — requires `initialize` handshake first. Error object has a **duplicated `error` key** (malformed JSON-RPC). |
| `GET /health` | 200 | — | OK. |

## Per-task results

| Loop | Task | Outcome | Primary surface | HTTP calls | Gaps | Result |
|---|---|---|---|---|---|---|
| 1 | List markets | ✅ success | openapi | 4 | 3 | 5 markets returned |
| 2 | Quote $5 EURC buy | ✅ success | llms.txt | 9 | 4 | quote @ 1.1627, 3bps |
| 3 | Read positions | ✅ success | openapi | 6 | 4 | none (clean empty) |
| 4 | Spot buy dry-run | ✅ success | llms.txt | 11 | 4 | unsigned EIP-712 obtained, no broadcast |

**Discovery efficiency**: 4 / 9 / 6 / 11 calls. All under the 30-call budget. Loop 1 was cleanest (4, zero wrong turns); Loop 4 was worst (11) — entirely due to endpoint-overlap confusion, not API depth.

## Aggregate gaps (severity × frequency)

### CRITICAL — Endpoint overlap, no canonical path documented (3/4 loops)

The single biggest finding. Multiple overlapping endpoints with no doc telling an agent which to use:

- **Quote**: `/api/quote` and `/api/spot/quote` both return 200 with similar data (loop 2). Which is canonical for spot?
- **Trade**: `/api/spot/buy` vs `/api/trade/prepare` + `/api/trade/execute` (loop 4). The cautious dry-run path is `trade/prepare`, but `/api/spot/buy` looks like the obvious spot entrypoint and 400s. An agent wastes calls discovering that spot orders flow through the *generic* `/api/trade/*` pair, not `/api/spot/*`.
- The relationship between the `/api/spot/*` family and the `/api/trade/*` family is undocumented anywhere.

**Fix surface**: `llms.txt` + OpenAPI `description`. State the canonical flow explicitly: "Spot and perp orders both use `POST /api/trade/prepare` → sign → `POST /api/trade/execute`. `/api/spot/quote` is for pricing only. `/api/spot/buy` is [deprecated / convenience / X]."

### HIGH — llms.txt has the mental model but no concrete request examples (3/4 loops)

- Loop 1: no symbol enum or sample `/api/markets` response → agent can't know valid symbols without a live call.
- Loop 2: quoting described, but no concrete curl + exact JSON body → had to reverse-engineer from openapi.
- Loop 4: prepare→sign→execute described conceptually, but doesn't say *spot goes through `/api/trade/prepare`*.

**Fix surface**: `llms.txt`. Add a "Copy-paste recipes" section: one concrete curl per core task (quote, prepare, execute) with the exact body.

### HIGH — No unified portfolio; per-wallet reads fragmented (loop 3)

- Holdings are split across `/api/positions/{address}` (perps), lending (global-only), and ghost (POST). No single "portfolio for address" call.
- **Lending has no per-wallet read endpoint at all** — only `/api/lending/markets` (global). An agent cannot determine a wallet's supplied/borrowed balances from the HTTP surface.

**Fix surface**: new endpoint `GET /api/portfolio/{address}` (or document the fan-out explicitly) + add `GET /api/lending/positions/{address}`.

### HIGH — `POST /mcp` `tools/list` cold fails with NO_SESSION (baseline)

The documented JSON-RPC path requires an `initialize` handshake first; a fresh agent calling `tools/list` directly hits `NO_SESSION`. The GET `/mcp` landing (which returns all 40 tools without a session) is the actually-discoverable path — but the JSON-RPC path is what most MCP clients try first.

Plus: the error object serializes a **duplicated `error` key**, which is malformed JSON-RPC.

**Fix surface**: MCP transport. Either (a) allow stateless `tools/list`, or (b) make the `NO_SESSION` error body name the exact `initialize` call needed. Fix the duplicate-key serialization.

### MEDIUM — OpenAPI response schemas are thin / required-fields unflagged (3/4 loops)

- `/api/markets` 200 response has no concrete market-object schema (loop 1).
- `/api/positions/{address}` empty-state shape undocumented — empty array vs 404 (loop 3).
- `/api/trade/prepare` request schema doesn't mark required vs optional → first call 400s (loop 4).

**Fix surface**: OpenAPI. Fill in response schemas + `required: [...]` arrays. These are auto-generated from zod in `apps/hyper-mcp/src/routes/*` — tighten the zod schemas and add `.describe()`.

### MEDIUM — Markets mix live + zero-address placeholders; no `enabled` flag (loop 1)

`/api/markets` returns entries with `0x000…000` base tokens (not-yet-deployed) alongside real ones, with no clear tradeable flag.

**Fix surface**: API + OpenAPI. Add an `enabled`/`tradeable` boolean and document it.

### MEDIUM — Symbol format ambiguity (loops 1 & 4)

FX-style `EUR/USD` vs token-pair `EURC/USDC` — unclear which string to pass to downstream quote/trade calls.

**Fix surface**: `llms.txt` + OpenAPI examples. Pin one canonical symbol format and show it in every example.

## What's working (positive ledger — keep these)

- **Root discovery is excellent**: `GET /` instantly exposes llms.txt + openapi + /mcp. Every loop oriented in 1–2 calls. Don't touch this.
- **400 error bodies name the missing field** — agents self-corrected after a bad call in loops 2 and 4. High-value behavior.
- **A real dry-run path exists**: `/api/trade/prepare` returns unsigned EIP-712 typed-data without broadcasting, and `/api/trade/execute` correctly rejects unsigned/invalid submissions with 400. Exactly what a cautious agent needs.
- **Reads need no auth** — markets, positions, quotes all work unauthenticated. Good for read-only agents.
- **Empty position state returns a clean 200 empty array**, not a 404. Correct REST semantics.
- **prepare → sign → execute mental model in llms.txt is correct** and oriented every trading loop quickly.

## Suggested patches (review before applying — not auto-applied)

1. **`apps/web/public/llms.txt`** — add "Canonical trading flow" section: spot AND perp both go `trade/prepare → sign → trade/execute`; clarify `/api/spot/*` role. Add a "Copy-paste recipes" block with one concrete curl per task.
2. **`apps/web/public/llms.txt`** — pin canonical symbol format (e.g. always `EURC/USDC`) and use it in every example.
3. **`apps/hyper-mcp/src/routes/markets.ts`** — add `enabled` flag to market objects; tighten the zod response schema + `.describe()` so OpenAPI carries the shape.
4. **`apps/hyper-mcp/src/routes/quote.ts` + `spot.ts`** — document/deprecate the `/api/quote` vs `/api/spot/quote` overlap; mark one canonical.
5. **`apps/hyper-mcp/src/routes/trade.ts`** — in the MCP tool annotations for `post__api_trade_prepare` / `post__api_spot_buy`, add a "When to use / not use" block cross-linking siblings.
6. **`apps/hyper-mcp/src/routes/lending.ts`** — add `GET /api/lending/positions/{address}`.
7. **New** — `GET /api/portfolio/{address}` unified read (or document the perps/lending/ghost fan-out in llms.txt).
8. **MCP transport** — make `tools/list` work statelessly OR have the `NO_SESSION` error name the required `initialize` call; fix the duplicated `error` key in the error object.

## Top 3 fixes (do these first)

1. **`llms.txt` + OpenAPI** — **endpoint overlap** (`/api/spot/buy` vs `/api/trade/prepare`, `/api/quote` vs `/api/spot/quote`). Mentioned in 3/4 loops, cost the most wasted calls. Document the one canonical trade flow.
2. **`llms.txt`** — **concrete copy-paste request recipes** (3/4 loops). The mental model is there; the exact JSON bodies are not.
3. **API** — **per-wallet portfolio reads** (loop 3): no unified holdings call, and lending has *no* per-wallet read at all.

## Prod run — 2026-05-28 (against https://mcp.bu.finance, post-deploy-fix, Opus 4.8)

First dogfood against **production** after fixing the Railway deploy (CI only ever deployed `bufi-api`→fx-api.bu.finance, never `bufi-hyper-mcp`→mcp.bu.finance — see DOGFOOD_PLAN / commit `3973449`). Phase 0/1 is now live on prod.

**Transport handshake (Step 1.5) on prod — all PASS:** SSE GET ✓, initialize returns protocolVersion + mcp-session-id ✓, notifications/initialized → 204, cold tools/list → 39 tools (no NO_SESSION). The native MCP client (`claude mcp list`) shows `bufi-hyper: ✓ Connected` for the first time.

Three fresh amnesia loops, all **success**:

| Loop | Calls | Result |
|---|---|---|
| Lending positions read | 3 | `GET /api/lending/positions/{address}` found on call 1; no confusion with global markets or perps |
| 1-call spot buy ($1 EURC) | 4 | accepted human `"1"`, server derived atomic + expectedOut + minAmountOut (100bps); single `POST /api/spot/buy` reached unsigned typed-data — no pre-quote needed |
| Unified portfolio | 5 | `GET /api/portfolio/{address}` found in 2 calls, returns `{perp,lending}`, no fan-out |

All three Phase-0/1 gaps confirmed CLOSED on prod. New (minor, doc-only) gaps surfaced:

1. **llms.txt "Connect" section shows stale `localhost:4002` URLs** (MCP URL + `claude mcp add` snippet) instead of `https://mcp.bu.finance`. A fresh agent/user on prod copies the wrong install command. **Fix surface: llms.txt.**
2. **llms.txt "Spot Buy" recipe undersells the new ergonomics** — still implies `minAmountOut` is a required caller-supplied atomic slippage floor, but `spot_buy` now derives it from a human amount + default slippage. Could mislead an agent into needless atomic/slippage math. **Fix surface: llms.txt.**

Wins worth keeping: the spot-vs-perp table + chain labels gave zero endpoint ambiguity; human amounts + server-derived slippage removed all unit math; cross-product reads (lending/portfolio) self-described and cross-validated.

## Re-dogfood delta — 2026-05-28 (post-Gateman fixes, Opus 4.8)

Gateman audit of the run above found ~40% of the headline findings false or misdiagnosed (verified against fresh-from-disk source):
- **`tools/list` NO_SESSION + duplicate `error` key** — FALSE. `NO_SESSION` exists nowhere in source; cold `tools/list` returns 37 tools clean. Not actioned.
- **"Endpoint overlap" (CRITICAL)** — MISDIAGNOSED. `/api/quote` (perp, Arc 5042002) and `/api/spot/quote` (spot, Fuji 43113) are different products on different chains, not duplicates. Re-scoped to a labeling gap; fix was docs, not deprecation.
- **Markets zero-address / missing `enabled` flag** — FALSE. 6 real markets, all `enabled=true`; flag already exists.
- **Lending per-wallet read missing** — TRUE. Actioned.
- **Thin `inputSchema`/types** — TRUE. Actioned.

Fixes applied, then re-dogfooded with fresh amnesia agents:

| Gap | Before | After |
|---|---|---|
| Spot-vs-perp endpoint choice | 11 calls, worst loop, confusion | correct endpoint by call #2, clear from llms.txt, never hit wrong family |
| Lending per-wallet read | no endpoint existed (blocked) | `GET /api/lending/positions/{address}`, found call #3, worked first try |
| MCP `inputSchema` body | opaque `{type:object}` | full properties + types + required (`sizeUsdc:string`, `leverage:number`, `symbol:enum`); ZodEffects-wrapped bodies now expand too |
| Transport handshake | (skill blind spot last run) | SSE GET ✓, initialize returns protocolVersion + mcp-session-id ✓, notifications/initialized → 204 ✓ |

New residual gaps surfaced by the re-run (next iteration):
1. **OpenAPI response/request schemas still thin** — the MCP `tools/list` path now carries full schemas, but the OpenAPI generator still emits generic `Body` refs. Agents fall back to `tools/list` successfully, so mitigated, not eliminated.
2. **Spot-buy atomic-unit trap** — `spot_quote` takes human `amountUsdc` but `spot_buy` requires `amountInAtomic` + `minAmountOutAtomic` with no converter, and llms.txt "Human-Readable Inputs" over-promises automatic conversion. Only real friction left in the spot path.
3. **No unified portfolio read** — documented as an explicit fan-out (perp / lending / ghost); acceptable for now.

Files changed: `apps/hyper-mcp/src/routes/lending.ts` (positions route), `apps/hyper-mcp/src/hyper/core/{projection,app,types,hyper}.ts` (optional body-schema expander, validator-agnostic), `apps/hyper-mcp/src/hyper/openapi-zod/index.ts` (ZodEffects/pipeline unwrap), `apps/hyper-mcp/src/app.ts` (llms.txt spot/perp/chain map, symbol pinning, `trader` alias, portfolio fan-out; wire expander into MCP manifest), `apps/hyper-mcp/test/app.test.ts` (de-brittle stale market-count assertion). 37 tests pass.

## Methodology notes

- 4 fresh `general-purpose` sub-agents, each spawned with only the wallet address + base URL, forbidden from reading project source or using pre-loaded `mcp__bufi-hyper-local__*` tools (forced to discover via curl against the canonical surfaces — the point is testing llms.txt / OpenAPI / MCP-landing discoverability).
- **Harness note**: parallel sub-agent spawning was unreliable in this session (only 1 of 4 returned when batched; re-spawn batch returned empty). **Running loops sequentially worked every time.** The skill should default to sequential spawns, or treat on-disk trace files as the source of truth and re-spawn any missing loop. (The skill already reads traces from disk in Step 4 — but trace-file writes were also mangled this session, so the inline agent returns were used as the authoritative source.)
- No source-read leakage detected in any loop. No memory-leak (no hardcoded addresses beyond the supplied wallet). Surface attribution verified against each trace's call log.
