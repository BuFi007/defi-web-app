# BUFI — Production-Grade Perps Roadmap

**Scope.** What it takes to operate a perpetual futures protocol on Arc Testnet → Arc Mainnet → multi-chain at the grade users will trust with real capital and integrators will build against without filing fifteen Discord questions.

**Posture.** Honest. This document does not pretend we have what we don't. Every "✅" below is anchored in a file path or PR. Every "⚪" is acknowledged work. Every "🔴" is a current weakness someone could attack tomorrow.

**Not a timeline.** Order = dependency + risk-weight, not deadline. A row can take a week or a quarter depending on team size, audit availability, and prerequisite landings. The roadmap is correct independent of velocity.

---

## Table of contents

1. [Pillar 1 — Smart-contract maturity](#pillar-1--smart-contract-maturity)
2. [Pillar 2 — Oracle & risk engine](#pillar-2--oracle--risk-engine)
3. [Pillar 3 — Liquidity & onramp](#pillar-3--liquidity--onramp)
4. [Pillar 4 — Matcher & execution layer](#pillar-4--matcher--execution-layer)
5. [Pillar 5 — Privacy stack](#pillar-5--privacy-stack)
6. [Pillar 6 — Cross-chain](#pillar-6--cross-chain)
7. [Pillar 7 — Infrastructure & SRE](#pillar-7--infrastructure--sre)
8. [Pillar 8 — Compliance & KYC](#pillar-8--compliance--kyc)
9. [Pillar 9 — Token & governance](#pillar-9--token--governance)
10. [Pillar 10 — Frontend & UX](#pillar-10--frontend--ux)
11. [Pillar 11 — Integrator surface](#pillar-11--integrator-surface)
12. [Pillar 12 — Audits, formal verification, bug bounty](#pillar-12--audits-formal-verification-bug-bounty)
13. [Pillar 13 — Decentralization path](#pillar-13--decentralization-path)
14. [Cross-cutting: where we are today (May 2026)](#cross-cutting--where-we-are-today-may-2026)
15. [P0 work to unblock the next stage](#p0-work-to-unblock-the-next-stage)

---

## Pillar 1 — Smart-contract maturity

The protocol is a clearinghouse + EIP-712 orderbook + margin account + funding engine + liquidation engine + health checker (see `fx-telarana/contracts/src/perp/`). 1,191 LOC of public Solidity mirroring GMX Synthetics, Synthetix v3 BFP, and Perennial v2 patterns. The shape is right. The instrumentation around it is the gap.

| Status | Item | Anchor / where to start |
|---|---|---|
| ✅ | Funding-first lifecycle (settle funding before every position-state change) | `FxPerpClearinghouse.sol:127-129, 139, 152, 169` |
| ✅ | EIP-712 maker/taker book with Permit2-style nonce bitmap | `FxOrderSettlement.sol:166-172` |
| ✅ | OI cap + skew cap enforcement on every increase | `FxPerpClearinghouse.sol:357-378` |
| ✅ | Bad-debt socialization explicit, emits `BadDebtSocialized` event | `FxPerpClearinghouse.sol:67-68, 322-323` |
| ✅ | Flag-then-liquidate with delay (Synthetix v3 BFP pattern) | `FxLiquidationEngine.sol:74-104` |
| ✅ | Version-keyed cumulative funding index per-trader (Perennial v2) | `FxFundingEngine.sol:38-50, 106-124` |
| 🔴 | Liquidations read lenient `getMid` instead of `getMidVerified` | `FxPerpClearinghouse.sol:391` — split into `_priceForOpen` vs `_priceForLiquidate`, ~3 LOC. P1 in [prior adversarial review](docs/decentralization-narrative.md). |
| 🔴 | Liquidator bounty paid from loser's margin — near-zero on bad-debt cases, keepers won't fire | `FxLiquidationEngine.sol:97-100` — add `minBounty` config + fallback bucket from `protocolLiquidity`. |
| 🔴 | Winning closes REVERT when `protocolLiquidity` is thin | `FxMarginAccount.sol:161-166` — partial-pay + IOU short-term, ADL long-term. |
| 🔴 | Flag persists across price recovery — pre-arm vector | `FxLiquidationEngine.sol:74-79, 81-104` — add `rescindFlag` callable by anyone when `!HEALTH.isLiquidatable`. |
| 🔴 | `FxMarginAccount.protocolLiquidity` operator-funded, no community LP | `FxMarginAccount.sol:101-120` — ship ERC-4626 `FxPerpVault`. Pillar 13. |
| 🔴 | Settler-only matcher (`SETTLER_ROLE` on `FxOrderSettlement`) — centralized fairness | Pillar 4 below. |
| 🔴 | No timelock on FxMarginAccount + FxLiquidationEngine + FxFundingEngine admin functions (FxOracle, FxMarketRegistry already gated per their NatSpec) | Apply `FxTimelock` pattern (`fx-telarana/contracts/src/governance/FxTimelock.sol`) uniformly. |
| ⚪ | Permit2 entrypoints on `FxMarketRegistry` for one-sig deposits | Tracked at [fx-telarana#26](https://github.com/BuFi007/fx-telarana/issues/26). Web wk2 unblock. |
| ⚪ | ERC-1271 path for smart-account session keys (ZeroDev / Pimlico / EIP-7702) | `FxOrderSettlement._validateOrder` already uses OZ `SignatureChecker.isValidSignatureNow` → 1271-compatible out of the box. Wire on the frontend. |
| ⚪ | `FxOracle` config has no upper bound on `maxOracleAge` / `maxConfidenceBps` | Constructor invariant + setter clamps, ~5 LOC. P2 in prior review. |
| ⚪ | EIP-712 typed-data drift catch | ✅ Done in [PR #43](https://github.com/BuFi007/defi-web-app/pull/43) — schema-shape regression guard in `@bufi/perps` typed-data tests. Repeat pattern for every signed surface. |
| ⚪ | Formal verification | Pillar 12. Certora or Halmos on `FxPerpMath` + `FxHealthChecker` (smallest surface, biggest correctness lift). |

**Closing this pillar means**: every P1 in the May-2026 adversarial review is addressed, ERC-4626 vault is live, timelocks are uniform across all admin functions, and a third-party auditor can sign off on a $10M+ TVL deployment without an asterisk.

---

## Pillar 2 — Oracle & risk engine

`FxOracle.sol` is the right shape — Pyth primary + RedStone secondary, deviation gate via `getMidVerified`, confidence-band gate on Pyth, payable update entrypoints for fresh feeds. The risk gap is who uses which path.

| Status | Item | Anchor / where to start |
|---|---|---|
| ✅ | Dual-source: Pyth pull + RedStone pull (signed payload in msg.data tail) | `FxOracle.sol:164-219` |
| ✅ | `getMidVerified` enforces deviation cap for liquidation safety | `FxOracle.sol:221-240` |
| ✅ | Confidence-band gate trips on shaky Pyth feeds | `FxOracle.sol:310-317` |
| ✅ | Pyth Hermes WS live tick stream to frontend | ✅ Done in [PR #45](https://github.com/BuFi007/defi-web-app/pull/45). Mark price + PnL tick live, exponential-backoff reconnect, monotonic dedup. |
| 🔴 | Liquidation path reads `getMid` (lenient), not `getMidVerified` | Same row as Pillar 1, callsite is `FxPerpClearinghouse.sol:391`. |
| 🔴 | Single-region matcher reads oracle → matcher trusts whatever Pyth says without RedStone cross-check | Pillar 4 — matcher should call `getMidVerified` on every settlement decision. |
| ⚪ | Third oracle leg (Chainlink as tiebreaker) | Add `chainlinkFeedOf` mapping + extend `getMidVerified` to require 2-of-3 agreement. Only needed once perp markets carry mainnet TVL. |
| ⚪ | Per-market risk parameters scaled by depth | `FxPerpClearinghouse.sol:357-378` enforces flat caps. Add depth-scaled OI cap that ratchets up with cumulative deposits and ratchets down on outflows. |
| ⚪ | Funding rate caps validated against historical CPMM funding rates | `FxFundingEngine.sol:69-71, 90-99` already caps via `maxFundingRateBpsPerSecond` and `fundingVelocityBps`. Validate these aren't too tight (system-stalls) or too loose (drains margin). Run a historical replay test against ETH-USD and EUR-USD funding traces from Hyperliquid + dYdX. |
| ⚪ | Oracle freshness gate at the API layer too (defense in depth) | When `apps/api/src/routes/markets.ts` (now typed per [PR #39](https://github.com/BuFi007/defi-web-app/pull/39)) reports market state, include `publishedAt` and mark the row stale on the UI if >N seconds old. |
| ⚪ | Position-level risk monitoring + alerts | `apps/keeper-perps-liquidator` already scans candidates. Add a "watch" tier (HF < 1.2) that posts to Sentry / Slack so risk team gets early warning before liquidations. |

**Closing this pillar means**: liquidations are deterministic across observable network states (no manipulation surface), risk parameters are governance-controlled with safety bounds, and the oracle path is uniform across read + matcher + liquidator.

---

## Pillar 3 — Liquidity & onramp

The biggest single architectural blocker we hit in May 2026 wasn't a smart-contract bug — it was that **Arc Testnet's USDC precompile has split native and ERC-20 ledgers**, and Arc's hub design only credits the ERC-20 side via Circle Gateway/CCTP V2 mints from Fuji. Direct on-Arc deposits revert. This is intentional per `packages/contracts/deployments/telarana-arc-testnet.json:85`, but it's a UX cliff if the integrator surface doesn't expose it.

| Status | Item | Anchor / where to start |
|---|---|---|
| ✅ | CCTP V2 onramp path verified live | Deployment manifest: "Stage 6 relayMintFromRemote verified live 2026-05-15". 101.20 USDC of `protocolLiquidity` on Arc proves the path. |
| ✅ | Multi-stable manifest with `usdPrice`, `flag`, `mock` fields | `packages/location/src/deployments.ts` and `packages/location/src/stable-tokens.ts`. |
| ⚪ | Public-callable CCTP onramp script | Will land as `scripts/cctp-onramp.ts` in the wk1d2 work (see PR queue). Wraps Fuji depositForBurn → Circle attestation → Arc receiveMessage. |
| 🔴 | `keeper-gateway-signer` is a stub | `apps/keeper-gateway-signer/src/index.ts` only logs `"wire LockedForRemote polling here"`. The production CCTP relay relies on this; today it must be driven manually for Stage 6. Build out the polling loop + attestation submission. |
| 🔴 | No mainnet faucet equivalent for testnet ramp | For mainnet, users deposit USDC on Fuji (or any CCTP-supported chain) → CCTP relay → Arc credit. For testnet, the manual Fuji-faucet step is unfriendly. Build a one-tx onramp UI on the frontend that wraps Permit2 + depositForBurn + auto-poll attestation in a single user flow. |
| ⚪ | ERC-4626 `FxPerpVault` — community LP capital | The single biggest decentralization unblock. Pillar 13. Spec: deposit USDC → mint shares; shares accrue funding-rate spread + trader losses; redeem subject to circuit-breaker lockup during drawdown. ~800 LOC. |
| ⚪ | Cross-chain margin (deposit on any chain, trade on Arc) | Hyperlane intent path already exists for some flows (`packages/fx-telarana/src/hyperlane-intent.ts`). Generalize to "any spoke chain → hub margin" with refund-on-failure. |
| ⚪ | Insurance fund separate from LP capital | Pillar 1 row: liquidator bounty fallback bucket. Insurance is a wider concept — pool of capital that absorbs bad-debt socializations before LP shares get diluted. Bootstrap from protocol fees, not LP deposits. |
| ⚪ | Yield-bearing collateral (Morpho rehypothecation already in flight) | `FxPrivacyPool.sol` on `feat/privacy-hook-slice-3-crossccy` already does Morpho rehypothecation for the shielded layer (20% hot reserve). Extend the pattern to the perp margin account — idle margin earns Morpho supply APY. |
| ⚪ | Withdrawal queue + cooldown | LP redemptions during drawdown must not race the matcher. Add a withdrawal queue with N-block cooldown and pro-rata distribution if liquid capital exceeds requested redemptions. |

**Closing this pillar means**: any user on any CCTP-supported chain can deposit USDC, see margin credited within attestation latency, trade against an LP-backed vault, and withdraw against a fair queue. No operator-funded backstop anywhere on the demo path.

---

## Pillar 4 — Matcher & execution layer

Today the matcher is a Bun loop in `apps/keeper-perps-matcher/src/index.ts` that polls a database, matches via `matchPriceTimePriority`, and submits `FxOrderSettlement.settleMatch` from a single settler EOA. This works. It is also the centralization point in the system. Every cleanup item below moves the matcher closer to "permissionless and verifiable" without losing the latency advantage of off-chain matching.

| Status | Item | Anchor / where to start |
|---|---|---|
| ✅ | Off-chain price-time priority matcher | `packages/perps/src/orderbook.ts` (matchPriceTimePriority) + `apps/keeper-perps-matcher/src/index.ts` |
| ✅ | EIP-712 trader signatures verified on-chain | `FxOrderSettlement._validateOrder` + OZ `SignatureChecker.isValidSignatureNow` → EOA + 1271 |
| ✅ | Funding pokes by separate keeper | `apps/keeper-perps-funding/src/index.ts` |
| ✅ | Liquidator keeper with HF re-check before submit | `apps/keeper-perps-liquidator/src/index.ts` |
| 🔴 | Single SETTLER_ROLE EOA — sequencer-fairness gap | Three escalating mitigations: (a) multi-settler with leader election; (b) commit-reveal at the matcher tier so order arrival time is independent of public visibility; (c) ZK proof of correct match (SP1/Risc Zero), submitted alongside settleMatch, asserting price-time priority was honored. |
| 🔴 | Matcher latency: polls DB at fixed interval, no push | Wire matcher to subscribe to `perpsIntents.insert` events via Postgres LISTEN/NOTIFY (Drizzle supports it). Sub-second from intent-arrival to match-attempt. |
| 🔴 | No MEV protection | Two angles: (a) batched auctions (Cowswap pattern) — collect intents for N ms, match at uniform clearing price; (b) Flashbots Protect equivalent on Arc when available, or move sensitive matchings to a private mempool when one ships. |
| 🔴 | No replay protection across chains | Domain separator already chain-scoped (`FxOrderSettlement.sol:60`). Verify no other surfaces accept signed orders without the same separator. |
| ⚪ | Matcher horizontal scale | Single Bun process today. Shard by `marketId` (each shard owns matching for a subset of markets) once volume justifies it. Inngest or Trigger.dev as the work-distribution layer — chose Vercel Cron for simpler ops per current preference. |
| ⚪ | On-chain "order pinning" — trader can pin an order on-chain that ANY matcher must honor first | Pure off-chain matching has a fairness risk if the operator goes rogue. Letting traders post on-chain pins (one-shot, expensive) creates a circuit-breaker against operator censorship. |
| ⚪ | Real CLOB on-chain — escape hatch from matcher entirely | Far-future. Convert to a sorted-set on-chain orderbook (LooksRare / dYdX-perpetual pattern) when gas allows. Arc's low-gas environment may make this viable earlier than other L1s. |
| ⚪ | Matcher SLA + monitoring | Per-match latency p50/p99, fill-rate-vs-quote-rate, replacement event volume, expired-intent ratio. OpenTelemetry → Axiom dashboards. |

**Closing this pillar means**: the matcher is a multi-prover system where any node can submit a valid match proof, the operator-as-settler relationship can be replaced without trader migration, and MEV extraction is bounded by protocol-level guarantees, not operator promises.

---

## Pillar 5 — Privacy stack

Vendored 0xbow privacy-pools-core (Groth16, lean-imt, Poseidon, audited circuits, GPL-3.0) lives on `origin/feat/privacy-hook-slice-3-crossccy` in the contracts repo. Clean merge to main pending — see [fx-telarana#27](https://github.com/BuFi007/fx-telarana/issues/27). The shape is exactly right: customers of audited circuits, not authors of novel cryptography.

| Status | Item | Anchor / where to start |
|---|---|---|
| ✅ | Vendored 0xbow Entrypoint + verifiers + lean-IMT + Poseidon | `contracts/lib/privacy-pools/` on `feat/privacy-hook-slice-3-crossccy` |
| ✅ | `FxPrivacyEntrypoint.relayCrossCurrency` — Groth16-bound swap target | `contracts/src/hub/FxPrivacyEntrypoint.sol` on the branch. Proof context binds `buyToken + minBuyAmount` — relayer can't front-run target or slippage. |
| ✅ | `FxPrivacyPool` Morpho rehypothecation (20% hot reserve) | `contracts/src/hub/FxPrivacyPool.sol` on the branch |
| ✅ | Frontend Groth16 plan: noir.js + comlink + Web Worker | Decided in wk1 planning. 2-8s proof generation off the main thread to keep the UI responsive. Implementation lands when slice-3 merges. |
| 🔴 | Slice-3 not on main | [fx-telarana#27](https://github.com/BuFi007/fx-telarana/issues/27). Clean merge, one `.gitmodules` conflict, needs `forge test` confirmation. Until merged, half the decentralization narrative reads as "branch open for review" instead of "shipped." |
| 🔴 | `FxGhostCommitmentRegistry` on main is allowlist-only (no ZK) | `contracts/src/ghost/FxGhostCommitmentRegistry.sol` — V1 stub. Decommission after slice-3 merge. |
| ⚪ | ASP (Authorized Set Protocol) compliance proof flow | Required to keep regulators on-side while users keep privacy. 0xbow's design supports this; we need the bridge contracts + a compliance set publisher. |
| ⚪ | Privacy-pool subgraph for monitoring without de-anonymizing | Aggregate metrics (TVL, deposit/withdraw counts, average dwell time) without per-user trace. Ponder schema additions. |
| ⚪ | Compliance bridge: AML / sanctions screening at deposit | Screen wallet addresses against OFAC/UN lists before commitments are accepted into the pool. Allowlist-side, not user-side. Cost: a small UX hop at deposit; benefit: regulator conversations don't kill the protocol. |
| ⚪ | Cross-chain privacy: shielded deposit on chain A, shielded withdraw on chain B | Far future. CCTP V2 + privacy hook layered. Open research question on how to bind the cross-chain message into the proof. |

**Closing this pillar means**: traders can deposit shielded USDC on any supported chain, swap into any quoted asset with non-malleable slippage bounds, withdraw to a fresh address with no on-chain link to the depositor, and AML/sanctions compliance is structurally enforced without compromising user privacy.

---

## Pillar 6 — Cross-chain

Two routes today: Circle Gateway (CCTP V2 for USDC) and Hyperlane (intent-based). Stage 6 of the relay flow is verified live but driven by manual triggers — the production keeper for it is a stub.

| Status | Item | Anchor / where to start |
|---|---|---|
| ✅ | CCTP V2 hub-mint on Arc | Stage 6 verified 2026-05-15. `FxGatewayHook.sol`, `FxHubMessageReceiver.sol`. |
| ✅ | Hyperlane intent path for FX flows | `packages/fx-telarana/src/hyperlane-intent.ts`, `FxHyperlaneHubReceiver.sol` |
| 🔴 | `keeper-gateway-signer` stub | Already cited under Pillar 3. Production CCTP relay polling + attestation submission must land. |
| 🔴 | No relayer slashing / insurance | If a Hyperlane relayer goes offline mid-flow, user funds can sit in a half-state. Bond + slash logic, or fall back to dual-relay with timeout-takeover. |
| ⚪ | Multi-hub support | Today Arc is the perp hub, Fuji is the spoke. Spec: multiple perp hubs (Arc + Hyperliquid L1 + Solana via bridge) with cross-hub margin transfer. Major architectural lift. |
| ⚪ | LayerZero V2 as a third bridge leg | Optional. Adds redundancy if CCTP or Hyperlane has an incident. Cost: integration LOC + monitoring; benefit: no single bridge dependency. |
| ⚪ | Atomic cross-chain bundling | "Deposit on Fuji + open perp on Arc + position visible to client" should land as one user-perceived action. The frontend orchestrates today; the bundling is loose. Tighten via a single SDK call that returns a single status URL. |
| ⚪ | Bridge-monitoring dashboard | Per-route success rate, latency p50/p99, stuck-message count. OpenTelemetry → Axiom + a Grafana surface for the on-call team. |

**Closing this pillar means**: cross-chain margin is a single UX action with deterministic settlement guarantees, relayer failures are insured or auto-routed around, and the protocol is bridge-agnostic at the architecture level so a future bridge outage doesn't grind trading to a halt.

---

## Pillar 7 — Infrastructure & SRE

The TypeScript-first stack landed in wk1d1-d2. Hono + zod-openapi typed BFF, Pyth Hermes WS, multicall batching, Ponder indexer with FxMarketRegistry coverage. The shape is right; what's missing is operational rigor.

| Status | Item | Anchor / where to start |
|---|---|---|
| ✅ | Hono + `@hono/zod-openapi` typed BFF | [PR #38](https://github.com/BuFi007/defi-web-app/pull/38), [PR #39](https://github.com/BuFi007/defi-web-app/pull/39). `hc<AppType>` typed client in apps/web. |
| ✅ | Ponder indexer (apps/ponder) with FxMarketRegistry + perps coverage | [PR #41](https://github.com/BuFi007/defi-web-app/pull/41). 5 new schema tables, 6 new event handlers. |
| ✅ | Pyth Hermes WS live ticks (mark + PnL) | [PR #45](https://github.com/BuFi007/defi-web-app/pull/45). |
| ✅ | viem multicall batching on the worst RPC offender | [PR #38](https://github.com/BuFi007/defi-web-app/pull/38). ~40 reads → 4 multicalls. |
| ✅ | simulateContract inline revert reasons before MM popup | [PR #44](https://github.com/BuFi007/defi-web-app/pull/44). Loan supply path; bento + perps direct-write paths TODO. |
| 🔴 | apps/api deploy target undecided | Currently `bun run src/server.ts` locally. Plan: Railway (same project as sibling `fx-bento`). Region locked to match the project. Locked in `RUNBOOK.md`. |
| 🔴 | No `apps/api` deployed environment | Following Railway decision above. CI + preview environments per branch. |
| 🔴 | Keepers not scheduled in production | Vercel Cron decided as scheduler over Trigger.dev/Inngest. Routes at `/internal/keepers/{matcher,funding,liquidator}-tick` triggered on cron; retries + backoff handled in route handlers. |
| 🔴 | No region-locked Redis for WS fan-out | Per `RUNBOOK.md`, Upstash same-region as apps/api. Set up once apps/api lands on Railway. |
| ⚪ | OpenTelemetry traces, Axiom backend | Every span tagged with `marketId`, `chainId`, `keeper`. Per-route latency, RPC retries, oracle freshness violations all queryable. |
| ⚪ | Sentry + `replayIntegration` on the frontend | Replay the exact click sequence that broke a trade. The simulateContract path catches most reverts pre-signature; Sentry catches the rest. |
| ⚪ | Drizzle ORM + Postgres at every backend tier | Ponder uses Drizzle; extend to apps/api's own persistence (keeper checkpoints, leaderboard cache, position cache). Replace any in-memory state that should survive restarts. |
| ⚪ | Tinybird for trade analytics | Stream every `MatchSettled` event from Ponder → Tinybird → real-time 24h volume, leaderboard, OHLCV at arbitrary resolution. Vendor-swap exit clause: if MRR > $X, move to self-hosted ClickHouse. |
| ⚪ | Multi-region API failover | When apps/api carries production traffic, single-region is a single-point-of-failure. Cloudflare in front + multi-region Railway / Fly behind. |
| ⚪ | Chaos engineering | Quarterly: kill the matcher mid-fill, kill the funding keeper for 2h, restart apps/api during liquidations. Verify protocol invariants hold and recovery is graceful. |
| ⚪ | CI: typecheck + unit + invariant fuzz on every PR | Foundry invariants exist for some perp paths. Extend to FxOrderSettlement + FxMarginAccount + FxLiquidationEngine + FxFundingEngine. Run daily in scheduled CI, not just on PR. |

**Closing this pillar means**: incidents are detected in seconds, traced in minutes, recovered without manual operator intervention for anything short of a contract bug. Every backend tier has an SLO and on-call playbook.

---

## Pillar 8 — Compliance & KYC

The `BufiKycPass` interface (`fx-telarana/contracts/src/interfaces/IBufiKycPass.sol`) is already a thing — the protocol can gate access by attested pass level. The gap is the operational layer: who issues passes, how revocation works, what regions are off-limits.

| Status | Item | Anchor / where to start |
|---|---|---|
| ✅ | Pass-level gating in the ghost hook | `FxGhostKycHook.sol:209-212` — verifier-checked, level-based. |
| ⚪ | KYC issuer integration (Veriff / Persona / Sumsub) | Off-chain attestation flow → issuer mints on-chain pass. Tradeoffs: Veriff is fast but expensive; Persona is cheaper but slower onboarding. |
| ⚪ | OFAC / sanctions screening | At deposit + at trade entry. Chainalysis or TRM as the upstream. Block list → contract-level rejection at the entrypoint. |
| ⚪ | Geo-restriction | IP geolocation at the frontend (best-effort) + on-chain pass that encodes "this user has attested they're not in restricted jurisdictions". The on-chain side is the load-bearing piece for legal coverage. |
| ⚪ | Pass revocation flow | If a user's KYC expires or fails re-screening, the pass needs to deactivate. Either issuer-burnable NFT (custodial) or expiry timestamp on the pass (non-custodial, weaker). |
| ⚪ | Pseudonymous trader option | For users who clear AML but want privacy, route them through the privacy stack (Pillar 5) with the compliance bridge intact. Reduces the "KYC = surveillance" objection. |
| ⚪ | Audit log: who issued which pass, when revoked | Subgraph entries on `BufiKycPass` events. Reg needs this for periodic disclosure. |
| ⚪ | Jurisdiction-by-jurisdiction launch plan | Not every market is winnable. Pick the 5-10 jurisdictions with clearest perps regulation (CH, AE, SG, BVI, US-via-Drift-style-arrangement) and launch there first. Other jurisdictions arrive on a hard timeline gated by local counsel. |

**Closing this pillar means**: a regulator can request a transaction trace and get a defensible compliance position; new users onboard via a single KYC pass that gives them protocol access without re-attestation per chain or per market.

---

## Pillar 9 — Token & governance

Don't ship a token until the protocol has standalone product-market fit. The path from "we have token" to "token captures protocol value" is paved with projects that shipped too early and got stuck in price-watching instead of building.

| Status | Item | Anchor / where to start |
|---|---|---|
| ⚪ | NO TOKEN UNTIL: $X TVL + $Y daily volume + 6 months of stable operation | Hard gate. The exact numbers depend on competitor benchmarks at the time. Floors as of May 2026: $50M TVL, $10M daily volume, 6 months without a critical incident. |
| ⚪ | Token utility plan (when the gate clears) | (a) LP-vault boost: stake token → enhanced share of vault yield; (b) trading fee discount: tiered by token holdings; (c) governance: vote on parameter changes, market additions, treasury allocation. |
| ⚪ | veToken vesting (Curve / Velodrome pattern) | Long lock = more voting power + bigger LP boost. Reduces governance velocity (good for protocol stability) and aligns long-term holders. |
| ⚪ | DAO governance with timelock | Voting threshold + quorum tuned to protocol scale. Emergency multisig override for critical incidents only — published quarterly audit of multisig actions. |
| ⚪ | Treasury auto-rebalancing | Protocol revenue → split: insurance fund, LP-vault subsidies, buyback, dev fund. Ratios governance-controlled. |
| ⚪ | Token distribution | Fair launch vs investor allocations is the existential design call. The Hyperliquid airdrop is the current goldilocks template — heavy weight to actual users, no insider preallocation visible at TGE. |
| ⚪ | Air-cover for the no-token interim | Volume incentives via stablecoin rebates, NOT a points-program that becomes a "you'll get a token someday" implicit promise. Implicit promises generate legal liability without the value capture. |

**Closing this pillar means**: a token launch that holders trust, that captures protocol revenue, and that doesn't distract the team from the underlying engineering for at least the first 18 months post-launch.

---

## Pillar 10 — Frontend & UX

The visible delta vs Synthra. Wk1d1-d2 landed the foundation: typed BFF, multicall, Pyth Hermes WS, simulateContract inline errors, decentralization narrative. The polish pass is still ahead.

| Status | Item | Anchor / where to start |
|---|---|---|
| ✅ | Stablecoin FX Wallet trigger pill (USD-equivalent across all chains) | Lives in `apps/web/components/stablecoin-balances/index.tsx`. Multicall'd. |
| ✅ | Trade tab with TradingView Lightweight Charts | Already shipped. Pyth Hermes ticks the mark price live per PR #45. |
| ✅ | Loan tab with simulateContract inline errors | [PR #44](https://github.com/BuFi007/defi-web-app/pull/44). |
| ✅ | Typed BFF surface for every consumer | [PR #38](https://github.com/BuFi007/defi-web-app/pull/38), [PR #39](https://github.com/BuFi007/defi-web-app/pull/39). |
| 🔴 | Session keys / EIP-7702 (one-sign-many-trades) | ZeroDev or Pimlico TS SDK. Trader signs once per session (scoped to `FxOrderSettlement.settleMatch` + `FxMarginAccount.*`, capped at $X per tx). Every subsequent order goes zero-popup. ERC-1271 already supported at the contract layer (`SignatureChecker.isValidSignatureNow`). |
| 🔴 | One-tx onramp via CCTP from Fuji | UI that bundles: Permit2 on Fuji USDC → TokenMessengerV2.depositForBurn → automatic attestation poll → MessageTransmitterV2.receiveMessage on Arc → margin credited. Single user-perceived action. |
| 🔴 | Mobile-first redesign | Trading is increasingly mobile. Bottom-sheet order entry, swipe-to-confirm, optimistic UI everywhere. |
| ⚪ | Native iOS + Android app | Tamagui or Tonk for cross-platform. Far future; mobile-web has to be exceptional first. |
| ⚪ | Accessibility | Screen-reader on the chart (announce price changes at user-configurable intervals), keyboard nav on order entry, color-contrast WCAG AA across all surfaces. |
| ⚪ | Real-time orderbook depth via Pyth Hermes WS + on-chain orderbook events | uPlot for the depth chart (TradingView Lightweight stays on candles). Orderbook deltas via Bun WS + Redis pub/sub from the matcher. |
| ⚪ | Animated PnL clock + funding countdown | Polish already in flight (NumberFlow + framer-motion). The funding countdown needs the matcher to emit `nextFundingAt` for the trader's current positions. |
| ⚪ | Localization expansion | next-international ships English / Español / 日本語 today. Add 한국어, 中文 (繁/簡), Português, Türkçe before market-by-market launches. |
| ⚪ | Demo wallets / sandbox mode for prospects | A clearly-labeled "Sandbox" toggle that swaps the wallet connector for a dev-mock-wallet (already exists for Playwright). Prospects can experience the full flow without a wallet. |
| ⚪ | Educational overlays | First-time perps users need explainers. Inline tooltips on initial-margin, maintenance-margin, funding rate, liquidation price. Toggle-off for advanced users. |

**Closing this pillar means**: a new user can deposit USDC and place their first perp trade in under 60 seconds, without ever seeing a confusing error, on any device, in their preferred language, with assistive technology if they need it.

---

## Pillar 11 — Integrator surface

Integrators don't read Discord. They want a typed client, an OpenAPI spec, a webhook, and a single page of docs. The typed BFF foundation landed wk1d1; the rest is documentation, SDK polish, and partner outreach.

| Status | Item | Anchor / where to start |
|---|---|---|
| ✅ | Hono RPC typed client via `hc<AppType>` | apps/web uses it internally per [PR #38](https://github.com/BuFi007/defi-web-app/pull/38). External integrators get the same with `import { hc } from "hono/client"`. |
| ✅ | OpenAPI spec auto-generated from zod schemas | Comes free with `@hono/zod-openapi`. Mount at `/openapi.json` once swagger-ui is wired. |
| ⚪ | Publish `@bufi/sdk` to npm | Wraps the typed Hono client + helpers for EIP-712 signing + chain-aware contract addresses + common patterns (open-perp, close-perp, withdraw-margin). |
| ⚪ | Subgraph / Ponder GraphQL public endpoint | Ponder ships GraphQL out of the box (per the audit). Expose at `graph.bu.finance` with rate limiting + read-only key. |
| ⚪ | Webhooks for fills, liquidations, funding | Integrators register a URL + event filter; we POST on event with HMAC signature. Replay-protection via event nonce. Critical for portfolio trackers + accounting tools. |
| ⚪ | Rate-limited public REST + WS | Currently no public-facing rate limiting. Add per-IP + per-API-key tiers, with paid tiers for higher limits (revenue stream). |
| ⚪ | Partner integrations | Aggregators (1inch, Matcha, Cowswap), wallets (Rainbow, MetaMask SDK, WalletConnect), portfolio trackers (Zerion, DeBank), accounting tools (Crypto.com Tax, Koinly, CoinTracker). Each is a 1-2 week integration project. |
| ⚪ | Public TypeScript types for every on-chain event | Already exposed via `@bufi/contracts`. Document the package with a generated reference. |
| ⚪ | Sandbox API keys | Free-tier read-only API key issuance via a self-serve dashboard. Lets integrators build against the typed client without a paid relationship. |
| ⚪ | Public status page | status.bu.finance with uptime per service (api, indexer, matcher, gateway-signer keeper). Cloudflare-monitored if API is behind Cloudflare. |
| ⚪ | Developer docs site | Mintlify or Nextra. Pages: quickstart, typed client reference, EIP-712 signing guide, common flows (open-perp, deposit, liquidation), webhook spec, error reference. |

**Closing this pillar means**: an integrator can ship a BUFI integration in a working day, with no Discord questions, no source-code spelunking, and a typed client that catches errors before they ship.

---

## Pillar 12 — Audits, formal verification, bug bounty

The contracts are too consequential for the team to be the last reviewer. Three tiers of external verification, each higher confidence and higher cost.

| Status | Item | Anchor / where to start |
|---|---|---|
| ⚪ | Foundry / Halmos invariant fuzz, daily in CI | Foundry invariants exist for some perp paths (`fx-telarana/contracts/test/FxSwapHookInvariant.t.sol`). Extend to: `FxPerpClearinghouse` (OI cap invariant, skew cap invariant, margin reservation == sum-of-positions), `FxMarginAccount` (totalAccountMargin == sum of \_margin[trader] + protocolLiquidity), `FxOrderSettlement` (nonce monotonicity, reduce-only never opens new position), `FxLiquidationEngine` (flagged → liquidated → flag cleared transitions). Run nightly via scheduled CI, alert on any new invariant violation. |
| ⚪ | Certora / Halmos formal verification | Highest confidence per LOC of effort. Start small: `FxPerpMath` (~86 LOC, deterministic math, perfect for FV) and `FxHealthChecker` (~64 LOC, equity-vs-maintenance comparison). Expand to liquidation safety properties on `FxLiquidationEngine` once the foundation is proved. |
| ⚪ | Spearbit / Trail of Bits / OpenZeppelin audit | Required before mainnet promo. Scope: all of `contracts/src/perp/`, the new `FxPerpVault` ERC-4626 when it lands, the privacy stack post-merge. Budget: $50-150K depending on firm + scope. |
| ⚪ | Immunefi bug bounty | $X for critical (e.g., $100K-$1M), $Y for high ($25K-$100K), tiered by impact. Standard Immunefi classification. Funded from treasury, NOT from operations cash flow. |
| ⚪ | Public adversarial review on testnet | Open testnet to a wider pen-tester community with a bounty pool for findings before mainnet. Hyperliquid did this well. |
| ⚪ | Periodic re-audit | Every major contract change touches the audited surface — schedule a delta-audit (cheaper than full re-audit) with the same firm every quarter once mainnet. |
| ⚪ | Threat-modeling document | The team's own pre-audit. List every attack surface, every assumption, every trust relationship. Hand this to the auditor as the starting context — saves audit days, surfaces blind spots. |
| ⚪ | Public adversarial review by AI tools | We've done two rounds of Codex-driven adversarial review (May 2026); run a third round before each mainnet milestone. Use multiple models (Codex + Claude + Gemini) for cross-checking. |

**Closing this pillar means**: every contract on mainnet has been audited by at least one Tier-1 firm, formal-verified on its most critical math, fuzz-tested daily, and is under a continuous bug bounty with a meaningful payout cap.

---

## Pillar 13 — Decentralization path

The honest map of where we are and the staged plan to get further. Don't pretend to be more decentralized than we are. Make the path public so users and integrators can hold us to it.

| Stage | Operator role | LP source | Governance | Matcher | Status |
|---|---|---|---|---|---|
| v1 | OPERATIONS_ROLE on every contract, single multisig | `protocolLiquidity` operator-funded | Operator decisions, published | Single SETTLER_ROLE EOA | **Today (May 2026)** |
| v2 | OPERATIONS_ROLE → 2-of-3 multisig with timelock | ERC-4626 `FxPerpVault` shares mint to public deposits | Operator + LP advisory group (off-chain) | Multi-settler with leader election | LP vault landing, multisig migration |
| v3 | Admin functions DAO-controlled via veToken governance | LP vault matured, multi-strategy (USDC, yield-bearing, etc.) | DAO + emergency multisig (published, time-bound) | Multi-prover with ZK match-correctness proofs | Token gate cleared (Pillar 9 floors) |
| v4 | Operator role dissolved into elected committees | LP vault + protocol-owned liquidity from treasury | Full DAO | Permissionless matcher submission via ZK proof | 12+ months of v3 stability |
| v5 | No special roles, no multisig, only DAO + protocol-owned treasury | Fully community-owned via LP-vault + treasury auto-rebalancing | DAO with quadratic voting + delegation | Sequencer-decentralized matcher network | Long-term target |

**Why this matters for the demo.** A judging panel that weights "decentralization story" will accept v1 if the v2 path is explicit, time-bound to engineering milestones, and visible. They will reject v1 if it's positioned as the endpoint.

---

## Cross-cutting — where we are today (May 2026)

Anchored against the roadmap above, what's actually shipped from the wk1d1-d2 push:

| Pillar | Shipped | PR / file |
|---|---|---|
| 1 (Contracts) | Schema regression guard for `@bufi/perps` typed-data; surfaced via the perps demo script bring-up | [PR #43](https://github.com/BuFi007/defi-web-app/pull/43) |
| 2 (Oracle) | Pyth Hermes WS for live mark + PnL ticks | [PR #45](https://github.com/BuFi007/defi-web-app/pull/45) |
| 5 (Privacy) | Decentralization-narrative doc with verified claims on slice-3 | [PR #42](https://github.com/BuFi007/defi-web-app/pull/42) |
| 5 (Privacy) | Slice-3 merge nudge to contracts track — clean conflict, narrative depends on it | [fx-telarana#27](https://github.com/BuFi007/fx-telarana/issues/27) |
| 7 (Infra) | Typed BFF (Hono + zod-openapi) | [PR #38](https://github.com/BuFi007/defi-web-app/pull/38) |
| 7 (Infra) | markets.ts typed surface (all 4 endpoints) | [PR #39](https://github.com/BuFi007/defi-web-app/pull/39) |
| 7 (Infra) | Ponder lift-extend: FxMarketRegistry + 3 missing perp handlers, 5 new schema tables | [PR #41](https://github.com/BuFi007/defi-web-app/pull/41) |
| 7 (Infra) | viem multicall batching on stablecoin-balances (~40 reads → 4 multicalls) | [PR #38](https://github.com/BuFi007/defi-web-app/pull/38) |
| 7 (Infra) | RUNBOOK.md with deploy-target + Redis region lock | [PR #38](https://github.com/BuFi007/defi-web-app/pull/38) |
| 10 (UX) | simulateContract inline errors on loan supply | [PR #44](https://github.com/BuFi007/defi-web-app/pull/44) |
| 10 (UX) | API health beacon as first typed-client consumer | [PR #38](https://github.com/BuFi007/defi-web-app/pull/38) |
| 11 (Integrator) | Typed Hono RPC surface foundation (integrator-ready) | [PR #38](https://github.com/BuFi007/defi-web-app/pull/38) |
| 12 (Audit) | Two rounds of adversarial review (Codex + AI), all P1s documented | This conversation; archived in `docs/decentralization-narrative.md` |
| 1 (Contracts) | Permit2 entrypoints required for wk2 web Permit2 UX — contracts track ticket open | [fx-telarana#26](https://github.com/BuFi007/fx-telarana/issues/26) |

---

## P0 work to unblock the next stage

The five items that have to land before the protocol can defensibly call itself "user-facing":

1. **CCTP V2 onramp script + UI wrapper** (Pillar 3) — eliminates the "I can't deposit USDC on Arc" cliff. Bridge step Fuji → Arc with auto-attestation polling, surfaced as one user action. Demo-blocking today.

2. **Slice-3 merge to main on fx-telarana** (Pillar 5) — unlocks the privacy narrative for marketing, gives the audit firm a stable target, decommissions the `FxGhostCommitmentRegistry` v1 stub. Clean merge, one `.gitmodules` conflict. See [fx-telarana#27](https://github.com/BuFi007/fx-telarana/issues/27).

3. **`FxPerpVault` ERC-4626 spec + skeleton** (Pillars 1, 3, 13) — the v1→v2 decentralization unblock. Doesn't have to ship to production immediately; the spec + a feature-flagged skeleton on the branch is enough to anchor the decentralization narrative.

4. **Liquidation path uses `getMidVerified`, liquidator-bounty fallback bucket** (Pillars 1, 2) — closes two P1s from the adversarial review in one ~50-LOC contract change. The trust signal is "manipulation-resistant liquidations" which is the single most-asked question from sophisticated traders.

5. **`keeper-gateway-signer` build-out** (Pillars 3, 6) — replace the stub with the production attestation-polling + relay-submission loop. Closes the CCTP relay loop end-to-end so Arc receives USDC mints without manual operator intervention.

After these five, the protocol is on a path where every subsequent improvement is incremental, not architectural. The shape is right; the instrumentation around it is the work that remains.

---

## Document maintenance

This roadmap is a living document. Update it:

- When a P0 lands → move from "P0" section to the relevant pillar with the PR link
- When a pillar's status flips from 🔴 to ⚪ or ⚪ to ✅ → update the inline table
- When a new pillar emerges (e.g., institutional-prime brokerage integration) → add it; don't retrofit into an existing one
- At minimum quarterly, even if nothing has changed — confirm everything in "Cross-cutting — today" is still accurate

If you find a row that's stale, fix it. This is what production-grade looks like.
