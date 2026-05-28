# MCP Dogfood Report

> Run started: `{{ timestamp }}`
> Target MCP: `{{ mcp_name }}` → `{{ target_url }}`
> Baseline (if diff mode): `{{ baseline_mcp_name }}` → `{{ baseline_url }}`
> Loops: `{{ loop_count }}` ({{ task_pack }})
> Wallet: `…{{ wallet_last4 }}`

## Transport handshake (gating — read this before the discoverability findings)

| Probe | Result | Detail |
|---|---|---|
| A — SSE GET (`Accept: text/event-stream`) | {{ probe_a }} | {{ probe_a_detail }} (event stream vs landing JSON vs 405) |
| B — `initialize` returns `protocolVersion` + `mcp-session-id` | {{ probe_b }} | {{ probe_b_detail }} |
| C — `notifications/initialized` accepted | {{ probe_c }} | {{ probe_c_detail }} (status code) |
| D — `tools/call` arg envelope | {{ probe_d }} | nests under `body`: {{ envelope_nests_body }} / documented: {{ envelope_documented }} |
| Real client — `claude mcp list` | {{ real_client_status }} | ✓ Connected / ✗ Failed to connect |

> If the real client shows `✗ Failed to connect`, this run is `BLOCKED` at the transport layer. The discoverability findings below were gathered over curl and do not reflect what a real client sees until transport is fixed.

## Canonical surface snapshot

| Surface | Status | Bytes | Notes |
|---|---|---|---|
| `GET /` | {{ landing_status }} | {{ landing_bytes }} | {{ landing_notes }} |
| `GET /llms.txt` | {{ llms_status }} | {{ llms_bytes }} | {{ llms_notes }} |
| `GET /openapi.json` | {{ openapi_status }} | {{ openapi_bytes }} | {{ openapi_paths }} paths, {{ openapi_schemas }} schemas |
| `GET /mcp` (landing) | {{ mcp_landing_status }} | {{ mcp_landing_bytes }} | {{ mcp_tool_count }} tools |
| `POST /mcp tools/list` | {{ tools_list_status }} | {{ tools_list_bytes }} | {{ tools_list_notes }} |

## Per-task results

For each task in the pack:

### {{ task_name }}

- **Outcome**: {{ outcome }} (success / partial / blocked / undiscoverable)
- **HTTP calls**: {{ call_count }} / 30 budget
- **Primary surface**: {{ primary_surface }}
- **Time to first useful response**: {{ ttf }} seconds
- **Gaps surfaced**: {{ gap_count }}
- **Wins**: {{ wins_count }}

**Trace excerpt** (first 5 calls, then last 2):

```
{{ trace_excerpt }}
```

---

## Aggregate gaps

Sort: severity (critical → low) then frequency (desc). Group by canonical surface so each surface owner has a single edit list.

### `llms.txt` gaps

| # | Severity | Frequency | Gap | Evidence | Suggested fix |
|---|---|---|---|---|---|
| 1 | critical | 4/4 | … | trace `loop_2` step 7 | Add a section "How to quote" with the exact endpoint + auth shape |

### OpenAPI description gaps

| # | Severity | Frequency | Endpoint | Gap | Evidence | Suggested fix |
|---|---|---|---|---|---|---|
| 1 | high | 3/4 | `POST /api/quote` | description is empty, no example body | … | Add `description` + `example` blocks |

### MCP tool annotation gaps

| # | Severity | Frequency | Tool | Gap | Evidence | Suggested fix |
|---|---|---|---|---|---|---|
| 1 | medium | 2/4 | `post__api_trade` | overlaps with `post__api_spot_buy`; LLM picks wrong tool 50% of the time | … | Add `When to use` block in the tool description; cross-link the sibling tool |

### Field-name consistency gaps (cross-tool)

One row per concept that's named differently across tools. The acting-wallet parameter is the usual offender.

| Concept | Names seen (tool → param) | Distinct count | Severity | Suggested fix |
|---|---|---|---|---|
| acting wallet | `trader` (trade), `supplier` (lending supply/withdraw), `borrower` (borrow/repay), `depositor` (ghost deposit), `recipient` (ghost relay/swap) | {{ n }} | high | one canonical name (`trader`) accepted everywhere via alias; keep originals for back-compat |

### Type-shape gaps (wrong JSON type on first attempt)

| # | Severity | Tool | Param | Expected | Commonly sent | Root cause | Suggested fix |
|---|---|---|---|---|---|---|---|
| 1 | high | `post__api_trade_execute` | `deadline` | number | string | `inputSchema.body` is a bare `object`, no property types | give the zod body a real shape so the type surfaces in `tools/list` |
| 2 | high | `post__api_quote` | `sizeUsdc` | string | number | same | same |

### Error-body gaps

| # | Severity | Frequency | Endpoint | 4xx code | Gap | Suggested fix |
|---|---|---|---|---|---|---|
| 1 | high | … | `POST /api/quote` | 400 | error body says `"invalid"` with no field name | Include `{ field, expected, got }` |

### Other (auth, rate limits, streaming, etc.)

| # | Severity | Frequency | Gap | Suggested fix |
|---|---|---|---|---|

## What's working (positive ledger)

- {{ working_thing_1 }}
- {{ working_thing_2 }}
- …

## Suggested patches (don't apply automatically)

1. **`apps/web/public/llms.txt`** — add section "How to quote and trade", include exact endpoints + the `Authorization: Bearer <jwt>` shape.
2. **`apps/hyper-mcp/src/routes/quote.ts`** — fill in route `description` + at least one `example` in the zod schema.
3. **`apps/hyper-mcp/src/routes/trade.ts`** — extend MCP tool annotation: "Use this for perp/spot trades. For spot-only, prefer `post__api_spot_buy`."
4. …

## Top 3 fixes (what to do first)

1. `<surface>` — `<gap>` (mentioned in `<n>/<total>` loops, severity `<X>`)
2. `<surface>` — `<gap>`
3. `<surface>` — `<gap>`

## Methodology notes (don't edit per-run; ratchet improvements here)

- The amnesia constraint is enforced by spawning sub-agents with the `Agent` tool and explicit "no source reads" instructions. Cheating is detected by scanning the trace for `Read` of any path outside `/tmp/bufi-dogfood-trace/`.
- HTTP budget of 30 calls per task is a soft heuristic — increase if perps tasks legitimately need more discovery hops.
- Primary surface attribution is verified by cross-checking the trace's claimed surface against the first successful endpoint call.
