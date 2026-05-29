---
name: circle-agent-wallet-to-mcp-dogfooding
description: Amnesia-loop dogfooding of the BUFI HYPER MCP service. Spawns N fresh agent subprocesses, each with no prior context, armed only with a Circle agent wallet and a canonical base URL. Each agent must discover the API surface from scratch via `/llms.txt`, `/openapi.json`, and `/mcp` (tools/list), then attempt a concrete task (read markets, quote, sign, trade). Produces a gap-analysis report on what's missing from each canonical surface — the artifact you patch back into llms.txt, OpenAPI descriptions, and MCP tool annotations. Use when the user wants to test MCP discoverability, harden the canonical endpoints, or simulate a fresh LLM consuming the API for the first time.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
  - WebFetch
triggers:
  - dogfood mcp
  - mcp dogfooding
  - amnesia mcp
  - test mcp discoverability
  - audit canonical endpoints
  - llms.txt audit
---

# `/circle-agent-wallet-to-mcp-dogfooding`

> Treat your own API like a stranger does. Each loop has amnesia. Whatever your fresh-context agent needs to read source for is a documentation gap.

## What this is

A multi-loop adversarial dogfood against the BUFI HYPER MCP service. Each iteration spawns a **fresh sub-agent** with:

- A Circle agent wallet address (the only memory carried in)
- A canonical base URL (default `http://localhost:4002`)
- A single concrete task
- **No other context** — no source code, no prior tool calls, no llms.txt contents, no list of tools

The sub-agent must complete the task using only what it can discover from:

1. `GET /` — JSON landing page (project metadata + canonical URLs)
2. `GET /llms.txt` — agent-readable docs
3. `GET /openapi.json` — full OpenAPI 3.1 spec
4. `GET /mcp` — MCP landing JSON (tool list, install snippets)
5. `POST /mcp` — JSON-RPC `tools/list` + `tools/call` over HTTP+SSE

Anything the sub-agent reaches for outside those five sources (project source, GitHub, memory, manual hints) counts as a **gap**. The skill produces a report with every gap, ranked by frequency across loops.

## Two layers of failure — keep them separate

Discoverability dogfooding only matters if the client can connect at all. There are **two distinct failure layers** and this skill must test both:

- **Transport layer** — can a real MCP client (Claude Code, Cursor, claude.ai) complete the streamable-HTTP handshake? This is invisible to a `curl /mcp` 200 check. A server can answer every JSON-RPC method over plain `curl` POST and still fail `claude mcp add` because it never implements SSE session init, omits `protocolVersion`/`mcp-session-id`, or 405s the `GET … Accept: text/event-stream` probe. **If the transport handshake fails, every "discoverability" finding is moot — the user falls back to curl and none of the tool descriptions are ever consumed by a real client.** Test this FIRST (Step 1.5) and treat a handshake failure as `BLOCKED`, not a low-severity doc nit.
- **Semantic layer** — given a working connection, can a fresh LLM pick the right tool and call it correctly on the first try? This is the field-name, type-shape, description-quality layer the rest of the skill measures.

Real history: a prior run of this MCP returned 200 on all five surfaces but `claude mcp list` showed `✗ Failed to connect`. The whole session ran over raw `curl` JSON-RPC. The 200 check passed; the actual client never connected. That is the exact blind spot Step 1.5 closes.

## Why amnesia matters

End users will hit your MCP from a fresh ChatGPT, Claude.ai, Cursor, or a script-driven agent — none of which have read your codebase. If a real LLM has to choose between `post__api_trade`, `post__api_perp_open`, `post__api_spot_buy` based on tool descriptions alone, the descriptions must carry the full decision context. The only way to verify that is to forget what you already know.

## When to use

- After adding new MCP tools — verify they self-describe well enough
- After editing `llms.txt` — sanity-check that the new copy is actually useful in a vacuum
- Before publishing the MCP to a marketplace or pinning a `claude mcp add` snippet
- When `/api/...` endpoints start drifting from what `llms.txt` describes
- Before signing off a "polished API" milestone

