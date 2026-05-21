# Bucket Analysis — FX Telaraña / BUFX (2026-05-21)

**Vision pinned for this analysis:**

> FX Telaraña Protocol and BUFX are building a USDC-native perpetuals and money-market protocol on Avalanche Fuji and Arc Testnet. Forex is a trillion-dollar market ready to move onchain, where stablecoins can solve core structural problems: T+2 settlement and Herstatt risk, market closures and fragmented liquidity, and the exclusion of non-institutional participants from exotic FX corridors.
>
> The protocol combines an FxMarketRegistry — a registry-driven hub-and-spoke FX money market — with a perpetuals engine supporting EIP-712 signed intent orders, Pyth pull-oracle pricing, and a privacy-preserving matcher powered by noir.js and Groth16 client proofs.
>
> The stack includes a Hono + zod-openapi typed BFF, Ponder indexer, Bun WebSockets + Redis realtime fan-out, a dedicated Rust matcher, and a Next.js 16 frontend with Vaul-powered mobile UX and Dynamic Islands. Cross-chain USDC ramps are handled through CCTP V2, while non-USDC/EURC stablecoins are routed via Hyperlane, starting with Fuji → Arc.
>
> Inspired by Circle's StableFX, we aim to build an AMM-native complement rather than a competitor: a B2B API for market takers and market setters. Our spot market API combines RFQ execution, AMM pooled liquidity, and 24/7 onchain settlement, bringing together institutional market making and DeFi-native liquidity.
>
> Telaraña means "spider's web" in Spanish — a reference to the protocol's hub-and-spoke topology. It pulls stablecoin FX liquidity from every USDC chain into canonical hub markets, then weaves those hubs together through Circle Gateway.
>
> We directly address the Request for Hooks: Real-Time FX Swap Pools Using CCTP, extending it with Gateway-based intra-hook liquidity. In doing so, we advance the hub-and-spoke model pioneered by Wormhole with a new RFQ approach: Real-Time FX Swap Pools Using Gateway, rather than relying only on CCTP with shared Hub liquidity across chains.

**Sprint window:** 2026-05-21 → 2026-06-04 (14 days).

