# defi-web-app — agent working notes

Project-specific learnings for working in this monorepo. Keep terse; update when something here proves wrong.

## Deploy architecture (Railway)

- CI deploys on push to main via `.github/workflows/deploy-railway.yml` (`railway up --service <name>`), then a **post-deploy `/health` gate** that fails the workflow if prod doesn't return 200.
- Service → domain map (they are DIFFERENT services; a fix to one does not touch the other):
  - `bufi-hyper-mcp` → **https://mcp.bu.finance** (the MCP server, `apps/hyper-mcp`)
  - `bufi-api` → **https://fx-api.bu.finance** (`apps/api`)
- `BUFI_MCP_URL` env (set per-service in `railway.toml`) = the public base URL; `app.ts` interpolates it into `llms.txt` Connect section. Don't hardcode localhost there.
- **`railway up` exit 0 ≠ the container booted** — it returns after the image builds. A startup crash shows green + silent prod-down. Trust the health gate, and for any `app.ts` change, boot-check locally first (below).
- Doc-only commits skip deploy (`paths-ignore: **.md, docs/**`).

## Hard-won rules

- **Boot the server, not just `bun test`, before committing anything that touches `apps/hyper-mcp/src/app.ts`.** `app.ts` holds the `llmsTxt` backtick template literal — a stray backtick (e.g. `` `word` `` in a comment) or `${}` terminates the string and crashes Bun at startup, which `bun test` won't catch if the edit lands after the test run. Quick check: `cd apps/hyper-mcp && PORT=4002 bun src/app.ts &` then `curl -sf localhost:4002/health`.
- **Stale local server gotcha:** a leftover `bun src/app.ts` holds :4002 → new instance fails to bind (EADDRINUSE) and curl hits old code (fields read `None`). Always `pkill -f "bun src/app.ts"` + confirm `lsof -ti:4002` empty before re-testing.
- **Shell PATH can drop in this env** — if `curl`/`wc`/`python3` are "command not found" in a Bash call, use absolute paths (`/usr/bin/curl`, `/usr/bin/python3`).

## Tests / CI

- `bun test apps/hyper-mcp/ packages/fx-spot/` is the fast local check, but the **Test workflow does NOT run hyper-mcp tests** — it typechecks `apps/web`, `apps/api`, `packages/*` and runs unit tests for perps/perps-math/fx-bento/x402/web/lib + api routes.
- A new test file in a package needs `bun-types` in that package's `tsconfig.json` `types` array and **extensionless** sibling imports (`./index`, not `./index.ts`) or `tsc --noEmit` fails (even though `bun test` passes). Mirror `packages/perps`.
- Live perp/cost tests depend on the upstream Pyth feed; they tolerate a stale-oracle response (see `isStaleOracle` in `apps/hyper-mcp/test/app.test.ts`) so the suite isn't flaky on third-party feed lag.

## Debugging access (authed CLIs)

- `gh` (CI runs/PRs/logs: `gh run view <id> --log-failed`, `gh run watch <id> --exit-status`), `railway` (`railway logs --service bufi-hyper-mcp` — root-caused a prod outage in ~30s), `vercel`. GitHub MCP also configured (user scope).

## MCP product shape (hyper-mcp)

- Two product families on two chains, NOT interchangeable: **perp** = `TelaranaFxOrderSettlement` on Arc (5042002), pair symbols (`EURC/USDC`); **spot** = `BUFX Venue Request Router` on Fuji (43113), bare token (`EURC`).
- Acting wallet param: `trader` works everywhere (alias over legacy supplier/borrower/depositor/recipient).
- Schema source of truth: `SCHEMA_CONVERTERS` in `app.ts` (one zodConverter) feeds BOTH `/openapi.json` (via `openapiHandlers`, not the core placeholder `toOpenAPI`) and the MCP `tools/list` inputSchema.
- **Response schemas:** routes declare the 200 body via `.output(zodSchema)` (hyper `route` builder). Doc-only — projected into the OpenAPI 200 `content.schema`, NOT runtime-validated, so keep it matching what `.handle()` returns. All 6 ghost routes + `spot/quote` carry one; a cold-start agent reads the contract (incl. `relayerSubmission`/`privacyNotice`) without blind-calling.
- **MCP arg envelope:** `tools/call` wraps the request payload under a top-level `body` object. `mcp/server.ts` `callTool` rejects flat args with a `-32602` that names the `body` wrapper.
- Spot money math lives in `@bufi/fx-spot` `quoteSpotOut` (tested) — all spot feeds are USD-per-token (divide). Don't hand-roll FX conversion elsewhere.
- **Ghost commitment scheme** (verified vs fx-telarana SDK `privacy/crypto.ts`): precommitment = `Poseidon([nullifier, secret])`; on-chain leaf commitment = `Poseidon([value, label, precommitment])`. Poseidon (maci-crypto), NOT snarkjs — snarkjs is only the Groth16 *withdrawal* proof. The full client flow is in the llms.txt "Constructing a ghost proof" section.

## Ongoing work

- See `DOGFOOD_PLAN.md` (Phase 2.1 signing-lifecycle = needs design review; Phase 3 privacy = contracts in the separate `fx-telarana` repo), `MCP_DOGFOOD_REPORT.md`, `PRIVACY_DOGFOOD_REPORT.md`.
- Dogfood the MCP with `/circle-agent-wallet-to-mcp-dogfooding` (its SKILL.md carries the running known-gaps table + deploy pitfalls).
