# GOAL — Ghost Mode private trade wallet (Hinkal-backed, per-chain)

## One-liner
Ghost Mode = a per-chain Hinkal shielded **trade balance** that users deposit into, and from
which all dark-mode trades / supplies / borrows execute via Hinkal `externalAction`s — so the
executor address is **detached from the user's public wallet** but **resolves to the user's
position** privately. Works in the app and in the MCP for private agentic trading.

## Privacy model (precise — this is the honest claim)
A trade hides three independent things; we hit two:

| Dimension | Hidden? | How |
|---|---|---|
| **Who** — user wallet ↔ trade | ✅ | order is submitted by a Hinkal execution address, not the user EOA |
| **How much** — balance, margin funding, PnL | ✅ | funded from a Hinkal shielded balance (amounts hidden) |
| **The position** — that the order exists on the book | ❌ | matcher still receives the order in cleartext to fill it |

**Claim: "unlinkable + amount-private," NOT "invisible position."** Dark-mode copy must say this.

### The resolution requirement (user's clarification)
> "the matcher can still receive the order but the address of who did it wouldn't show. but it should resolve to it."

- The order reaches the matcher/settlement with `trader = <Hinkal execution address>` (detached, rotating). Public observers cannot tie it to the user.
- **Ownership must still resolve privately**: the user (and only the user, via their Hinkal spending/viewing key) can map the execution address back to "my position" to manage/close it. Resolution is private (off-chain index keyed to the viewing key, or a note), never public.

## Architecture
- **Per-chain Ghost Wallet** = a Hinkal shielded balance keyed by `chainId`. Arc (5042002) for perps + lending; Fuji (43113) for spot. One shielded balance per chain (Hinkal is multi-chain; `getEthereumAddressByChain` / per-chain deploy-data already supports this).
- **Execution** = Hinkal `externalAction` (calldata run by the relayer, funded from the shielded balance) calling our contracts: `TelaranaFxOrderSettlement` (perp), spot router (Fuji), Morpho (lend/borrow).
- **0xbow stays the private EXIT rail** (denominated unshield / cross-currency). Not the execution layer. Don't merge the two.
- **Shared package** = port desk-v1 `@bu/private-transfer-core` (wraps `@hinkal/common@0.2.29`) into / shared with defi-web-app. It already exposes shield / unshield / private-transfer / balances / `action` + `callDataString` + `swap`.

## Verified groundwork (this session)
- Hinkal deployed on Arc Testnet: `hinkalAddress 0x92c4Dce78EC1833b2966daF9be175EF50e95BA01`; `chains.constants` arcTestnet=5042002; Alchemy Arc RPC wired.
- USDC + EURC are in Hinkal's Arc token registry (MXNB/QCAD/AUDF/cirBTC are NOT yet).
- desk-v1 already ships the client (`@bu/private-transfer-core`) + an `api/multisig/ops` route + ghost/shielded balance concept. This is a **port + integration, not greenfield**.
- Hinkal supports composable external calls: `@hinkal/common` exports `externalAction` / `ActionData`; the desk wrapper threads `action` + `callDataString` + `swap()`.

## Build status (2026-05-30)
- ✅ **Provider interface** — `apps/web/lib/ghost/shielded-execution-provider.ts` (vendor-neutral; prepare→authorize→submit; `resolveOwnedExecutions` for the "resolves to it" requirement).
- ✅ **MockProvider + registry** — `mock-provider.ts` (in-memory, full interface) + `registry.ts` (the only place a concrete provider is named). 5/5 unit tests pass.
- ✅ **Web wallet wiring** — `usePrivateBalance` in `stablecoin-balances/index.tsx` reads the registry; the Ghost slot shows the (mock) shielded balance, else "Deposit".
- ✅ **MCP tools** — `apps/hyper-mcp/src/routes/ghost-wallet.ts`: `ghost_wallet_balance` (model, no fake number), `deposit` (shield), `withdraw` (unshield), `trade` (shielded execution wrapping a perp). Prepare-only, registered, 5/5 tests, boot-checked.
- ✅ **HinkalProvider body** — `hinkal-provider.ts`, real implementation against the Phase-0-validated API (`prepareEthersHinkal` + `getTotalBalance`/`deposit`/`actionPrivateWallet`). Dynamic-imports `@hinkal/common` so the build stays green without the dep; needs `bun add @hinkal/common` + an ethers-v6 signer to run live.
- ✅ **Phase 0 — PASSED LIVE on Arc (2026-05-31).** Spike `desk-v1/scripts/hinkal-arc-spike.ts`: `getSupportedChains` includes 5042002, token registry syncs (USDC/EURC), `getTotalBalance` reads, deposit Groth16 proof (18 signals), **1 USDC shield landed on-chain** (tx `0x7035cc16…` → Hinkal `0x92c4…BA01`), post-shield shielded balance = 1 USDC. Learnings: use Hinkal's bundled **ethers v6** (v5 → "expected signer"); `checkAccessToken(Arc)` = `undefined` (no gating, open testnet); reads need `updateTokensListBefore=true`.
- ⛔ **Phase 1 — BLOCKED on Hinkal (empirically confirmed 2026-05-31).** Execution from the shielded balance does NOT take arbitrary calldata. Hinkal runs only **pre-registered ExternalAction adapter contracts** (`externalActionMap`/`externalActionId`/`ExternalActionRegistered`). The Emporium is deployed on Arc (`0xe59FF2F5…F8c8`), but the ONLY registered external actions are Hinkal's own: `depositOnChainUtxos` (`0x1E3c…2A34`) + `HinkalStake`. There is NO Morpho or BUFI (`TelaranaFxOrderSettlement`) adapter on Arc — confirmed in Hinkal's arc deploy-data and on-chain. **So "trade/lend/borrow privately from the shielded balance" CANNOT ship on Hinkal until Hinkal deploys + registers a BUFI/Morpho ExternalAction adapter on Arc — a permissioned, Hinkal-side action we cannot do ourselves.** This is the deepest lock-in point: the balance/transfer layer is ours to use, but the EXECUTION layer is gated on Hinkal integrating our contracts.