**Repos in scope** (each one owns its slice of the gap-closure work, with a shared merge point on each repo's `main`):

| Repo | Role | Substrate |
|---|---|---|
| [`BuFi007/defi-web-app`](https://github.com/BuFi007/defi-web-app) | Frontend + BFF + indexer + keepers | Next.js 16, Hono BFF, Ponder, TS keepers, scripts |
| [`BuFi007/fx-pasillo`](https://github.com/BuFi007/fx-pasillo) | Pasillo (Ecuador USD↔USDC corridor) | Cloudflare Worker — banks, customers, queues, durable objects |
| [`BuFi007/fx-telarana`](https://github.com/BuFi007/fx-telarana) | Hub-and-spoke contracts | `contracts/src/{hub,spoke,spot,ghost,perp}/`, Foundry, `hyperlane/{arc-testnet,fuji,registry}/` |
| [`BuFi007/BUFX`](https://github.com/BuFi007/BUFX) | Perpetuals contracts + Uniswap v4 venue | `contracts/src/{fees,telarana,venue}/`, Solidity + TypeScript scripts |
| [`BuFi007/fx-bento`](https://github.com/BuFi007/fx-bento) | FX² Arcade (v4-hook-anchored) | `src/FXBentoHook.sol`, `lib/v4-core + v4-periphery`, deploy + salt-mine scripts, v4 integration tests |

**Key contracts uncovered across repos** (these are what the scorecard scores against):

- `fx-telarana/contracts/src/hub/FxSwapHook.sol` — v4 swap hook
- `fx-telarana/contracts/src/hub/FxGatewayHook.sol` — Gateway-routed hook
- `fx-telarana/contracts/src/hub/TelaranaGatewayHubHook.sol` — Gateway hub hook (constructor takes `ICircleGatewayMinter`)
- `fx-telarana/contracts/src/hub/FxHyperlaneHubReceiver.sol` — Hyperlane receiver
- `fx-telarana/contracts/src/hub/FxMarketRegistry.sol` — FxMarketRegistry source of truth
- `fx-telarana/contracts/src/spot/FxSpotExecutor.sol` — spot executor
- `fx-telarana/contracts/src/ghost/{FxGhostCommitmentRegistry,FxGhostKycHook,FxGhostSpokeRouter}.sol` — on-chain privacy substrate
- `BUFX/contracts/src/venue/BuFxVenueRequestRouter.sol` — venue RFQ router
- `fx-bento/src/FXBentoHook.sol` + `test/FXBentoHookV4Integration.t.sol` — canonical v4 hook + integration test
- `fx-bento/lib/v4-core` + `lib/v4-periphery` — actual Uniswap v4 deps vendored

**Still unbacked anywhere across the org** (verified via code search):

- Zero `Cargo.toml` files org-wide → "dedicated Rust matcher" is aspirational
- Zero `noir` / `groth16` / `barretenberg` hits → client-side prover is the noir.js scaffold in defi-web-app; the on-chain commitment registry (FxGhostCommitmentRegistry) IS shipped

---

## Bucket scorecard (today → 2026-06-04 target)

| # | Bucket | Today | Target | ✓ | ◐ | ✗ | Must-close? |
|---|--------|------:|-----:|--:|--:|--:|---|
| **HP1** | **Uniswap v4 hook (Real-Time FX Swap Pools, CCTP + Gateway)** | **65%** | **90%** | 6 | 2 | 2 | **YES** |
| **HP2** | **Spot Market API (RFQ + AMM + 24/7 settlement)** | **55%** | **85%** | 4 | 3 | 3 | **YES** |
| B12 | Circle Gateway hub-weaving (intra-hook liquidity) | **50%** | **85%** | 4 | 2 | 4 | **YES** |
| B1  | FxMarketRegistry / hub-and-spoke money market | 80% | 90% | 7 | 1 | 1 | Stretch |
| B2  | Perpetuals engine | 80% | 95% | 8 | 2 | 0 | Stretch |
| B3  | Pyth pull-oracle pricing | 70% | 85% | 5 | 2 | 1 | Stretch |
| B4  | Privacy layer (noir.js + Groth16 client proofs) | 45% | 60% | 3 | 3 | 4 | Soft-pedal |
| B5  | Typed BFF (Hono + zod-openapi) | 75% | 90% | 6 | 2 | 1 | rolls under HP2 |
| B6  | Ponder indexer | 85% | 90% | 7 | 1 | 1 | Stretch |
| B7  | Realtime fan-out (Bun WS + Redis) | 80% | 85% | 6 | 2 | 0 | Stretch |
| B8  | Rust matcher (dedicated) | **0%** | **decide** | 0 | 0 | 6 | **DECIDE** |
| B9  | Frontend UX (Next.js 16 + Vaul + Dynamic Islands) | 80% | 90% | 8 | 2 | 1 | rolls under HP1 |
| B10 | CCTP V2 onramp | 75% | 85% | 5 | 2 | 1 | rolls under HP1 |
| B11 | **Hyperlane non-USDC/EURC bridging** | **50%** | **75%** | 3 | 2 | 4 | **YES** |
| B13 | Multi-chain deployment (Fuji + Arc) | 85% | 90% | 6 | 1 | 0 | Stretch |

**Overall today: 65%. Target by 2026-06-04: 80%+.**

---

## Per-repo gap ownership

This is the table each repo's owner uses to scope their PR queue. Each bucket lists which repo(s) carry the closure work.

| Bucket | Owning repo(s) | What this repo ships |
|---|---|---|
| HP1 | `fx-telarana` (hook impl) + `defi-web-app` (BFF / UI / demo) + `fx-bento` (hook port + tests) | Hook contract function signatures synced; CCTP attestation routed inside `beforeSwap`; Gateway routed inside `beforeSwap`; demo scripts + `/swap` widget; Foundry fork test |
| HP2 | `defi-web-app` (BFF) + `fx-telarana` (FxSpotExecutor) + `BUFX` (BuFxVenueRequestRouter) | `/spot/quote` + `/spot/fills` split; `/spot/pools` enumeration; B2B API-key middleware; OpenAPI `/docs` page |
| B12 | `defi-web-app` (unified balance UI + demo) + `fx-telarana` (Gateway hub hook beforeSwap) | `useUnifiedUsdcBalance` hook; wallet popover balance; cross-hub instant-transfer button; demo `scripts/v4-swap-pool-demo-gateway.ts` |
| B11 | `fx-telarana` (already has receiver + configs) + `defi-web-app` (bridge UI + keeper) | Run Hyperlane MXNB bridge Fuji → Arc, record tx hashes; web UI button; observer keeper |
| B4 | `fx-telarana` (ghost contracts shipped) + `defi-web-app` (noir.js prover) | Wire `useProofGen` → `FxGhostCommitmentRegistry`; feature-flag client prover behind env; OR re-scope to "v0.2 client prover" |
| B8 | undecided | If keep: scaffold `services/rs-matcher/` somewhere in defi-web-app or new repo. If drop: edit submission text. |
| B1 / B2 / B3 / B5 / B6 / B7 / B9 / B10 / B13 | `defi-web-app` (most stretch items) + `fx-telarana` (contract polish), `BUFX` (perp polish) | Polish items, see per-bucket details below |

---

## Per-bucket detail

### HP1. Uniswap v4 hook — Real-Time FX Swap Pools (CCTP + Gateway) — 65%
Drawn from: *"We directly address the Request for Hooks: Real-Time FX Swap Pools Using CCTP, extending it with Gateway-based intra-hook liquidity… Real-Time FX Swap Pools Using Gateway."*

- ✓ Canonical v4 hook source — `fx-bento/src/FXBentoHook.sol`
- ✓ V4 integration test — `fx-bento/test/FXBentoHookV4Integration.t.sol`
- ✓ Hook salt mining — `fx-bento/script/MineFXBentoHookSalt.s.sol` (required for v4 hook address determinism)
- ✓ v4-core + v4-periphery vendored — `fx-bento/lib/v4-core`, `lib/v4-periphery`
- ✓ Swap hook in hub repo — `fx-telarana/contracts/src/hub/FxSwapHook.sol`
- ✓ Gateway-routed hook variants — `fx-telarana/contracts/src/hub/{FxGatewayHook,TelaranaGatewayHubHook}.sol`
- ◐ FXBentoHook today is "anchors the game to real market pools" (snapshot/oracle role), not yet the swap-pool router the submission needs — needs Foundry adaptation
- ◐ Frontend swap surface — PoolManager addresses pinned in `defi-web-app/packages/contracts/src/bento.ts` but no `/swap` route yet
- ✗ End-to-end demo: `scripts/v4-swap-pool-demo-cctp.ts`
- ✗ End-to-end demo: `scripts/v4-swap-pool-demo-gateway.ts` (this is the differentiator)

### HP2. Spot Market API — RFQ + AMM + 24/7 settlement — 55%
Drawn from: *"Our spot market API combines RFQ execution, AMM pooled liquidity, and 24/7 onchain settlement"* + *"B2B API for market takers and market setters."*

- ✓ Spot executor contract — `fx-telarana/contracts/src/spot/FxSpotExecutor.sol`
- ✓ Venue request router — `BUFX/contracts/src/venue/BuFxVenueRequestRouter.sol`
- ✓ Pool registry on-chain — `fx-bento/src/PoolRegistry.sol` (allowed-pool list)
- ✓ `/spot/intents` POST — `defi-web-app/apps/api/src/routes/spot.ts`
- ◐ `@bufi/fx-spot` package with EIP-712 typed data — present in defi-web-app, no `/spot/quote` separation yet
- ◐ AMM substrate exists via FxBentoHook + PoolRegistry but BFF doesn't surface pool-level queries
- ◐ 24/7 settlement implied by always-on chain + arcade settler keeper, no SLA heartbeat exposed
- ✗ B2B API-key auth split from end-user wallet-session
- ✗ Market-taker vs market-setter role distinction
- ✗ Public OpenAPI `/docs` page
- ✗ `/spot/quote` (no auth, TTL'd) → `/spot/fills` (signed, references quote.id) split
- ✗ LP add/remove liquidity endpoints

### B12. Circle Gateway hub-weaving (incl. intra-hook liquidity) — 50%
Drawn from: *"weaves those hubs together through Circle Gateway"* + *"extending it with Gateway-based intra-hook liquidity… Real-Time FX Swap Pools Using Gateway."*

- ✓ TelaranaGatewayHubHook constructor wires `ICircleGatewayMinter` — `packages/contracts/src/abis/TelaranaGatewayHubHook.ts` (defi-web-app ABI port)
- ✓ Two Gateway-aware hook contracts in fx-telarana — `FxGatewayHook.sol` + `TelaranaGatewayHubHook.sol`
- ◐ `apps/api/src/services.ts` imports gateway machinery (defi-web-app)
- ◐ `packages/x402` references gateway in verify path (defi-web-app)
- ✗ `useUnifiedUsdcBalance` web hook backed by Circle Gateway API
- ✗ Gateway balance display in wallet popover
- ✗ Cross-hub instant-transfer button in UI
- ✗ Keeper observing Gateway events
- ✗ Gateway-based intra-hook liquidity routing inside `TelaranaGatewayHubHook.beforeSwap` (load-bearing differentiator)
- ✗ Demo of "Real-Time FX Swap Pool Using Gateway"

### B1. FxMarketRegistry / hub-and-spoke money market — 80%

- ✓ Registry contract — `fx-telarana/contracts/src/hub/FxMarketRegistry.sol`
- ✓ Hub manifests per chain — `packages/contracts/deployments/telarana-avalanche-fuji.json` + Arc telarana deployment
- ✓ Hub definitions — `defi-web-app/packages/location/src/hubs/`
- ✓ Spoke contracts — `fx-telarana/contracts/src/spoke/{FxSpoke,FxSpokeIntentRouter}.sol`
- ✓ Multi-hub MarketPicker aggregating Arc + Fuji
- ✓ Direct on-chain lend via FxMarketRegistry
- ✓ Hub address hyperlink to explorer per pill
- ◐ Per-market LLTV reads from deployment manifest — ✓ on Arc, not verified on Fuji
- ✗ Spoke-chain manifest enumeration (no `topology.ts` that lists every spoke per hub)

### B2. Perpetuals engine — 80%

- ✓ EIP-712 typed data — `defi-web-app/packages/perps/src/typed-data.ts`
- ✓ Signed intent persistence — `packages/db/src/adapters/sqlite.ts`
- ✓ Matcher keeper — `apps/keeper-perps-matcher/`
- ✓ Liquidator keeper — `apps/keeper-perps-liquidator/`
- ✓ Funding keeper — `apps/keeper-perps-funding/`
- ✓ Real on-chain perp fills proven (`scripts/perps-demo-trade.ts`, open tx `0x6801…4c4d95`, close tx `0x2c07…d88b0df1`)
- ✓ Margin deposit/withdraw UI
- ✓ Optimistic UI on writes
- ◐ Liquidation UX surfaces — `AccountFlagRescinded` not emitted by deployed contract (fx-telarana#28 open)
- ◐ V8/V9 typehash drift — fx-telarana#29 open; demo script hard-codes V8 inline

### B3. Pyth pull-oracle pricing — 70%

- ✓ Pyth contract address pinned — `apps/web/e2e/anvil-helpers/pyth-slots.json`
- ✓ Pyth Hermes WebSocket live ticks
- ✓ Pyth slot survey + setPythPrice cheat (e2e fixture)
- ✓ Funding/PnL drives off Pyth marks
- ✓ Update-feeds path via Hermes VAA fetch
- ◐ Stale feed retry — manual today
- ◐ Multi-feed batch updates — single-feed path proven
- ✗ Confidence-weighted PnL display

### B4. Privacy layer (noir.js + Groth16) — 45%

- ✓ On-chain commitment registry — `fx-telarana/contracts/src/ghost/FxGhostCommitmentRegistry.sol`
- ✓ Privacy KYC v4 hook — `fx-telarana/contracts/src/ghost/FxGhostKycHook.sol`
- ✓ Privacy spoke router — `fx-telarana/contracts/src/ghost/FxGhostSpokeRouter.sol`
- ◐ noir.js client scaffold — `defi-web-app/apps/web/lib/privacy/{noir-client,proof-builder,use-proof-gen}.ts` + worker
- ◐ Proof generator wires into commitment registry — not yet
- ✗ Groth16 verifier code (search returns 0 hits org-wide)
- ✗ End-to-end private intent → settled trade
- ✗ Comlink worker bridge feature-flagged on

### B5. Typed BFF (Hono + zod-openapi) — 75%

- ✓ OpenAPIHono root app — `apps/api/src/server.ts`
- ✓ `typedApp` capture + `AppType` export
- ✓ `/health` openapi route
- ✓ hc<AppType> client — `apps/web/lib/api-client.ts`
- ✓ Resilient fetch with idempotency + 401 refresh hook
- ✓ `/markets` chained onto typedApp (restored via QA fix on integration branch)
- ◐ Markets is the only plain `.route` converted to `.openapi()` chain; perps/spot/fx-bento/fx-telarana still plain
- ◐ OpenAPI spec served — wiring present, no `/docs` UI verified
- ✗ Hono client used end-to-end for trade flow

### B6. Ponder indexer — 85%

- ✓ Ponder app — `defi-web-app/apps/ponder/`
- ✓ FxMarketRegistry handlers
- ✓ Perp handlers (open / fill / close)
- ✓ FundingPoked / Liquidation / Flag events
- ✓ Publish hooks to Redis + Tinybird
- ✓ Public GraphQL gateway + rate limiting
- ✓ Test wiring out of glob path
- ◐ Tinybird ingest connected but read endpoints sparse
- ✗ FxBentoHook event handler (`PoolInitialized`, `FXBentoMarketSnapshot`, `PreSwapContext`) — not yet indexed

### B7. Realtime fan-out (Bun WS + Redis) — 80%

- ✓ `packages/realtime` extracted with subpath exports
- ✓ Channel taxonomy (`trades:*`, `book:*`, `funding:*`, `perps:intent:inserted`)
- ✓ WS handler (`apps/api/src/routes/ws.ts`)
- ✓ Matcher subscribes for intent-inserted
- ✓ Funding + liquidator publishes
- ✓ Subpath exports keep client bundles ioredis-free
- ◐ WS reconnect / backoff on web side — present but no proven coverage of Redis-drop
- ◐ Region lock note in RUNBOOK.md — present but no automated test

### B8. Rust matcher — 0%

- ✗ Zero `Cargo.toml` files anywhere in `BuFi007` org (verified via code search)
- ✗ No Rust crate, no FFI bridge, no gRPC schema, no deploy unit
- ✗ Matcher is TypeScript (`apps/keeper-perps-matcher/src/index.ts`)

**Decision required:** drop from vision text OR scaffold a Rust service this week. Default recommendation: drop.

### B9. Frontend UX (Next.js 16 + Vaul + Dynamic Islands) — 80%

- ✓ Next.js 16.2.6 (Turbopack)
- ✓ Trade Island components — `apps/web/components/trade-island/`
- ✓ Vaul mobile drawer landed
- ✓ Dynamic Island shell
- ✓ Multi-hub MarketPicker
- ✓ Wallet popover sort + USDC preview
- ✓ Chart toolbar with drawing tools + indicators
- ✓ uPlot depth + funding sparkline
- ◐ Locale switcher works; lottie borders around dynamic island still pending
- ◐ Dark mode story still in flight
- ✗ Mobile-first end-to-end QA in mobile viewport

### B10. CCTP V2 USDC/EURC onramp — 75%

- ✓ Onramp script Fuji → Arc — `scripts/cctp-onramp.ts`
- ✓ TokenMessengerV2.depositForBurn path
- ✓ Iris attestation polling
- ✓ MessageTransmitterV2.receiveMessage on Arc
- ✓ One-click web UX wrapper
- ◐ EURC onramp — Arc EURC `0x89B50…1D72a` wired but no proven CCTP path
- ◐ Fee/slippage display verified for USDC, not EURC
- ✗ Failed-attestation retry / refund UX

### B11. Hyperlane non-USDC/EURC bridging — 50%

- ✓ Hyperlane receiver contract — `fx-telarana/contracts/src/hub/FxHyperlaneHubReceiver.sol`
- ✓ Core config per chain — `fx-telarana/hyperlane/arc-testnet/core-config.yaml` (trustedRelayerIsm, merkleTreeHook, protocolFee, proxyAdmin)
- ✓ Per-chain registry — `fx-telarana/hyperlane/registry/chains/`
- ◐ Agent config — `fx-telarana/hyperlane/arc-testnet/agent-config.json`
- ◐ Fuji-side mirror config — `fx-telarana/hyperlane/fuji/`
- ✗ Actual non-USDC stablecoin bridge tx Fuji → Arc (the submission claim)
- ✗ Web UI for the bridge
- ✗ Keeper observing Hyperlane events
- ✗ Demo script proving the round-trip

### B13. Multi-chain deployment (Fuji + Arc) — 85%

- ✓ Arc Testnet wagmi config — `apps/web/lib/wagmi.ts:5`
- ✓ Avax Fuji wagmi config
- ✓ Arc RPC `https://rpc.testnet.arc.network`
- ✓ Per-chain deployment manifests — `packages/contracts/deployments/`
- ✓ MXNB on Fuji hub markets
- ✓ Multi-hub market aggregation in UI
- ◐ MXNB/AUDF address sync — done locally; Wave A pending sync after fx-telarana broadcast

---

## Sprint plan — 14 days, 5-repo fan-out

Days are calendar. Each row says which repo(s) own the PR. Each repo runs its slice in parallel; the daily checkpoint is "do the four repos still build together?"

### Week 1 (May 21 → May 27) — prove existing contracts end-to-end

| Day | PR | Repo(s) | Outcome |
|-----|----|---------|---------|
| 1 (Wed) | PR-H1 | `defi-web-app` | Sync full `FxSwapHook` + `TelaranaGatewayHubHook` + `FxGatewayHook` + `FxHyperlaneHubReceiver` ABIs via `scripts/sync-abis.mjs`. **HP1 65→70%, B11 50→55%, B12 50→55%.** |
| 2 (Thu) | PR-H2 | `defi-web-app`, `fx-telarana` | `scripts/v4-swap-pool-demo-cctp.ts` — drives a swap through `FxSwapHook` with CCTP attestation. Mirrors `scripts/perps-demo-trade.ts` shape. **HP1 70→80%.** |
| 3 (Fri) | PR-H3 | `fx-telarana` | Run Hyperlane Fuji → Arc once for a non-USDC stable (MXNB). Record tx hashes in `fx-telarana/deployments/`. **B11 55→75%.** |
| 4 (Sat) | PR-H4 | `defi-web-app` | Split `/spot/intents` → `/spot/quote` (TTL'd, no auth) + `/spot/fills` (signed, references `quote.id`). Convert to `.openapi()` chain. **HP2 55→70%, B5 75→85%.** |
| 5 (Sun) | PR-H5 | `defi-web-app` | `/spot/pools` enumeration reading `PoolRegistry.sol`. B2B `apiKey` middleware (market-taker vs market-setter). **HP2 70→80%.** |
| 6 (Mon) | PR-H6 | `defi-web-app` | `useUnifiedUsdcBalance` hook + Gateway balance line in wallet popover. **B12 55→65%.** |
| 7 (Tue) | PR-H7 | `defi-web-app` (docs) | `docs/positioning.md` — StableFX complement + T+2/Herstatt + exotic-corridor (cite Pasillo as live corridor) + Wormhole prior art. **No score change but submission credibility +.** |

End of Week 1: HP1 80%, HP2 80%, B11 75%, B12 65%. Overall ~73%.

### Week 2 (May 28 → Jun 03) — the differentiator + polish

| Day | PR | Repo(s) | Outcome |
|-----|----|---------|---------|
| 8-9 (Wed-Thu) | PR-H8 | `fx-telarana`, `defi-web-app` | Gateway intra-hook liquidity routing inside `TelaranaGatewayHubHook.beforeSwap`. Demo `scripts/v4-swap-pool-demo-gateway.ts`. **This is the new clause's load-bearing differentiator.** B12 65→85%, HP1 80→88%. |
| 10 (Fri) | PR-H9 | `defi-web-app` | Frontend `/swap` widget — pair picker → quote streams → click swap → tx through `PoolManager` with `FxSwapHook` attached. **HP1 88→90%, B9 stretch close.** |
| 11 (Sat) | PR-H10 | submission text | **Honesty pass.** Drop "dedicated Rust matcher" OR ship minimal stub. Reframe "noir.js + Groth16 client proofs" → "private commitments via `FxGhostCommitmentRegistry`; client prover coming v0.2." Mention Pasillo + fx-bento. |
| 12 (Sun) | PR-H11 | `defi-web-app` | Full `/qa` re-run. Surface any new ISSUE-NNN. Fix top-3. |
| 13 (Mon) | PR-H12 | submission rehearsal | Record demo videos for CCTP + Gateway swap pool flows. Re-test all four demo scripts on Arc Testnet. |
| 14 (Tue, deadline-1) | freeze | submission | Submit. |

End of Week 2: HP1 90%, HP2 80%, B11 75%, B12 85%. Overall ~80%.

---

## Decisions owed in week 1

| Decision | Default | Why |
|---|---|---|
| **Rust matcher (B8)** | **Drop from vision** | Zero `Cargo.toml` org-wide confirms aspirational |
| **Hyperlane (B11)** | **Keep — substrate at 50%** | Real Foundry contract + real core configs; needs one bridge tx |
| **noir.js privacy (B4)** | **Reframe** — "on-chain commitment registry + Ghost hook, client prover v0.2" | On-chain side IS shipped; only client prover is scaffold |
| **Submission text freeze** | **Day 12** | Day 13 = rehearsal; day 14 = submit |

---

## Vision gaps — substrate not mentioned in the vision

- **Pasillo / Ecuador USD↔USDC corridor** — real Cloudflare Worker (`fx-pasillo`) materializes the "non-institutional participants in exotic FX corridors" thesis. Submission should name it as the first live corridor.
- **FX² Arcade Protocol** — `fx-bento` provides the canonical v4 hook the Hookathon will look at. Worth one sentence in the submission.
- **Morpho credit markets** — `BUFX` README says perps are "backed by Morpho credit markets." Not in current submission text.
- **On-chain ghost commitment registry** — privacy isn't just noir.js client-side; the on-chain commitment registry + KYC hook are shipped. Worth correcting the framing.

---

## External integrations to provision (week 1)

| Bucket | API | Env var | Tier | Status |
|---|---|---|---|---|
| HP1 / B12 | **Circle Gateway** | `CIRCLE_GATEWAY_API_KEY` | Paid | **Critical: provision day 1.** Required for PR-H8 (the differentiator). |
| HP1 / B10 | Circle CCTP Iris | `IRIS_API_URL` | Free public | Wired |
| HP1 | Uniswap v4 PoolManager | (per-chain addresses) | n/a | Pinned in `defi-web-app/packages/contracts/src/bento.ts` |
| B11 | Hyperlane relayer | (per fx-telarana/hyperlane configs) | Free public | Configured |
| HP2 | B2B API key issuance backend | self-hosted | n/a | Defi-web-app task J1 — needed for PR-H5 market-setter auth |

---

## How each repo coordinates

- **Shared brief:** this document. Every repo links to it.
- **Daily checkpoint:** end-of-day, each repo posts a one-line status (which bucket moved, by how much). Status thread or `STATUS.md` per repo.
- **Cross-repo PRs:** if a defi-web-app PR depends on a fx-telarana contract change, the contract PR lands first, ABIs sync second.
- **Merge cadence:** each repo merges its slice into its own `main` as it lands. The defi-web-app integration branch (`integration/wk1-development`) stays around as the cross-repo QA harness — re-runs `/qa` after each contract sync.
- **Honesty pass:** day 12 freeze applies to vision text only. Code can keep landing into day 14 morning.

---

## Status flags

- **HP1, HP2, B12 are the load-bearing trio.** Today: 65 / 55 / 50. Target: 90 / 80 / 85.
- **B8 Rust matcher: drop unless someone steps up to scaffold it.**
- **B11 Hyperlane: keep in vision** — substrate is real (50%), one week of focused work brings it to 75%.
- **B4 Privacy: reframe, don't drop.** On-chain `FxGhost*` contracts are real.
- **The new clause** *"rather than relying only on CCTP with shared Hub liquidity across chains"* maps to **PR-H8 (day 8-9).** That's the single most important PR for the submission's strongest claim.
- **Vision should mention Pasillo + fx-bento + Morpho.** Currently undersells real substrate.