Do not use for code review, perf testing, or load testing. This skill measures **discoverability and self-description quality** only.

## Prerequisites

- Circle agent wallet bootstrapped and logged in (delegate to `/circle:use-agent-wallet` if not). Pass `circle wallet status` first; if the user is not logged in, run that skill before proceeding.
- BUFI HYPER MCP server running and reachable on the target URL.
  - Local default: `http://localhost:4002` (start via the hyper-mcp dev script in `apps/hyper-mcp/`).
  - Remote: pass `--url https://mcp.example.com` and the skill uses that.
- The user is the BUFI maintainer (only they should run this — it writes a report file into the repo root).

## Workflow

### Step 0 — Confirm scope (Target MCP, Loop count, Task pack)

Use `AskUserQuestion` to choose. The Target MCP can be supplied four ways — pick whichever fits the user's wording. Always print the resolved URL back before continuing; never silently fall back.

**Target MCP — resolution order**:

1. **User-supplied flag** — if the invocation includes `--url <URL>` or `--mcp <name>`, use it directly. `--url` wins if both are given.
2. **Registered `claude mcp` name** — if the user mentions a name like `bufi-hyper-local`, `bufi-hyper-prod`, etc., resolve it from the local registry:
   ```bash
   # List registered MCPs, find URL by name
   claude mcp list 2>/dev/null | awk -v name="$MCP_NAME" '$1==name {print $NF}'
   ```
   If the name is in the registry, derive the canonical base URL by stripping the trailing `/mcp` path: `http://localhost:4002/mcp` → `http://localhost:4002`.
3. **Project default** — `http://localhost:4002` (the BUFI HYPER local dev port).
4. **Ask** — if none of the above resolved and the user didn't say which to target, ASK explicitly. Default options to surface:
   - `bufi-hyper-local` (`http://localhost:4002`) — local dev MCP
   - `bufi-hyper-prod` (`https://mcp.bu.finance`) — production MCP (only if reachable)
   - any other `claude mcp list` entries that look like BUFI MCPs (heuristic: name contains `bufi`, `hyper`, `mcp`)
   - custom URL — let the user paste one

Once resolved, do a 1-second `curl -s -o /dev/null -w "%{http_code}" "$URL/"` reachability ping. If non-200, ask whether to continue against an unreachable target (which will dogfood the failure mode) or pick a different MCP.

**Loop count**: recommend 3 (quick), 8 (full audit). Cap at 12.

**Task pack**: see `PROMPTS.md`. Default `mvp` (markets → quote → positions → trade). Optional `full` (adds lending, perps, copy-trading, streaming).

**Multi-target diff mode**: if the user supplies two URLs (e.g. `--url http://localhost:4002 --baseline https://mcp.bu.finance`), run the same task pack against both and produce a side-by-side report. This is the right shape for "did local drift from prod?" or "did my llms.txt edit help vs the previous version?".

If the wallet bootstrap, target URL, or task pack is missing AND the user hasn't given enough to infer them, STOP and report `NEEDS_CONTEXT` with the specific missing field.

### Step 1 — Sanity-check the canonical surfaces

Before spawning sub-agents, verify the five canonical endpoints respond. This is **not** dogfooding — this is making sure the test is valid.

```bash
URL="${TARGET_URL:-http://localhost:4002}"
for path in "/" "/llms.txt" "/openapi.json" "/mcp" "/health"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$URL$path")
  echo "$code  $path"
done
```

Each must return 200. If any return non-200, STOP — the dogfood is invalid until the canonical endpoints are alive.

Then dump the surfaces locally for the gap report:

```bash
mkdir -p /tmp/bufi-dogfood
curl -s "$URL/"            > /tmp/bufi-dogfood/landing.json
curl -s "$URL/llms.txt"    > /tmp/bufi-dogfood/llms.txt
curl -s "$URL/openapi.json" > /tmp/bufi-dogfood/openapi.json
curl -s "$URL/mcp"         > /tmp/bufi-dogfood/mcp-landing.json
# tools/list via JSON-RPC
curl -s -X POST "$URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  > /tmp/bufi-dogfood/tools-list.json
```

Record byte sizes and the tool count. These become the "what was available" baseline in the report.

### Step 1.5 — Transport handshake probe (the check the 200s hide)

Before any discoverability work, prove a real MCP client can connect. Run these four probes against `$URL/mcp` and record pass/fail for each. This is the layer a plain 200 check cannot see.

```bash
URL="${TARGET_URL:-http://localhost:4002}"
MCP="$URL/mcp"

# Probe A — SSE session init. A streamable-HTTP server must answer
# GET + Accept: text/event-stream with an event stream (not the landing JSON).
echo "── Probe A: SSE GET"
curl -s -m 3 -D - -H "Accept: text/event-stream" "$MCP" 2>&1 | grep -iE "^HTTP|^content-type|^mcp-session-id|^event:|^data:" | head -8

# Probe B — initialize must return protocolVersion AND an mcp-session-id header.
echo "── Probe B: initialize"
curl -s -i -X POST "$MCP" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"dogfood","version":"1.0"}}}' \
  2>&1 | grep -iE "^HTTP|^mcp-session-id|protocolVersion" | head -5

# Probe C — notifications/initialized must be accepted (200/202/204, not "method not found").
echo "── Probe C: notifications/initialized"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$MCP" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# Probe D — tools/call argument envelope. Discover whether args nest under `body`
# or sit at the top level. Pick any read-only tool from tools-list.json.
echo "── Probe D: tools/call envelope (read-only tool)"
curl -s -X POST "$MCP" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get__api_markets","arguments":{}}}' \
  | head -c 200; echo
```

Scoring:

- **Probe A fail** (returns JSON landing instead of `event: …` stream, or 405s the SSE GET) → transport gap, `critical`.
- **Probe B fail** (no `protocolVersion` in result, or no `mcp-session-id` response header) → transport gap, `critical`. These are the two fields a real client reads to establish the session.
- **Probe C fail** (`method not found` for `notifications/initialized`) → transport gap, `high`. Clients send this immediately after `initialize`; rejecting it can wedge the handshake.
- **Probe D** is informational — record whether arguments nest under `body` (`{"arguments":{"body":{…}}}`) or sit flat. A fresh client cannot guess this; if the envelope is non-obvious and undocumented in `tools/list` `inputSchema`, that's a `high` semantic gap.

If A or B fail: **also confirm against a real client** so the report isn't theoretical. Register the target and read the status line:

```bash
claude mcp remove dogfood-probe 2>/dev/null
claude mcp add --transport http dogfood-probe "$MCP" >/dev/null 2>&1
claude mcp list 2>/dev/null | grep dogfood-probe   # ✓ Connected vs ✗ Failed to connect
claude mcp remove dogfood-probe 2>/dev/null
```

If the real client shows `✗ Failed to connect`, mark the run `BLOCKED` at the transport layer. The discoverability loops can still run over curl to gather semantic gaps, but the report must lead with the transport failure — it's the gating fix. Do not bury it under doc nits.

### Step 2 — Get the Circle agent wallet address

The sub-agents need the wallet address as the only piece of carried-in state. Read it from `circle wallet status` output (do not echo private material):

```bash
WALLET_ADDR=$(circle wallet list --json 2>/dev/null | jq -r '.[0].address // empty')
# fallback for older CLI:
[ -z "$WALLET_ADDR" ] && WALLET_ADDR=$(circle wallet status 2>/dev/null | awk '/Address/ {print $2; exit}')
echo "Using wallet: $WALLET_ADDR"
```

