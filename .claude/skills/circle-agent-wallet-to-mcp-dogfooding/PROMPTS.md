# Amnesia loop prompts

Each prompt below is what the parent skill passes to a fresh `Agent` sub-process. The sub-agent has **no** context from the parent conversation — only what is in the prompt. That's the whole point.

## Prompt envelope (wrap every task with this)

```
You are an autonomous trading agent. You have just been spawned with no memory of any prior conversation.

Your wallet address: <WALLET_ADDR>
Your base URL: <TARGET_URL>
MCP name (if registered): <MCP_NAME, e.g. bufi-hyper-local — informational only, you still must discover via HTTP>

You have access to: Bash (only curl/jq/grep), Read (only files under /tmp/bufi-dogfood-trace/<your-loop-id>/), Write (only your own trace file).

You DO NOT have access to: the project source tree, GitHub, any prior knowledge of the BUFI API, or anyone to ask.

Your task: <TASK>

Constraints:
- Discover the API only from the base URL. Allowed entry points are anything you can find by hitting `GET <TARGET_URL>` first and following whatever URLs that returns.
- Do not read any file outside /tmp/bufi-dogfood-trace/<your-loop-id>/. If you find yourself wanting to `cat src/...` or `grep -r ...` over the project — STOP and record that as a gap; the discovery should not require source reading.
- Budget: 30 HTTP requests max. If you exceed this, stop and write "task undiscoverable" in your trace.
- Log every HTTP call. Each entry: { url, method, headers (redact auth), body_summary, status, response_summary, why_i_called_this, did_it_help }.
- For every 4xx response, judge: was the error body sufficient to fix the call without external help? Record yes/no + reason.
- When the task succeeds (or you give up), write a final summary: total calls, primary surface used (llms.txt vs openapi vs mcp landing vs tools/list), confusion points, what should have been in the docs.

Write your structured trace to /tmp/bufi-dogfood-trace/<your-loop-id>/trace.json on completion. Return the same JSON in your final message so the parent can read it.

The trace JSON shape:
{
  "task": "<task as stated>",
  "loop_id": "<your-loop-id>",
  "outcome": "success" | "partial" | "blocked" | "undiscoverable",
  "primary_surface": "llms.txt" | "openapi" | "mcp-landing" | "tools-list" | "guess",
  "http_calls": [ ... ],
  "gaps": [
    { "where": "llms.txt" | "openapi" | "mcp-tool-description" | "error-body" | "other",
      "what": "human-readable description",
      "evidence": "the call/response that made this obvious",
      "severity": "critical" | "high" | "medium" | "low" }
  ],
  "wins": [ "things the docs got right that saved you time" ],
  "elapsed_seconds": <number>
}
```

## Task pack: `mvp` (default, ~4 loops)

### Loop 1 — Markets
> Find out what FX markets I can trade on this protocol. Return the list of (symbol, baseAsset, quoteAsset) tuples. You must end with a structured list, not prose.

### Loop 2 — Quote
> I want to buy $5 worth of EURC paying in USDC at the current market price. Get me a quote. Return the quote (price, fee, total cost in USDC, any expiry) but do NOT execute the trade. The wallet must be referenced in the quote request if the API requires it.

### Loop 3 — Read positions
> What positions does my wallet currently hold? Return them as a list. If there are none, say so explicitly — do not invent a placeholder.

### Loop 4 — Place a spot order (dry-run preferred)
> Place a market BUY order for $1 worth of EURC, paying in USDC. Use the cheapest path. If the API has a dry-run / simulation mode, prefer it. If no dry-run exists, surface that as a gap and stop before broadcasting a real signed tx. Return either the unsigned typed data, the dry-run result, or — if you went all the way — the tx hash + intent id.

## Task pack: `full` (extends `mvp`, ~9 loops total)

Includes all of `mvp` plus:

### Loop 5 — Funding rate lookup
> What's the current funding rate for the perp on EURC/USDC? When does the next funding payment happen, and is it positive or negative for longs right now?

### Loop 6 — Lending APY discovery
> I want to lend out my idle USDC. Which markets accept USDC supply, and what's the current APY for each? Return a ranked list.

### Loop 7 — Open a perp position (dry-run preferred)
> I want to open a 5x long on EURC/USDC with $10 notional. Show me the unsigned typed-data payload, the required margin, the liquidation price, and the worst-case fee. Do not broadcast.

### Loop 8 — Copy-trading discovery
> I heard this protocol supports copy-trading. Find me the top 3 traders by P&L over the last 7 days, and explain how I'd start copying one of them.

### Loop 9 — Streaming prices
> I want to subscribe to a live price stream for EURC/USDC. Show me how to do that and return the first 3 ticks you receive.

## Anti-cheat checklist (run on every returned trace)

- **No source reads**: scan the trace for any `Read` of a file outside `/tmp/bufi-dogfood-trace/`. Reject and downgrade severity to "critical".
- **No memory leakage**: scan for references to specific contract addresses, deployment hashes, or env vars that were not retrieved from one of the canonical surfaces. If found, that's a memory leak.
- **Surface attribution**: confirm `primary_surface` matches the trace evidence. If the sub-agent claims `llms.txt` but every successful call came from `openapi.json`, override the attribution and flag inconsistent self-reporting as a gap.
