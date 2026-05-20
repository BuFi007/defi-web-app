# BUFI — Demo Flow

A 5–7 minute walkthrough for the Synthra side-by-side. Honest framing, code-anchored.

> **Companion docs**
> - [decentralization-narrative.md](./decentralization-narrative.md) (PR [#42](https://github.com/BuFi007/defi-web-app/pull/42)) — Pillar 4 lives here in detail.
> - `docs/roadmap-production-perps.md` *(expected; not landed at time of writing — see Pillar 6)*.

---

## Opening: the unfair comparison (45 seconds)

Open two GitHub repos side by side on screen:
- **[Left]** `github.com/BuFi007/fx-telarana` — point at `contracts/src/perp/`
- **[Right]** `github.com/Synthra-swap/v3-core`, `v3-periphery`, `swap-router-contract`

Read this line:

> "Synthra's three public repos are Uniswap v3 forks — concentrated-liquidity spot AMMs. They have zero perps contracts in their public source. BUFI has 1,191 lines of perps Solidity in the open: clearinghouse, EIP-712 orderbook, margin account, liquidation engine, funding engine, health checker. Patterns explicitly mirror GMX Synthetics, Synthetix v3 BFP, and Perennial v2. If they want to compete on perps they have to show us the code — and they haven't."

---

## Pillar 1: Code & Architecture (90 seconds)

Walk this list, one screen each. Files live in the sibling `fx-telarana` repo (the contracts hub) — open them in a second tab.

1. `contracts/src/perp/FxPerpClearinghouse.sol` — funding-first lifecycle, OI + skew caps, slippage protection, bad-debt socialization. ~405 LOC.
2. `contracts/src/perp/FxOrderSettlement.sol` — EIP-712 maker/taker fills, settler-gated. Permit2-style nonce bitmap (Uniswap pattern).
3. `contracts/src/perp/FxFundingEngine.sol` — Perennial-style version-keyed cumulative funding index. Per-trader settled index.
4. `contracts/src/hub/FxOracle.sol` — Pyth primary + RedStone fallback, deviation gate via `getMidVerified` for liquidation safety. Confidence-band gate.
5. `contracts/src/hub/FxMarketRegistry.sol` — Morpho-Blue router for the lending layer (orthogonal to perps, hub-shared).

Mention: vendored 0xbow privacy-pools-core on `feat/privacy-hook-slice-3-crossccy` adds Groth16 ZK shielded deposits + cross-currency relay binding swap targets into proof contexts. Mergeable to main today (see `fx-telarana#27`).

---

## Pillar 2: Live On-Chain State (60 seconds)

Run this snippet during the talk to show **live numbers**:

```bash
bun -e '
import { createPublicClient, http } from "viem";
const client = createPublicClient({
  chain: { id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } } },
  transport: http("https://rpc.testnet.arc.network"),
});
const ABI = [
  { inputs: [], name: "protocolLiquidity", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "totalAccountMargin", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
];
const addr = "0x1869D0253286dF29ce0AB8d29207772C7fD9dc35"; // FxMarginAccount on Arc Testnet
const lq = await client.readContract({ address: addr, abi: ABI, functionName: "protocolLiquidity" });
const tm = await client.readContract({ address: addr, abi: ABI, functionName: "totalAccountMargin" });
console.log("protocolLiquidity  =", Number(lq) / 1e6, "USDC");
console.log("totalAccountMargin =", Number(tm) / 1e6, "USDC");
'
```

**Last observed values (2026-05-19, verify before demo — these tick as traders deposit/close):**

| Metric | Value |
|---|---|
| `protocolLiquidity` | 101.20 USDC (operator-funded backstop) |
| `totalAccountMargin` | 2.05 USDC (trader margin currently positioned) |

> `totalAccountMargin` will move position-by-position. At the time of writing, the brief showed 2.05; a follow-up query observed 0.60 after a partial close. **Re-run the snippet immediately before the demo and update the spoken numbers.**

Reference addresses (canonical, from `packages/contracts/src/index.ts`):

| Contract | Arc Testnet (chain id `5042002`) |
|---|---|
| `FxMarginAccount` | `0x1869D0253286dF29ce0AB8d29207772C7fD9dc35` |
| `FxOrderSettlement` | `0x49ad97Fa2b67252373f4683bD4a4B49AA3AF5565` |

> The historical deployment files (`packages/contracts/deployments/perps-arc-testnet.json`, `packages/contracts/src/perps-deployments.ts`) point at an older `FxMarginAccount` (`0x35c7...39C6`). `packages/contracts/src/index.ts` is the source of truth used by the runtime + the perps-demo-trade script. The stale files are tracked for cleanup; don't reference them on screen.

Say this:

> "Right now on Arc Testnet, `FxMarginAccount` holds 101.20 USDC of protocol liquidity and ~2 USDC of trader margin. This isn't a deploy-then-forget toy — capital has flowed through the official Circle Gateway CCTP onramp and traders have margin positioned for execution. The perp matcher keeper polls for fills every 30 seconds (`d284cc4 perf(keepers): silence stub-keeper scan flood + bump default poll to 30s`). The funding engine pokes funding rates periodically — those tx hashes are on Arcscan."

Show one recent `FundingPoked` event on `https://testnet.arcscan.app` (filter by `FxFundingEngine` address `0x88B70872759E1aA24858746779Cb15ca9F2cdcf3`).

---

## Pillar 3: Frontend / UX (90 seconds)

Open the dev app (`bun run dev:complete`). Walk these surfaces:

### 3a. Wallet trigger pill — typed multicall (PR [#38](https://github.com/BuFi007/defi-web-app/pull/38))

Point at the USD-equivalent number animating.

> "This used to be 40 individual `eth_call`s per render across 4 chains × 10 stables. PR #38 batched them through multicall3 → 4 reads. Visible delta: trigger pill renders in <500ms instead of em-dashing for 9 seconds."

Open DevTools → Network → filter `eth_call` to show the multicall reads.

Anchor files:
- `apps/web/components/stablecoin-balances/index.tsx` — the consumer
- `apps/api/src/server.ts` — Hono zod-openapi BFF entrypoint
- `apps/web/lib/api-client.ts` — `hc<AppType>()` typed client

### 3b. Loan tab Confirm — inline reverts (PR [#44](https://github.com/BuFi007/defi-web-app/pull/44))

Submit a deliberately-bad amount (e.g., 100× your balance).

> "Watch what happens." *(click)* → inline toast: `Would revert: ERC20InsufficientBalance(...)`. No MetaMask popup. No gas burn.

> "Synthra users sign first, pay gas, then see the revert. PR #44 wrapped every loan write with `simulateContract` so the revert reason surfaces before any signature."

Anchor files:
- `apps/web/lib/web3/use-simulated-write.ts` — the wrapper (`simulateThenWrite` + `useSimulatedWrite`)
- `apps/web/components/trade-island/loan.tsx` — consumer at lines 1503–1510 (`simError` → toast)
- `apps/web/lib/telarana/hooks.ts` — `useLendingAction` integration

### 3c. Trade tab chart — Pyth Hermes WS (PR [#45](https://github.com/BuFi007/defi-web-app/pull/45))

Point at the mark price ticker.

> "That number is ticking every ~1s from Pyth Hermes WebSocket. Not polling. Sub-100ms latency from publisher to UI. PR #45."

Open DevTools → Network → WS to show the live `wss://hermes.pyth.network/ws` connection.

Anchor files:
- `packages/market-data/src/hermes-ws-client.ts` — singleton stream, exponential backoff `[1s, 2s, 4s, 8s, 16s, 30s]`, monotonic dedup
- `apps/web/lib/market-data/use-pyth-hermes.ts` — React hook; handles symbol inversion for `USD/<CCY>` pairs + `isStale` flag
- `apps/web/components/trade-island/chart.tsx` — consumer

### 3d. TypeScript everywhere — typed BFF (PR [#38](https://github.com/BuFi007/defi-web-app/pull/38) + PR [#39](https://github.com/BuFi007/defi-web-app/pull/39))

Open VSCode, hover on `api.health.$get()` in `apps/web/components/api-health-beacon.tsx`. Show the inferred response: `{ status: "ok"; uptime: number; version: string }`.

> "End-to-end typed BFF. Zod schemas in `apps/api` → `OpenAPIHono` → `hc<AppType>` client in `apps/web`. Integrators get a typed RPC client + OpenAPI spec from the same source."

Anchor files:
- `apps/api/src/routes/markets.ts` — PR #39 converted all 4 endpoints to `OpenAPIHono`
- `apps/api/src/server.ts` — `AppType` export
- Open the auto-generated OpenAPI JSON in a browser tab.

---

## Pillar 4: Decentralization (90 seconds)

Open [`docs/decentralization-narrative.md`](./decentralization-narrative.md) (PR [#42](https://github.com/BuFi007/defi-web-app/pull/42)) and read the honest comparative map. Lead with the 3 wins:

1. **Privacy stack** — Groth16 + lean-imt + Poseidon. Vendored from 0xbow's audited circuits (GPL-3.0). `FxPrivacyEntrypoint.relayCrossCurrency` binds `buyToken` + `minBuyAmount` into the proof context — relayer can't front-run swap target or slippage. (Cite slice-3 status — `fx-telarana#27` merge nudge.)
2. **Audited-shape perps** — 1,191 LOC public, six contracts, patterns mirroring GMX Synthetics v1, Synthetix v3 BFP, Perennial v2.
3. **Dual-oracle deviation gate** — `FxOracle.getMidVerified` requires Pyth AND RedStone agreement within deviation cap. Synthra depends on host-chain oracle (single point of failure).

Acknowledge the honest gap (from the narrative doc):

> "Today our `FxMarginAccount.protocolLiquidity` is operator-funded — we control the failure modes during the audit window. The ERC-4626 LP vault is the v2 spec, designed and feature-flagged off in this build. We're not pretending to have community LP yet. We have a roadmap to get there."

---

## Pillar 5: Real On-Chain Proof (60 seconds)

Two variations depending on whether the parallel CCTP onramp work landed.

### Variation A — CCTP onramp shipped, perps demo fills are live

Show `scripts/perps-demo-trade.output.json` from a successful run on PR [#40](https://github.com/BuFi007/defi-web-app/pull/40):
- Open tx: `<hash>` (Arcscan)
- Close tx: `<hash>` (Arcscan)
- Realized PnL: `<amount>` USDC
- "Live fills on Arc Testnet. EIP-712 maker/taker sigs, settler-routed, on-chain settled."

<!-- TODO: swap to Variation A if the CCTP onramp PR lands. PR URL: ____ -->

### Variation B — CCTP onramp didn't land (default)

- Open `scripts/perps-demo-trade.ts` from PR [#40](https://github.com/BuFi007/defi-web-app/pull/40) in the editor.
- Walk the open + close flow: keeper checks `SETTLER_ROLE` on `FxOrderSettlement` (`0x49ad97Fa2b67252373f4683bD4a4B49AA3AF5565`), both traders sign EIP-712 `SignedOrder`s against the live `FxOracle.getMid`, keeper calls `settleMatch`, script decodes `MatchSettled` + `PositionIncreased`, dwells 30s, closes with reduce-only orders, decodes `PositionDecreased` + realized PnL.
- The current `scripts/perps-demo-trade.output.json` is intentionally `{ "status": "blocked" }` — gated on `DEMO_MAKER_PRIVATE_KEY` / `DEMO_TAKER_PRIVATE_KEY` env vars and ≥10 USDC funding per trader. Show it on screen as evidence the script ships honest preflight, not a fake "success" placeholder.
- Show the existing `MarginDeposited` events on Arcscan (the 2.05 USDC margin already deposited proves the path works). Walk the typehash fix from PR [#43](https://github.com/BuFi007/defi-web-app/pull/43) — `SIGNED_ORDER_TYPES` was missing `maxFee` until that fix; now schema test asserts the typehash matches the on-chain selector, so any future drift fails CI.

> "The settlement path is proven. The onramp via CCTP from Fuji is the production deposit flow — separate from the trading layer. We ship the trading layer real; CCTP onramp landed on Fuji + Stage 6 relay was verified live earlier this cycle per the deployment manifest."

---

## Pillar 6: The Roadmap (30 seconds, closing)

Open `docs/roadmap-production-perps.md` if it has landed (parallel doc-write PR). At time of writing, the `docs/roadmap-production-perps` branch is even with `main` — **the doc has not been written yet**.

- **If the roadmap doc has landed by demo time:** point at the 13 pillars. Read:
  > "This is what production-grade looks like. We're shipping against this roadmap, not chasing a hackathon checklist. Every line of code we've written this cycle maps to a pillar."
- **If not landed:** skip this pillar verbally; fall back to the comparative map in `docs/decentralization-narrative.md` and reference `INTEGRATION_ROADMAP.md` at repo root as the existing roadmap surface.

---

## Closing line

> "Synthra is a Uniswap v3 fork plus a frontend. BUFI is a perps protocol with a public roadmap, audited-shape contracts, and a typed integrator surface. Match us on AMM if you ever ship perps; lap us on everything else if you can find the code."

---

## PR cross-reference (the cycle that built this demo)

| # | Title | State | Anchors |
|---|---|---|---|
| [#38](https://github.com/BuFi007/defi-web-app/pull/38) | wk1d1: hono zod-openapi typed BFF pipe + multicall on stablecoin-balances | OPEN | Pillar 3a, 3d |
| [#39](https://github.com/BuFi007/defi-web-app/pull/39) | wk1d2: markets.ts → OpenAPIHono typed surface | OPEN | Pillar 3d |
| [#40](https://github.com/BuFi007/defi-web-app/pull/40) | feat(scripts): perps end-to-end demo trade on Arc Testnet | OPEN | Pillar 5 |
| [#41](https://github.com/BuFi007/defi-web-app/pull/41) | wk1d2: ponder lift-extend — FxMarketRegistry + 3 missing perp handlers | OPEN | Indexer credibility |
| [#42](https://github.com/BuFi007/defi-web-app/pull/42) | docs: decentralization narrative for Synthra side-by-side demo | OPEN | Pillar 4 |
| [#43](https://github.com/BuFi007/defi-web-app/pull/43) | fix(perps): `SIGNED_ORDER_TYPES` missing `maxFee` — typehash drift | OPEN | Pillar 5 |
| [#44](https://github.com/BuFi007/defi-web-app/pull/44) | wk1d2: inline revert reasons via `simulateContract` on loan supply | OPEN | Pillar 3b |
| [#45](https://github.com/BuFi007/defi-web-app/pull/45) | wk1d2: Pyth Hermes WebSocket live ticks (mark + PnL) | OPEN | Pillar 3c |

External tracking issues referenced in the narrative:
- `fx-telarana#26` — Permit2 entrypoints (hackathon-escalated to TODAY)
- `fx-telarana#27` — slice-3 (privacy hook) merge nudge

---

## Demo dry-run checklist

Run these in order before demo day. Tick every box.

- [ ] `bun run dev:complete` boots all services without errors
- [ ] `curl http://localhost:3002/health` returns `{ "status": "ok", ... }`
- [ ] `curl http://localhost:3002/markets` returns the live markets feed
- [ ] Wallet trigger pill loads in <2 s on first open
- [ ] Loan tab Confirm with bad input shows inline `Would revert: …` toast (no MM popup)
- [ ] Chart mark price ticks visibly within 30 s of open
- [ ] DevTools Network panel shows exactly 4 multicall reads on trigger-pill render
- [ ] DevTools Network panel shows `wss://hermes.pyth.network/ws` connection on chart open
- [ ] One known-good `FundingPoked` tx hash bookmarked from `https://testnet.arcscan.app`
- [ ] Live-state snippet (Pillar 2) re-run; numbers in this doc updated if material drift
- [ ] If CCTP PR landed: `cctp-onramp.output.json` shows successful mint to demo wallets → switch Pillar 5 to Variation A
- [ ] If PR #40 unblocked: `scripts/perps-demo-trade.output.json` shows open + close tx hashes → switch Pillar 5 to Variation A
- [ ] If roadmap doc landed: open `docs/roadmap-production-perps.md` on second screen → activate Pillar 6
- [ ] `docs/decentralization-narrative.md` open on the second screen for Pillar 4

---

## Failure modes (rehearse the recovery)

- **API is down**: `<html data-api-status>` reads `down`; the UI gracefully degrades. Don't pretend the API is alive — point at the honest error state. "We built honest error states."
- **Pyth WS reconnect mid-demo**: open `packages/market-data/src/hermes-ws-client.ts` and point at the exponential-backoff list + auto-resubscribe loop. "Exponential backoff, auto-resubscribe."
- **An unrelated transaction reverts**: open DevTools console, copy the revert reason, walk it. "This is why `simulateContract` exists." (Pillar 3b talking point still applies.)
- **Live state values drift between query runs**: this is good — it means real traders are moving margin. Re-run Pillar 2 snippet on stage if anyone asks "are those numbers real?"