If empty, STOP and tell the user to bootstrap the wallet (`/circle:use-agent-wallet`).

### Step 3 — Spawn amnesia loops

Read `PROMPTS.md` for the task pack the user chose. For each task in the pack, spawn a fresh sub-agent via the `Agent` tool with `subagent_type: general-purpose`. The prompt MUST:

- State the task in user terms ("buy $1 of EURC for USDC")
- Give ONLY the canonical base URL and the wallet address
- Forbid reading project source files
- Require the sub-agent to log every HTTP call it makes and every dead-end it hits
- Ask for a structured trace: `{ steps: [{ url, method, why, outcome, confused: bool, gap: "..." }] }`
- Budget the sub-agent to <30 HTTP calls — anything more is a hard fail (gap report flags "task undiscoverable")

Spawn the **read-only** loops in parallel (one Agent call per task in the same message — they're independent). Use `run_in_background: false` because we need the structured traces to write the report.

Run the **signing/execution loop (4S)** separately, AFTER the read-only loops return, and only if Step 1.5 confirmed the chain id is `5042002` (testnet). It mutates real on-chain state (opens/closes a position) and gets the expanded `circle wallet` toolbelt, so it must not race the read-only fleet — a half-open position confuses the positions loop. Run it solo, sequentially. Skip it entirely if the target is not testnet or the wallet isn't funded.

### Step 4 — Score each loop

For each returned trace, compute:

- **Discovery efficiency**: HTTP calls before the first successful API hit on the task's primary endpoint. Lower is better (3-5 is healthy; 10+ is a gap).
- **Doc sufficiency**: Did the sub-agent need to guess endpoint shapes, parameter names, or auth headers? Each guess = 1 gap.
- **Source leakage**: Any attempt to read repo files (count of forbidden reads). >0 = critical gap.
- **Error helpfulness**: For every 4xx the sub-agent received, did the response body name the missing/wrong field? Count helpful vs unhelpful 4xx. (BUFI's validation errors are good here — they return `details.issues[].path` — credit that as a win when it shows.)
- **Tool-name clarity**: If using MCP `tools/call`, did the sub-agent pick the right tool on the first try? Each wrong-tool retry = 1 gap.
- **Field-name consistency** (cross-tool): Collect the address/principal parameter name each tool uses for "the acting wallet." If the same concept is called `trader` on one tool, `supplier` on another, `depositor` / `recipient` / `borrower` elsewhere, every distinct name beyond the first is a gap. A fresh agent re-guesses per tool and eats a validation failure each time. Severity scales with how many distinct names exist for one concept. (Observed: 5 different names for the acting wallet across perps/lending/ghost — a recurring `high` gap. The fix landed as a universal `trader` alias; verify the alias is present and documented.)
- **Type-shape surprises**: For each parameter, did the sub-agent send the wrong JSON type on the first try? The classic traps here: numeric-looking values that must be **strings** (`sizeUsdc: "10"`, `amount: "20"`, `amountInAtomic`) versus values that must be **numbers** (`deadline: 1779820676`, `leverage: 5`). Each first-attempt type mismatch = 1 gap. If `tools/list` `inputSchema` doesn't pin the type (e.g. `body` typed as bare `object` with no properties), that's the root cause — flag it on the schema, not the agent.
- **Signing-path completeness** (execution loops only): Did the prepare→sign→execute flow self-describe? Did the agent know which chain name the Circle CLI expects, that typed data is EIP-712, and that the signature feeds back into `…_execute`? Gaps here are why the wallet — the thing this skill is named after — fails to actually transact.

### Step 5 — Write the gap report

Write `MCP_DOGFOOD_REPORT.md` to the **project root** (not the skill dir). Use the template in `REPORT_TEMPLATE.md`. Sections:

1. **Run metadata** — target URL, loop count, task pack, wallet address (last 4 chars only), timestamp, MCP tool count, llms.txt byte size, OpenAPI byte size.
2. **Transport handshake** — the Step 1.5 probe results (A/B/C/D), and the real-client `claude mcp list` status line. This section is FIRST after metadata because a transport failure gates everything else.
3. **Per-task results** — task, status (✅/❌), discovery efficiency, gap count, summarized trace.
4. **Aggregate gaps** — every gap observed across loops, frequency, severity, and the canonical surface that should fix it (`llms.txt` / OpenAPI description / MCP annotation / transport / zod schema).
5. **Suggested patches** — concrete edits, file path + diff sketch. Don't write the patches — list them. The user reviews and applies separately.
6. **What's working** — a positive ledger. Discoverability wins worth keeping when you refactor.

### Step 6 — Surface the top 3 fixes

After writing the report, print to chat:

> Top 3 fixes (highest frequency × severity):
> 1. <surface> — <gap>
> 2. <surface> — <gap>
> 3. <surface> — <gap>
> Full report: `MCP_DOGFOOD_REPORT.md`

Then STOP. Do not auto-patch — the user decides which gaps are worth filling.

## Failure modes

- **MCP server is on the wrong port**: report `BLOCKED — base URL not reachable` and tell the user the exact `curl` they can run.
- **Circle CLI not installed or not logged in**: delegate to `/circle:use-agent-wallet` (do not proceed; the wallet address is load-bearing input).
- **A sub-agent exceeded its HTTP budget**: do NOT discard the trace. That trace is the strongest signal — record it as `task undiscoverable` with the partial trace attached.
- **All sub-agents fail the same way**: that's a finding, not a failure. Write the report with the failure mode as the top gap.

## Completion status

- `DONE` — all loops completed, report written, top 3 surfaced.
- `DONE_WITH_CONCERNS` — report written but some loops timed out or returned malformed traces; list which.
- `BLOCKED` — canonical endpoints not reachable, or the wallet bootstrap is missing.
- `NEEDS_CONTEXT` — user didn't pick a target URL or task pack and you can't proceed without one.

## Known gaps (carried forward — verify each run, don't re-derive from scratch)

These are gaps confirmed in prior runs. Start each run by checking whether they're still present, so the report tracks regressions/fixes instead of rediscovering the same things. Update this list when a gap is fixed or a new recurring one appears.

| Layer | Gap | Status (verified on prod 2026-05-28) | Fix shape |
|---|---|---|---|
| Transport | `GET /mcp` returned landing JSON for `Accept: text/event-stream`; no SSE init → `claude mcp` failed to connect | FIXED + LIVE on prod (`bufi-hyper: ✓ Connected`) | `apps/hyper-mcp/src/hyper/mcp/server.ts` handles SSE GET, DELETE, `notifications/initialized`, `protocolVersion` |
| Transport | `initialize` omitted `protocolVersion` and the `mcp-session-id` header | FIXED + LIVE | `rpcOkWithSession` in `server.ts` |
| Semantic | 5 names for the acting wallet (`trader`/`supplier`/`depositor`/`recipient`/`borrower`) | FIXED — `trader` works on perp+spot+lending+ghost (verified) | universal `trader` alias; lending/ghost internals still `supplier`/`depositor` under the alias (cosmetic) |
| Semantic | `inputSchema` body was a bare `object` (no types/required) on both MCP + OpenAPI | FIXED + LIVE — `tools/list` and `/openapi.json` now inline real properties/types/required/enum | `SCHEMA_CONVERTERS` (one zodConverter source) feeds both; ZodEffects/pipeline unwrap in `openapi-zod`; OpenAPI served by `openapiHandlers` (the core `toOpenAPI` is a placeholder that emits dangling `Body` refs) |
| Semantic | `tools/call` arguments nest under `body` (`{"arguments":{"body":{…}}}`) — undiscoverable from `tools/list` | OPEN | document the envelope in `llms.txt` and/or flatten the MCP arg mapping |
| Execution | Borrow returned 500 "quote reader not configured" | FIXED + LIVE | local borrow quote reader in `services.ts` |
| Execution | spot_buy needed atomic `amountInAtomic` + caller-computed `minAmountOut` | FIXED + LIVE — 1-call: human `amountUsdc` + server-derived `minAmountOut` (slippageBps default 100), `freshness` + `preflight` (balance/allowance) blocks | tested `quoteSpotOut` in `@bufi/fx-spot`; ALL spot feeds are USD-per-token (divide) |
| Execution | Circle CLI chain name is `ARC-TESTNET` (hyphen), not `ARC_TESTNET`; signing is `circle wallet sign typed-data '<json>' --address <addr> --chain ARC-TESTNET --quiet` | DOC-ONLY | belongs in `llms.txt` under a "Signing with Circle agent wallet" section |
| Privacy | ghost pools claimed unlinkability but amounts are public + arbitrary → anonymity set ≈ 1 (amount-matching) | HONESTY-FIXED (tool descriptions corrected, `privacyNotice` on every ghost response); real fix is contracts (Phase 3, separate `fx-telarana` repo) | fixed denominations / confidential amounts — see `PRIVACY_DOGFOOD_REPORT.md` |

## Deploy & verification pitfalls (learned the hard way — read before shipping a dogfood fix)

The dogfood is only as good as the deploy that ships the fix. These bit us repeatedly:

- **`railway up` exit 0 ≠ the service booted.** It returns after the image builds; a startup crash (e.g. a syntax error) then crash-loops while the workflow shows green and prod is silently down. The deploy workflow now has a **post-deploy `/health` gate** (`deploy-railway.yml`) that fails the deploy if prod doesn't return 200 — keep it.
- **CI deployed the wrong service for ages.** The workflow only ran `railway up --service bufi-api` (→ `fx-api.bu.finance`); the MCP server `bufi-hyper-mcp` (→ `mcp.bu.finance`) was never deployed, so merges "succeeded" while prod stayed stale. Confirm BOTH services deploy.
- **Editing the `llmsTxt` const in `app.ts` is a loaded gun:** it's a backtick template literal. Any backtick (e.g. `` `preflight` `` in a comment) or stray `${}` in added text terminates the string and crashes Bun at startup. After ANY edit to `app.ts`, **boot the server and curl `/health`** — `bun test` alone won't catch a startup crash if the edit lands after the test run.
- **Stale local server on :4002:** a prior backgrounded `bun src/app.ts` keeps the port; your new instance silently fails to bind (EADDRINUSE) and curl hits the OLD code (fields read as `None`/missing). `pkill -f "bun src/app.ts"` + confirm `lsof -ti:4002` is empty before re-testing.
- **Diagnose outages with `railway logs --service bufi-hyper-mcp`** (CLI is authed) — it surfaced the startup syntax error in ~30s. Pair with `gh run view <id> --log-failed` for CI failures.
- **The Test workflow typechecks `packages/*` but doesn't boot hyper-mcp.** A new test file needs `bun-types` in its package tsconfig and extensionless sibling imports (`./index`, not `./index.ts`) or `tsc` fails even though `bun test` passes.

## Notes for future iterations

## Notes for future iterations

- Add a `--diff` mode that runs against a baseline `MCP_DOGFOOD_REPORT.md` to flag regressions.
- Wire a CI variant that fails the build if gap count exceeds a threshold OR the transport handshake probe fails.
- Once the MCP is JWT-gated in prod, the wallet address becomes the JWT subject — keep the skill's "wallet is the only carried-in state" invariant intact. Add a probe that issues a token via `post__api_auth_token` and confirms a tool call works with `Authorization: Bearer <jwt>`.
- The transport probe (Step 1.5) should eventually run as its own fast pre-flight skill — it's the highest-value, lowest-cost check and gates everything else.
