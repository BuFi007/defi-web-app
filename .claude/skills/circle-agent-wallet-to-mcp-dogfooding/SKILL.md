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

### Step 0 — Confirm scope

Use `AskUserQuestion` to choose:

1. **Target URL** — default `http://localhost:4002`, or user-supplied. Print whichever you'll use; do not silently fall back.
2. **Loop count** — recommend 3 for a quick check, 8 for a full audit. Cap at 12 (each loop spawns a sub-agent + makes ~6–12 HTTP calls).
3. **Task pack** — see `PROMPTS.md`. Default: `mvp` (markets → quote → trade → positions). Optional: `full` (adds lending, copy-trading, bonds, streaming).

If the wallet bootstrap or the target URL is missing, STOP and report `NEEDS_CONTEXT`.

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

Spawn loops **in parallel** (one Agent call per task in the same message — they're independent). Use `run_in_background: false` because we need the structured traces to write the report.

### Step 4 — Score each loop

For each returned trace, compute:

- **Discovery efficiency**: HTTP calls before the first successful API hit on the task's primary endpoint. Lower is better (3-5 is healthy; 10+ is a gap).
- **Doc sufficiency**: Did the sub-agent need to guess endpoint shapes, parameter names, or auth headers? Each guess = 1 gap.
- **Source leakage**: Any attempt to read repo files (count of forbidden reads). >0 = critical gap.
- **Error helpfulness**: For every 4xx the sub-agent received, did the response body name the missing/wrong field? Count helpful vs unhelpful 4xx.
- **Tool-name clarity**: If using MCP `tools/call`, did the sub-agent pick the right tool on the first try? Each wrong-tool retry = 1 gap.

### Step 5 — Write the gap report

Write `MCP_DOGFOOD_REPORT.md` to the **project root** (not the skill dir). Use the template in `REPORT_TEMPLATE.md`. Sections:

1. **Run metadata** — target URL, loop count, task pack, wallet address (last 4 chars only), timestamp, MCP tool count, llms.txt byte size, OpenAPI byte size.
2. **Per-task results** — task, status (✅/❌), discovery efficiency, gap count, summarized trace.
3. **Aggregate gaps** — every gap observed across loops, frequency, severity, and the canonical surface that should fix it (`llms.txt` / OpenAPI description / MCP annotation).
4. **Suggested patches** — concrete edits, file path + diff sketch. Don't write the patches — list them. The user reviews and applies separately.
5. **What's working** — a positive ledger. Discoverability wins worth keeping when you refactor.

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

## Notes for future iterations

- Add a `--diff` mode that runs against a baseline `MCP_DOGFOOD_REPORT.md` to flag regressions.
- Wire a CI variant that fails the build if gap count exceeds a threshold.
- Once the MCP is JWT-gated in prod, the wallet address becomes the JWT subject — keep the skill's "wallet is the only carried-in state" invariant intact.
