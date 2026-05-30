# MCP Dogfood Report — Broad-Surface Amnesia Run (66 tools)

> Run: 2026-05-29 · Target: `https://mcp.bu.finance` (prod) · 11 fresh-context amnesia loops + adversarial gap verification (32 agents) · wallet `…6cc7`
> Question: beyond the ghost-privacy stack (covered by the prior report, in git history), can a fresh agent integrate the FULL product — perps, spot, lending, portfolio, copy-trading, reputation, bonds, LP/vault, oracle/registry/gateway, fxswap/hedge — from the canonical surfaces alone, without reading source?

## Headline

**The core is integrable from docs; the long tail was not.** Transport is fully green and the previously-open semantic gaps (body envelope, type pinning) stayed fixed. But 8 of 11 product families had real, adversarially-confirmed discoverability holes: whole families absent from `llms.txt`, all 70 OpenAPI operations description-less, path params dropped from the MCP `inputSchema` for every path-parameterized GET tool, an actively-misleading acting-wallet rule, and stale `bufi_*` tool-name breadcrumbs. **19 of 20 serious gaps confirmed real** (1 refuted). The 5 highest-leverage fixes were applied this run (see below).

## Transport handshake (re-verified — GREEN)

| Probe | Result |
|---|---|
| A — SSE GET (`Accept: text/event-stream`) | ✓ `event: endpoint` + `mcp-session-id` |
| B — `initialize` | ✓ `protocolVersion` + `mcp-session-id` header |
| C — `notifications/initialized` | ✓ 204 |
| D — `tools/call` envelope | ✓ args wrap under `body`; **now self-describing** (inputSchema nests under `body`; flat-args error names the wrapper + the exact fields to move) |

`claude mcp list` → `bufi-hyper: https://mcp.bu.finance/mcp ✓ Connected`. Transport is NOT the bottleneck; this run is a pure semantic-layer audit.

## Per-task results

| Task | Status | First-success calls | Gaps | One-line verdict |
|---|---|---|---|---|
| perp-quote-trade | success | 5 | 3 | Cold-start 6-call success, 0 source reads; only OpenAPI 200-schema/enum drift. |
| spot-buy | success | 3 | 3 | First-try correct via llms.txt matrix + preflight; spot/quote omits expectedOut + scale. |
| lending | partial | 2 | 7 | Reads work; PREPARE + borrow/preview operationally broken (Fuji/Arc split, no quote reader). |
| portfolio | success | 3 | 3 | Aggregate read fully documented; empty 200 schemas + key-naming drift. |
| copy-trading | partial | 2 | 7 | Reads discoverable; absent from llms.txt, follow has no prepare/200, path-param schemas dropped. |
| reputation | success | 3 | 6 | Works via MCP descriptions; OpenAPI bare, path params dropped, agentId derivation undocumented. |
| bonds | success | 4 | 6 | Semantics only in MCP descriptions; create/stake non-executable stubs, no escrow address. |
| lp-vault | success | 3 | 5 | Functional but absent from llms.txt; dual vault addresses unexplained, `lp` param off-convention. |
| oracle-registry-gateway | success | 3 | 7 | All infra reads succeed w/ pinned schemas; missing from llms.txt, bare OpenAPI prose. |
| fxswap-hedge | success | 4 | 4 | Self-documenting intent-shape carried it; entire family absent from llms.txt. |
| completeness-critic | success | 0 | 8 | Core integrable from docs; acting-wallet rule actively misleads, ~37 ops lack 200 schemas. |

Zero source-leakage across all 11 loops.

## Fixes applied this run (safe, additive — boot-checked + tests green)

| # | Gap closed | Change | File |
|---|---|---|---|
| 1 | Path params dropped from MCP `inputSchema` (8 GET tools functionally broken over MCP) | `toMCPManifest` now derives `:param` from the path and emits them under `params` (required, typed, with hints for `address`/`follower`/`agentId`) — matching how the server substitutes `input.params`. Closes the `agentId == EVM address` gap too. | `hyper/core/projection.ts` |
| 2 | 0/70 OpenAPI ops carried a description; path params untyped | `buildOperation` projects each route's MCP `title`/`description` into the operation `summary`/`description`; path params get `schema:{type:string}`; `info.description` populated. **Now 66/70 ops carry descriptions.** | `hyper/openapi/generate.ts`, `app.ts` |
| 3 | Whole product families absent from `llms.txt` | Added sections: Copy-Trading & Performance Bonds, LP/TurboFeeVault, FX Swap (cross-currency), Hedge pools, Infra/Reads (oracle/registry/gateway), Reputation API endpoints. Added the cross-currency FX-swap row to the Spot-vs-Perp matrix. (11.7KB → 17.9KB) | `app.ts` `llmsTxt` |
| 4 | Acting-wallet rule actively misled (`trader` 400s on ~9 endpoints) | Rewrote "always trader" → scoped to spot/perp/lending/ghost, with the per-family fixed names (`lp`, `follower`/`leader`, `address`, `raterWalletUuid`) listed. | `app.ts` `llmsTxt` |
| 5 | Stale `bufi_*` breadcrumbs in `note`/description fields (point at nonexistent tools) | Swept 21 refs across 6 route files to real tool names (`bufi_create_trading_bond` → `post__api_bonds_create`, etc.). 0 `bufi_*` refs remain. | `routes/{bonds,copy-trading,lending,reputation,spot,trade}.ts` |
| — | Lending over-promised (APY in markets / borrow-preview health factor) | Doc-honesty: `llms.txt` now states markets carries no APY/symbol, documents the `*_prepare` signable variants, and discloses the Fuji/Arc marketId mismatch + degraded borrow_preview as KNOWN LIMITATIONS. (Backend fix still owed — see below.) | `app.ts` `llmsTxt` |

