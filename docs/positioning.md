# Positioning — FX Telaraña / BUFX (2026-05-21)

This is the credibility surface that sits beside the submission README. It explains *why we are building this*, *what we ship today*, and *what is honestly still scaffold*. The per-bucket score detail lives in [`docs/bucket-analysis-2026-05-21.md`](./bucket-analysis-2026-05-21.md); this document covers the four narrative pillars that the vision text leans on but that today have thin or zero code-side manifestation.

Companion repositories cited throughout:

- [`BuFi007/defi-web-app`](https://github.com/BuFi007/defi-web-app) — frontend + Hono BFF + Ponder indexer + keepers (this repo).
- [`BuFi007/fx-pasillo`](https://github.com/BuFi007/fx-pasillo) — Pasillo, the Ecuador USD↔USDC corridor (Cloudflare Worker).
- [`BuFi007/fx-telarana`](https://github.com/BuFi007/fx-telarana) — hub-and-spoke contracts + Hyperlane configs.
- [`BuFi007/BUFX`](https://github.com/BuFi007/BUFX) — perpetuals contracts + Uniswap v4 venue plumbing.
- [`BuFi007/fx-bento`](https://github.com/BuFi007/fx-bento) — FX² Arcade, the canonical v4-hook substrate.

## Why now: forex is ready to move onchain

Spot FX is a ~$7.5T/day market. The plumbing under it has been the same for forty years and it shows in the failure modes:

- **T+2 settlement.** Even spot FX takes two business days to settle through correspondent banks. Capital sits in nostro/vostro accounts, exposed to counterparty and credit risk, doing nothing.
- **Herstatt risk.** The 1974 Herstatt failure is still the canonical FX risk: one side of a cross-currency swap delivers, the counterparty's bank shuts before delivering the other leg, and the first leg becomes an unsecured claim in bankruptcy. CLS Bank solved this for the G10 currencies that participate in it. Everyone else still runs the risk.
- **Market closures.** FX markets close Friday New York → Sunday Sydney. That window costs predictability: weekend news still happens; pricing does not.
- **Fragmented liquidity.** Tier-1 banks see depth and quote prices; the next tier prices off them; the long tail of corridors (USD↔COP, USD↔ARS, USD↔PEN, USD↔NGN) is priced by a small number of intermediaries with wide spreads and low transparency.
- **Exotic-corridor exclusion.** Non-institutional participants in emerging markets cannot access the wholesale FX corridors that price their own currencies. They pay retail spreads to access wholesale rails — sometimes by 100s of bps.

Stablecoins fix the first three structurally. On-chain settlement is instant and atomic, which eliminates Herstatt by construction: there is no "the bank closed before the second leg landed" state because the two legs are the same atomic transaction. The chain never closes. The fourth and fifth — fragmentation and exotic-corridor exclusion — are what the protocol design is about. They are not solved by "put it on a chain"; they are solved by aggregating stablecoin FX liquidity into canonical markets and by building real fiat rails into the corridors that need them. That is what FX Telaraña and Pasillo do, respectively.

## What we ship: hub-and-spoke FX with v4-hook swap pools

The contract topology has three layers.

**FxMarketRegistry** is the on-chain source of truth for which FX markets exist on each hub chain. Each entry describes a market (base/quote symbols, pool addresses, LLTV) and points at the v4 PoolManager + hook that price it. Hubs today live on Avalanche Fuji and Arc Testnet. The registry is `fx-telarana/contracts/src/hub/FxMarketRegistry.sol`, with chain manifests committed to `packages/contracts/deployments/telarana-avalanche-fuji.json` and the Arc equivalent. The web app's MarketPicker aggregates across hubs through `defi-web-app/packages/location/src/hubs/`.

**Spoke routers** sit on chains that do not host hubs. They accept user intents on the spoke chain, route them to the right hub, and post fills back. The spoke contracts are `fx-telarana/contracts/src/spoke/FxSpoke.sol` and `FxSpokeIntentRouter.sol`. CCTP V2 carries USDC across that boundary today (`scripts/cctp-onramp.ts` in this repo runs the full Fuji → Arc burn / Iris attestation / Arc receiveMessage path).

**FxSwapHook + Real-Time FX Swap Pools (CCTP + Gateway).** This is the load-bearing piece. The v4 hook in `fx-telarana/contracts/src/hub/FxSwapHook.sol` mediates swaps against pooled stablecoin FX liquidity. Two Gateway-aware variants — `FxGatewayHook.sol` and `TelaranaGatewayHubHook.sol` — extend the same hook surface to draw liquidity from Circle Gateway during `beforeSwap` rather than relying on chain-local liquidity alone. The canonical v4 hook substrate (Uniswap v4-core + v4-periphery vendored, salt-mined deterministic address, Foundry integration tests) lives in [`fx-bento`](https://github.com/BuFi007/fx-bento) and is reachable from this repo via the pinned PoolManager addresses in `packages/contracts/src/bento.ts`.

The hook is what the submission's "Real-Time FX Swap Pools Using CCTP" claim addresses. The Gateway variant is what extends it to "Real-Time FX Swap Pools Using Gateway" — the new RFQ-style execution clause that distinguishes us from Wormhole's burn-and-mint hub-and-spoke pattern (see below).

## Why we're a complement, not a competitor to StableFX

Circle's StableFX is institutional. It connects market makers, banks, and broker-dealers to settle FX in stablecoins on permissioned rails, with off-chain price negotiation and on-chain settlement. That solves Herstatt and T+2 for the participants who clear the institutional bar. It does not, by design, surface itself to onchain-native applications, DEX aggregators, automated agents, or non-institutional liquidity.

BUFI's spot market API is the inverse-shape complement: a B2B HTTP surface that exposes the same FX liquidity to both sides — market takers and market setters — through one schema, against pooled AMM liquidity, with RFQ-style quote → fill semantics, and 24/7 onchain settlement. The same API serves a fintech that wants to quote a USD↔MXN rate to its users, an agent that wants to rebalance a USDC treasury into EURC, and an LP that wants to add depth to the USD↔BRL pool. None of these participants are institutional in the StableFX sense.

The substrate today:

- `apps/api/src/routes/spot.ts` — the spot intent route. Today it exposes `POST /spot/intents`, builds a `BuFxVenueRequestRouter`-shaped intent via the `@bufi/fx-spot` package, returns EIP-712 typed data + calldata + a route ID. Auth is by wallet session; the B2B API-key middleware and the `/spot/quote` → `/spot/fills` split land in PR-H4 / PR-H5 of the sprint plan.
- `packages/fx-spot/` — the typed-data builder, route registry, and zod schemas. `LIVE_ROUTE_IDS` and `SPOT_FX_ROUTES` are sourced from `@bufi/contracts` so the API and the on-chain registry never drift.
- `fx-telarana/contracts/src/spot/FxSpotExecutor.sol` — the on-chain executor that the venue router defers to.
- `BUFX/contracts/src/venue/BuFxVenueRequestRouter.sol` — the venue RFQ router that the API quotes against.

The honest framing for a judge: StableFX is a CLS-Bank-shaped solution to FX settlement for the institutional tier. BUFI is the on-chain B2B FX API that the next tier down — fintechs, agents, DAO treasuries, exotic-corridor aggregators — can integrate against. The two are complementary; we route some of our flow through CCTP and Gateway, which Circle is the underwriter of. We are not trying to replace the institutional MM relationships; we are trying to make the same liquidity addressable by code that is not allowed inside an institutional desk.

## First live exotic corridor — Pasillo (Ecuador USD↔USDC)

The "exotic FX corridors / non-institutional access" thesis is the hardest one to make abstract claims about, because the proof is fiat rails. We have one live: Pasillo.

[`BuFi007/fx-pasillo`](https://github.com/BuFi007/fx-pasillo) is a Cloudflare Worker that runs the Ecuador USD↔USDC corridor. Ecuador is officially dollarized, which makes it a clean first case: there is no exchange-rate slippage; the corridor is purely a fiat-rail-to-stablecoin-rail bridge, and the actual market is the spread + ops cost of getting USD cash into and out of bank rails in-country.

The worker handles:

- **Banks** — bank-side integrations for Ecuadorian banks (account holder lookup, transfer initiation, statement reconciliation).
- **Customers** — KYC'd customer onboarding, account-state machine, KYC level tracking.
- **Queues** — Cloudflare Queues for asynchronous bank operations (the fiat side is not synchronous; bank rails respond on their own timeline).
- **Durable Objects** — per-customer / per-transfer state held in a durable object so the worker survives restarts mid-transfer and the bank reconciliation loop has a single coordinator per transfer ID.

Pasillo is the first live corridor; it materializes the "non-institutional participants in exotic FX corridors" claim in the vision text. The submission should name it explicitly: it is the only piece of the stack that touches a real bank API today.

The roadmap is: more corridors via Hyperlane for the bridging substrate (non-USDC/EURC stablecoins flow via `fx-telarana/contracts/src/hub/FxHyperlaneHubReceiver.sol`, with core configs in `fx-telarana/hyperlane/arc-testnet/`, `fx-telarana/hyperlane/fuji/`, and per-chain registries in `fx-telarana/hyperlane/registry/`). The first non-USDC stablecoin bridge tx (MXNB Fuji → Arc) lands in PR-H3 of the sprint plan. Each new corridor pairs one fiat worker (Pasillo-shape) with one Hyperlane bridging route to the canonical hub; the Cloudflare Worker handles the in-country fiat rails, the bridge handles the on-chain leg.

## How we extend Wormhole's hub-and-spoke model

We owe Wormhole an honest comparison. The hub-and-spoke topology is not new. Wormhole's NTT (Native Token Transfer) framework, and the wstETH cross-chain design that uses similar primitives, route tokens between chains via a canonical hub by either burn-and-mint or lock-and-mint. Liquidity is shared across chains in the sense that there is one canonical supply at the hub; the spokes hold synthetic claims that are redeemable through the hub.

The model works. It also stops at routing.

BUFI's hub-and-spoke does two things Wormhole's does not.

First, the hubs aggregate stablecoin FX liquidity from every USDC chain into canonical hub markets — `FxMarketRegistry` is the on-chain manifest of what each hub holds, and `FxSwapHook` is the per-pool execution surface. The hub is not a routing waypoint; it is the venue. A swap against a USD↔EURC pool on the Fuji hub executes against pooled depth that lives on Fuji, not synthetic claims redeemed through Fuji.

Second, the hubs weave together through Circle Gateway. This is the load-bearing differentiator. Gateway gives us a unified USDC balance that spans every chain Gateway supports; the `TelaranaGatewayHubHook.beforeSwap` path (whose ABI ships at `packages/contracts/src/abis/TelaranaGatewayHubHook.ts` with `ICircleGatewayMinter` wired into the constructor) draws against that unified balance during a swap. The honest framing is RFQ-execute, not just route: the hook quotes a price, pulls cross-chain liquidity into the executing pool via Gateway, and settles the swap atomically. Wormhole's NTT moves the token; BUFI's hook moves the *liquidity into the execution*, against AMM-pooled depth.

This is what the new submission clause — *"Real-Time FX Swap Pools Using Gateway, rather than relying only on CCTP with shared Hub liquidity across chains"* — points at. CCTP gives us the cross-chain USDC primitive; the hook + CCTP path lands the Hookathon's headline Request. Gateway is what makes the hub model worth more than routing: hubs do not just store liquidity, they share it intra-hook in real time during execution. That clause is load-bearing for the submission and the corresponding implementation lands in PR-H8 of the sprint plan (Gateway demo `scripts/v4-swap-pool-demo-gateway.ts` is the differentiator artifact).

## Status table — vision claim to repo to file path

This is the honesty pass. Every vision claim, where it lives today, and what shape it is in. "Shipped" means the contract is deployed or the code path is exercised in tests / scripts; "Scaffold" means the file exists but the integration is not proven end-to-end; "Pending" means the work is queued in the sprint plan but not started.

| Vision claim | Repo | Path | Status | Notes |
|---|---|---|---|---|
| FxMarketRegistry as hub-and-spoke source of truth | `fx-telarana` | `contracts/src/hub/FxMarketRegistry.sol` | Shipped | Per-hub deployments in `packages/contracts/deployments/` |
| Spoke routers | `fx-telarana` | `contracts/src/spoke/{FxSpoke,FxSpokeIntentRouter}.sol` | Shipped | |
| FxSwapHook (v4 hook for FX swap pools) | `fx-telarana` | `contracts/src/hub/FxSwapHook.sol` | Shipped (hook source) | End-to-end CCTP demo lands in PR-H2 |
| Real-Time FX Swap Pools Using CCTP (the Hookathon Request) | `fx-telarana` + `defi-web-app` | `contracts/src/hub/FxSwapHook.sol` + `scripts/cctp-onramp.ts` + (pending) `scripts/v4-swap-pool-demo-cctp.ts` | Partial — CCTP onramp shipped, hook+CCTP demo pending PR-H2 | Mirrors the perps-demo-trade.ts shape |
| Real-Time FX Swap Pools Using Gateway (the differentiator) | `fx-telarana` + `defi-web-app` | `contracts/src/hub/TelaranaGatewayHubHook.sol` + (pending) `scripts/v4-swap-pool-demo-gateway.ts` | Hook scaffold present, intra-hook Gateway routing pending PR-H8 | The load-bearing PR for the submission's strongest claim |
| Canonical v4 hook substrate (v4-core + v4-periphery, salt mining, integration tests) | `fx-bento` | `src/FXBentoHook.sol` + `test/FXBentoHookV4Integration.t.sol` + `script/MineFXBentoHookSalt.s.sol` + `lib/v4-core` + `lib/v4-periphery` | Shipped | The Hookathon-readable v4 hook artifact |
| Spot market API — RFQ + AMM + 24/7 settlement | `defi-web-app` | `apps/api/src/routes/spot.ts` + `packages/fx-spot/` | Partial — `/spot/intents` shipped; `/spot/quote` ↔ `/spot/fills` split pending PR-H4 | Auth split + B2B API-key middleware land in PR-H5 |
| Spot executor + venue request router | `fx-telarana` + `BUFX` | `contracts/src/spot/FxSpotExecutor.sol` + `contracts/src/venue/BuFxVenueRequestRouter.sol` | Shipped | |
| Pasillo — first live exotic corridor (Ecuador USD↔USDC) | `fx-pasillo` | repo root (Cloudflare Worker — banks / customers / queues / durable objects) | Shipped (live worker) | Only piece of the stack touching real bank APIs today |
| Hyperlane bridging substrate (non-USDC/EURC stablecoins) | `fx-telarana` | `contracts/src/hub/FxHyperlaneHubReceiver.sol` + `hyperlane/{arc-testnet,fuji,registry}/` | Substrate shipped; first MXNB Fuji→Arc bridge tx pending PR-H3 | Cores + agent configs in place |
| CCTP V2 USDC onramp | `defi-web-app` | `scripts/cctp-onramp.ts` | Shipped | Iris attestation polling + Arc `receiveMessage` proven |
| Circle Gateway hub-weaving (unified USDC balance) | `defi-web-app` | (pending) `useUnifiedUsdcBalance` hook + wallet popover line — PR-H6 | Scaffold — gateway machinery imported in `apps/api/src/services.ts`, hook + UI pending | |
| Perpetuals engine | `BUFX` + `defi-web-app` | `contracts/src/{fees,telarana,venue}/` + `packages/perps/` + `apps/keeper-perps-{matcher,liquidator,funding}` | Shipped + tested on-chain | Open tx `0x6801…4c4d95`, close tx `0x2c07…d88b0df1` (see `docs/bucket-analysis-2026-05-21.md`) |
| Pyth pull-oracle pricing | `defi-web-app` | Hermes WebSocket + `e2e/anvil-helpers/pyth-slots.json` | Shipped | Funding + PnL marks drive off Pyth |
| Privacy layer — on-chain commitments | `fx-telarana` | `contracts/src/ghost/{FxGhostCommitmentRegistry,FxGhostKycHook,FxGhostSpokeRouter}.sol` | Shipped on-chain | |
| Privacy layer — noir.js / Groth16 client prover | `defi-web-app` | `apps/web/lib/privacy/{noir-client,proof-builder,use-proof-gen}.ts` + worker | Scaffold (client prover v0.2 in the honesty pass) | Groth16 verifier not present org-wide |
| Hono + zod-openapi typed BFF | `defi-web-app` | `apps/api/src/server.ts` + `apps/web/lib/api-client.ts` | Shipped (markets converted); perps/spot/fx-bento/fx-telarana still plain `.route` | OpenAPI `/docs` UI verification pending |
| Ponder indexer | `defi-web-app` | `apps/ponder/` | Shipped | FxBentoHook event handler pending |
| Realtime fan-out (Bun WS + Redis) | `defi-web-app` | `packages/realtime/` + `apps/api/src/routes/ws.ts` | Shipped | Channel taxonomy: `trades:*`, `book:*`, `funding:*`, `perps:intent:inserted` |
| Frontend (Next.js 16 + Vaul + Dynamic Islands) | `defi-web-app` | `apps/web/components/trade-island/` | Shipped | Mobile-viewport E2E QA still pending |
| Multi-chain (Fuji + Arc Testnet) | `defi-web-app` + `fx-telarana` + `BUFX` | `apps/web/lib/wagmi.ts` + per-chain deployments | Shipped | |
| Dedicated Rust matcher | — | — | **Not present** — zero `Cargo.toml` org-wide | Vision-text honesty pass (PR-H10) drops this or scaffolds it |

Two contradictions to flag explicitly between the vision text and the substrate so the user can choose whether to edit vision or backfill code:

1. **"Dedicated Rust matcher."** There is no Rust crate, no FFI, no gRPC schema anywhere in the BuFi007 org. The matcher in `apps/keeper-perps-matcher/src/index.ts` is TypeScript. The honesty pass (PR-H10) defaults to dropping this from the vision unless someone scaffolds a Rust service in the sprint window.
2. **"noir.js and Groth16 client proofs."** The client-side noir scaffold exists in `apps/web/lib/privacy/`; the on-chain commitment registry (`FxGhostCommitmentRegistry`) and KYC hook are shipped. But: zero `groth16` / `barretenberg` / `noir` hits in any verifier code org-wide. The right framing is "on-chain commitment registry + Ghost hook shipped; client-side prover coming v0.2." Vision should reword.

Three pieces of substrate the vision text does not mention but should:

- **Pasillo (`fx-pasillo`)** — the only real fiat rail. It is the proof-of-life for "non-institutional access to exotic FX corridors." If we do not name it, the claim reads aspirational.
- **FX² Arcade (`fx-bento`)** — the canonical v4-hook substrate (vendored v4-core + v4-periphery, salt mining, integration test). It is what the Hookathon judges will actually open when they look for the hook.
- **Morpho credit markets** — `BUFX/README.md` says perps are "backed by Morpho credit markets." The vision text does not currently reference Morpho. Either name it as the credit-market substrate behind perps margin, or drop the claim from the README.