## Phased plan

### Phase 0 — Balance-layer spike (proves Hinkal is live on Arc) — NEEDS wallet/key + 1 testnet tx
- `prepareWagmiPrivateTransferClient` against Arc → `ensurePrivateAccess(5042002)` → `getHinkalPrivateBalances`.
- One `ShieldToPrivateBalance(USDC, amount)` round-trip on Arc; confirm balance reads back shielded.
- **Done = relayer + access path confirmed live on Arc.** If access fails, everything below blocks on Hinkal enabling Arc.

### Phase 1 — One composable action (proves execution-from-balance) — NEEDS key + 1 tx
- Build `ActionData`/calldata for a **Morpho supply** (smallest real call: 1 call, no matcher/oracle dependency).
- Execute it as a Hinkal `externalAction` funded from the shielded balance.
- **Done = a BUFI contract call executed from the shielded balance, user EOA absent on-chain.**

### Phase 2 — Per-chain Ghost Wallet abstraction + MCP tools
- A `GhostWallet` abstraction keyed by chainId (shielded balance per chain).
- MCP tools (private-trading surface): `ghost_wallet_deposit` (shield), `ghost_wallet_balance` (read), `ghost_wallet_withdraw` (unshield → fresh addr, optionally via 0xbow denominated exit). PREPARE/advice shape consistent with existing ghost routes; never custodies keys.
- llms.txt + privacyNotice: document the Ghost Wallet model + the honest claim.

### Phase 3 — Private perp trade (the headline) — the `trader`-resolution build
- `externalAction` → `TelaranaFxOrderSettlement` with `trader = Hinkal execution address`.
- Matcher receives the order from the detached address; settlement accepts it.
- **Ownership resolution**: a private index (viewing-key-scoped) maps execution address → user so they can list/close positions in Ghost Mode. Design this so resolution is private-only.
- MCP: `ghost_trade_prepare` / agentic private trade from the ghost balance.

### Phase 4 — Private spot (Fuji) + lending borrow + dark-mode UX
- Same action pattern for spot router (Fuji) + Morpho borrow.
- Dark-mode UX: "Deposit to Ghost balance → trade/lend/borrow privately." Honest framing (unlinkable + amount-private).
- Register MXNB/QCAD/AUDF/cirBTC with Hinkal if we want them in scope (USDC/EURC ship first).

## Acceptance criteria
- Ghost Mode user deposits USDC → shielded balance on Arc; balance reads back.
- A perp open + a Morpho supply execute with the user EOA **never appearing on-chain**; position resolves to the user privately.
- MCP exposes deposit / balance / private-trade / withdraw; an agent can run a private trade from the ghost balance end to end.
- Public copy claims only unlinkable + amount-private; position visibility limit disclosed.

## Dependencies / risks
- **Hinkal relayer + access tokens actually operational on Arc** (contracts present ≠ relayer running). Phase 0 is the gate.
- **Action whitelist** — Hinkal's `externalAction` must be allowed to call `TelaranaFxOrderSettlement` / spot router / Morpho (or support arbitrary calldata to them).
- **`trader` resolution** — settlement must accept a Hinkal execution address; private ownership index is net-new design (Phase 3).
- **Liquidations** under an anonymous execution account — permissionless liquidation still works on the public position; shielded-collateral tie needs care.
- **Asset coverage** — USDC/EURC only on Arc today.
- **Compliance** — Hinkal access-token model vs 0xbow ASP vs deferred KYC. Pick a stance before GA.

## Out of scope (honest ceiling)
- Hidden **position/size** on the orderbook (true dark pool) — needs a confidential matcher (FHE/MPC). Separate research track, not this goal.
- KYC/identity binding — deferred per prior decision.