Verified live on a fresh boot: `tools/list` now shows `params.properties.{follower,address,agentId}` (required); `/openapi.json` shows 66/70 ops with `description` + `info.description`; `/llms.txt` renders with all 6 new sections. `bun test apps/hyper-mcp/ packages/fx-spot/` → 45 pass / 0 fail. `tsc` baseline unchanged (50 → 50; pre-existing, CI does not gate hyper-mcp).

## Confirmed gaps — remaining (CODE-owned, need review before applying)

| Severity | Surface | Gap | Recommended fix |
|---|---|---|---|
| critical | code | `lending/*-prepare` rejects EVERY marketId from `/api/lending/markets` ("not found on any Arc Morpho"): markets lists Fuji-hub (43113) markets, prepare resolves Arc (5042002) only. The only signable-calldata path is unreachable for listed markets. (Now disclosed in llms.txt; root cause unfixed.) | Unify the marketId universe — have `*-prepare` resolve the Fuji-hub ids markets returns, or have markets emit Arc ids. |
| critical | code | `lending/borrow/preview` returns `{error:"borrow preview unavailable", note:"On-chain quote reader not configured"}` for valid input. (Now disclosed in llms.txt; reader unwired.) | Wire the on-chain quote reader so health factor is returned. |
| high | code | Lending APY/utilization promised but `/api/lending/markets` returns only raw Morpho state; markets identified by raw addresses (no symbol/label). | Derive supplyApy/borrowApy/utilization from IRM+state; add `loanTokenSymbol`/`collateralTokenSymbol`/`marketLabel`; expose `hubChainId`. |
| high | type-shape | 37 ops declare no 200 response schema (incl. trade/prepare, quote, cost, spot/buy, portfolio/positions reads, copy/bonds/reputation). Success shape recoverable only from llms.txt prose. | Add `.output(zodSchema)` to the non-prepare money routes (pattern already used by 33 ops incl. ghost + spot/quote). |
| high | transport | `bonds/create` + `stake` are non-executable (bondId + prose, no escrow address/calldata/approve). (Now disclosed as off-chain registry stub in llms.txt.) | Return prepared calldata + escrow address + USDC approve preflight, OR keep the stub framing and publish the ERC-8183 escrow address. |
| medium | field-consistency | spot/quote returns `price` (unscaled int, no `priceDecimals`) but no `expectedOut`/`minAmountOut`; dual LP vault addresses (`lp/info` vs `vault/depths`) unexplained; registry `assets[]` omits inline token address; portfolio key drift (`perp`/`lending` vs `positions`); copy count casing (`total_traders` vs `totalDiscovered`); BTC casing (`cirBTC` vs `CIRBTC`). | Normalize field names + add the missing preview/scale fields. |
| low | openapi | symbol enum (quote/cost/trade.prepare/copy.follow) lists 5 markets vs live 6 incl QCAD; trade/prepare marks orderType/reduceOnly/ttl required vs llms.txt "omit unless overriding". | Regenerate the enum from live markets; mark the three optional. |

Refuted/dismissed: the oracle/registry "symbol-vs-address left to guess" claim — the MCP tools/list descriptions state the value form verbatim (`symbol=EURC, chainId=5042002`), so it held only against the bare OpenAPI param layer.

## What's working (keep these)

- **Transport + handshake fully green** (SSE init, protocolVersion+session header, 204 on initialized, flat empty-arg call).
- **MCP body-wrapper enforcement is exemplary**: flat `tools/call` returns a `-32602` that names the `body` wrapper, echoes the wrongly-placed fields, and tells you to move them — self-correcting in one shot.
- **REST validation errors are best-in-class**: `{status, code, why, fix, details.issues[{path,message}]}` pinpoints the exact missing field — materially offsets static-doc gaps.
- **Request-schema type pinning** (enum symbol/side, `sizeUsdc:string` vs `leverage:number`, fxswap `asset`/`side` enums) prevented type mistakes up front.
- **Prepare responses self-document the handoff**: `nextStep` strings, complete EIP-712 `typedData`+`digest`, approval-preflight blocks (token/spender/allowance) on spot/buy + lp/deposit.
- **llms.txt is outstanding on the core** (and now covers the long tail): exact trade flow, Pre-Flight Cost Check, the Spot-vs-Perp matrix, and an honest, recipe-complete Ghost privacy section.
- **MCP tools/list carries a real description on all 66 tools** — the MCP-native consumer the product targets is well-served. (This run projected that prose into OpenAPI too.)
- **`fxswap/intent-shape` is exemplary self-documentation** of `executeIntent` + the full `FxIntent` EIP-712 struct.

## Coverage

Exercised (all 66 tools reachable via tools/list; 11 task families driven live against prod): perps (markets/quote/cost/trade.prepare, full EIP-712), spot (quote/buy.prepare), lending (markets/positions/supply preview; prepare + borrow/preview hit backend defects), portfolio (aggregate + per-product), copy-trading (leaderboard/discover/leader/status reads), reputation (register/check/score/identity), bonds (list/create/stake/evaluate stubs), lp/vault (info/position/deposit-withdraw-claim prepare/depths), oracle/registry/gateway (price/info/assets/asset-address/routes/gateway.info), fxswap/hedge (pools/quote/intent-shape/hedge.pools/status).

Not exercised (by design): state-mutating signed/broadcast actions (`trade/execute`, `close`, `copy/follow`+`unfollow`, `bonds` deposit, `ghost/*` writes, owner-gated `hedge/unpause`); the ghost-privacy surface (prior report). Present-but-undriven: `liquidation/status`, `funding`, `perps/*` reads — flag as untested, not confirmed-broken.
