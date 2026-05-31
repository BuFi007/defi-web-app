# GOAL — Own-stack private execution layer (hyperperformant)

## One-liner
Build BUFI's own private-execution layer so dark-mode trades/supplies/borrows execute
FROM a shielded balance through **our** contracts, relayer, and adapter registry — no
Hinkal dependency for execution, no vendor able to gate which protocols we integrate.
Behind the existing `ShieldedExecutionProvider` interface (impl: `BufiOwnStackProvider`).

## Why (Phase 1 finding)
Hinkal execution = pre-registered ExternalAction adapters only; no Morpho/BUFI adapter on
Arc, and only Hinkal can register one. The execution layer is the deepest lock-in point.
We own the balance layer enough already (0xbow `FxPrivacyEntrypoint` + `relayer-privacy`);
we extend it into an execution router we control.

## The unlock: reuse `relayCrossCurrency`, no new circuit
`FxPrivacyEntrypoint.relayCrossCurrency(_withdrawal, _proof, _scope)` already:
withdraws a shielded note to the entrypoint → reads `_withdrawal.data` (a blob **bound into
the Groth16 proof `context`**, so a relayer can't tamper it) → calls a swap adapter → settles
to a recipient, with measured-delta safety checks.

Generalize that into **`relayExecute`**: `_withdrawal.data` carries `{adapterId, calldata,
fundingToken, recipient}`; the entrypoint looks up a **registered adapter** and calls it.
Consequences:
- **NO new circuit, NO new trusted setup** — the deployed `WithdrawalVerifier` is reused
  byte-for-byte (the proof is a standard 0xbow withdrawal whose context binds the adapter
  call). This is the single biggest performance + safety + time win.
- **We own the adapter registry** — `registerAdapter(id, target, selectorAllowlist)` is
  owner-gated and ours. Morpho, `TelaranaFxOrderSettlement`, spot router register here.
- The executor (entrypoint, or a per-call stealth sub-account) is the on-chain `msg.sender`
  / order `trader` — detached from the user; resolves back privately (viewing-key index).

## Reuse vs net-new
| Reuse (have it) | Net-new (build) |
|---|---|
| `FxPrivacyEntrypoint` + `FxPrivacyPool` (ours, deployed, denomination-gated) | `relayExecute` + adapter registry (Solidity, fx-telarana) |
| `WithdrawalVerifier` (deployed — NO ceremony) | Morpho / Telarana-perp / spot adapter contracts |
| `relayer-privacy` service (ours) | Server-side prover (latency) + relayer nonce-pool (throughput) |
| `ShieldedExecutionProvider` interface + MockProvider + MCP tools | `BufiOwnStackProvider.prepareExecute` → `relayExecute` |
| `relayCrossCurrency` pattern (withdraw→adapter→settle, context-bound) | Private ownership-resolution index (viewing-key scoped) |

## Hyperperformance design (the explicit requirement)
The ZK proof is the only real latency cost (verify is fixed ~250k gas; gen is the variable).
Targets on Arc (sub-second finality): **p50 < 1.5s, p99 < 3s** end-to-end per private trade.

1. **Server-side / GPU proving** in `relayer-privacy` — move Groth16 witness+proof gen off the
   client to fast hardware; client sends a signed intent + secrets-derived inputs, prover
   returns the proof. Removes the ~1–3s browser-WASM prove from the hot path.
2. **Two tiers (privacy/perf tradeoff, explicit to the user):**
   - **Per-trade proof** — one withdrawal proof per trade. Max unlinkability, proof-bound latency.
   - **Session executor** — one proof funds an ephemeral executor; N trades run from it at
     native speed (linkable within the session, unlinkable to the user). For active trading.
3. **Relayer throughput** — a DEDICATED relayer key pool with parallel nonce lanes. (Do NOT
   reuse the Gateway BurnIntent EOA — we already hit `nonce too low` races on it.)
4. **Gas-minimized atomic path** — one verifier call + withdraw + adapter call + settle in a
   single tx; precompute/caching of merkle paths; batched root updates.
5. **Arc-native** — sub-second blocks + USDC-as-gas; finality is not the bottleneck, proving is.

## Phases
0. ✅ **DONE (contract layer, 2026-05-31)** — `relayExecute` + owner-controlled adapter registry
   shipped in `FxPrivacyEntrypoint` (fx-telarana `6086d74`); `IFxExecutionAdapter` +
   `FxMorphoSupplyAdapter`. Proven in unit tests (MockVerifier/MockMorpho): shielded-note →
   Morpho-supply atomic, fee skim, unregistered-adapter + zero-recipient reverts, owner-gated
   registration. FxPrivacyEntrypoint suite 27/27. NO new circuit (deployed verifier reused;
   adapter+calldata bound into the proof context — confirmed). Live on-chain proof-gen round-trip
   deferred to Phase 2 (prover). Remaining design follow-up: generalize for a *settle-back* result
   (borrow/swap) is coded but only the supply path is tested.
1. ✅ **DONE (2026-05-31)** — adapters: `FxMorphoSupplyAdapter` (Phase 0), **`FxPerpMarginAdapter`**
   (private perp = fund the detached executor's margin via `FxMarginAccount.depositMargin`; the
   perp is a CLOB so a position isn't one on-chain call — we fund margin privately, the executor
   trades from it), **`FxSpotSwapAdapter`** (swap via the protocol swap adapter, settle-back to the
   recipient). All caller-gated to the entrypoint. **Selector-allowlist note:** we DON'T pass
   arbitrary calldata to arbitrary targets — each adapter is a purpose-built, owner-registered
   contract doing one vetted action, which IS the allowlist (safer than selector-gating raw calls).
   FxPrivacyEntrypoint suite 29/29 (perp-margin + spot-swap from a shielded note proven).
2. **Relayer + prover** — server-side proving + dedicated relayer key-pool/nonce-lanes; perf bench.
   - ✅ **Software (2026-05-31, fx-telarana `4224805`)** — `privacy-prover/scripts/b5-execute.ts`
     (deposit-state → ASP root → context over the ExecutionRelayData blob →
     `snarkjs.groth16.fullProve` → `relayExecute`; near-verbatim from the proven `b5-withdraw`,
     same circuit/verifier → no new ceremony) + SDK `contractsService.relayExecute` (+ ABI),
     used by the relayer + script + provider.
   - ✅ **LIVE + GREEN on Arc (2026-05-31).** Full private-execution round-trip landed on-chain:
     shielded note (FxPrivacyPool) → `relayExecute` (our router) → registered `FxMorphoSupplyAdapter`
     → Morpho supply onBehalf the recipient, executor = entrypoint (detached from the user), REAL
     Groth16 proof vs the deployed `WithdrawalVerifier` (no new ceremony). tx
     `0x228281957bc83b3b539d0258aeaa9469cf3b1a6fb42de503c7674a1bc6eaadbf` (block 44909525, status 1);
     Morpho `position(M2, deployer)` = 2e12 supply shares from 1 USDC. Leaf reconstruction needed NO
     indexer — binary-search `currentTreeSize()` by block + `LeafInserted` rebuild on the plain RPC.
     Two close fixes: (a) encode `ExecutionRelayData` (dynamic bytes field → dynamic tuple) as ONE
     tuple so on-chain `abi.decode` finds the leading offset; (b) fresh deposit per run (nullifier
     is single-use). The earlier `NativeAssetNotAccepted` diagnosis was wrong — it was the decode.
   - (historical) earlier-this-day status — executor deployed; e2e was thought gated on an indexer:
     Done live: impl upgraded to the `relayExecute` version (`0xA9c4B2D0db74F34ABCF3478d2460973Bc2E3520d`,
     denominations persisted); `FxMorphoSupplyAdapter` (`0x98A23BdCf0A35bDd678CB00B2dDF8dE108980C95`)
     deployed + registered at id 1; snarkjs + canonical circuits set up; a 1 USDC denomination deposit
     landed in the live USDC pool; the server-side prover generated a valid 8-signal Groth16 proof.
     **Blocker (infra, not design):** the live USDC pool has 5 leaves; a valid withdraw proof needs the
     pool's real merkle tree, but 4 leaves are deep in history and the free-tier drpc RPC caps `getLogs`
     at 10k blocks → reconstruction needs the Ponder indexer or an archive RPC (the production relayer
     has this; the b5 single-leaf harness was a virgin-pool shortcut). `relayExecute` reverts at
     `pool.withdraw`'s `_isKnownRoot` until the real tree is supplied.
   - ⏳ **Runbook (for an indexer/archive-RPC env):**
     1. Upgrade the live Arc entrypoint impl to the `relayExecute` version (UUPS `upgradeToAndCall`,
        owner key — same as the denomination upgrade; storage-safe, denominations persist).
     2. Deploy `FxMorphoSupplyAdapter` on Arc + `registerExecutionAdapter(1, adapter)` (owner).
     3. `bun add snarkjs` + `fetch-circuits.sh` (withdraw.wasm/.zkey from `discovery/.../build/withdraw`).
     4. `b5-deposit` a denomination (e.g. 100 USDC) into the live USDC FxPrivacyPool.
     5. `EXEC_ADAPTER_ID=1 EXEC_ADAPTER_DATA=<abi MarketParams> b5-execute` → Morpho supply lands
        from the shielded note via `relayExecute`, REAL Groth16 proof against the deployed verifier.
   - ⏳ **Throughput** — dedicated relayer key-pool + parallel nonce lanes (not the BurnIntent EOA),
     `/v1/relayExecute` HTTP endpoint (thin wrapper over `contractsService.relayExecute`).
3. **Resolution index** — viewing-key-scoped executor→user map (private "my positions"); the
   `resolveOwnedExecutions` impl.
   **Plan (ready to build):** today the Morpho supply runs onBehalf a `recipient` we pass — for real
   privacy that recipient must be a STEALTH address the user controls but that's unlinkable to their
   main wallet, AND the user must be able to find their positions again. Design:
   - `lib/ghost/stealth.ts` — derive deterministic per-trade recipients from the user's viewing key:
     `recipient_i = privateKeyToAddress(keccak(viewKey, chainId, i))`. Fresh per trade (unlinkable),
     fully regenerable from one key.
   - `resolveOwnedExecutions(signer, chainId)` = regenerate the user's stealth addresses + query each
     protocol (Morpho `position`, perp `marginOf`) for non-zero state → the owned positions. Private,
     key-scoped, no on-chain memo needed. (Optional later: emit an encrypted memo in the `Executed`
     event for faster scanning.)
   - First move: `stealth.ts` + a unit test (derive → addresses are deterministic + distinct), then
     wire it into the provider's `prepareExecute` (recipient) + `resolveOwnedExecutions`.
4. **`BufiOwnStackProvider`** — implement the interface; flip `createGhostRegistry` to route
   Arc execution → own-stack (balance/transfer can stay Hinkal or move too, per the interface).
   **Plan (ready to build):**
   - **Core engine first** — extract the proven `b5-execute` logic into a reusable
     `proveAndBuildRelayExecute({ note, adapterId, recipient, adapterData })` in `privacy-prover`
     (binary-search leaf reconstruction + tuple-encode `ExecutionRelayData` + `snarkjs.fullProve` +
     return `{ withdrawal, proof, scope }`). This is the shared engine the provider, relayer, and MCP use.
   - **Relayer** — add `POST /v1/relayExecute` to `relayer-privacy` (thin wrapper over the SDK
     `contractsService.relayExecute` I already added) + dedicated key/nonce-lane.
   - **`BufiOwnStackProvider`** (`apps/web/lib/ghost/bufi-ownstack-provider.ts`) implementing the
     interface: `ensureAccess` = derive viewing+spending keys from a signature (our pool is open/ASP-gated,
     no access token); `prepareShield` = `entrypoint.deposit(asset, denomination, precommitment)` (gated);
     `getBalances` = the user's notes via LeafInserted reconstruction + owned-secret match;
     `prepareExecute` = `proveAndBuildRelayExecute` → relayer submit; `resolveOwnedExecutions` = Phase 3 stealth scan.
   - **Note store** — a client-side per-deposit note record (nullifier/secret/label/commitment) so the
     user can spend + read balances. Keyed to the spending key.
   - **Flip the registry** — `createGhostRegistry("live")` routes Arc → `BufiOwnStackProvider`; the web
     Ghost slot + MCP `ghost_wallet_*` tools then run against our own stack, no call-site changes.
   - Sequencing: engine → relayer endpoint → provider (`ensureAccess`/`prepareShield`/`getBalances` first,
     then `prepareExecute`) → stealth/resolution → registry flip.
5. **Perf hardening** — hit p50<1.5s/p99<3s; ship the session tier.

## Acceptance
- A private **Morpho supply** AND a private **perp open** execute atomically from a shielded
  note via OUR `relayExecute` + OUR registered adapter, with the user EOA absent on-chain and
  the position resolving to the user privately.
- **No new trusted setup** (deployed `WithdrawalVerifier` reused).
- p50 < 1.5s, p99 < 3s end-to-end per private trade (server-side proving + Arc finality).
- Adapter registry owner-controlled by us; adding a protocol is our action, not a vendor's.

## Risks / open questions
- **Context binding** — `{adapterId, calldata, fundingToken}` MUST be bound into the proof
  `context` (like relayCrossCurrency binds its data) so a relayer can't redirect funds. This is
  the core security property; verify the existing context construction covers an arbitrary blob.
- **Adapter safety** — registered adapters are a call-out surface; per-adapter audit + selector
  allowlist + measured-delta settle checks. Arbitrary calldata to a target is the danger.
- **Server-side proving** — centralizes the prover (liveness + trust); mitigate with a
  self-prove fallback and/or multiple provers. Privacy: the prover sees inputs → run it in the
  same trust domain as the user (self-hosted) for the strong tier.
- **Liquidations** of private perps under detached executors — permissionless liquidation still
  works on the public position; shielded-collateral tie + margin top-up from shielded balance
  needs design.
- **Resolution privacy** — the executor→user index must be viewing-key encrypted, never public.

## Out of scope
- Hidden position/size on the matcher (confidential matcher / FHE) — separate track.
- KYC binding — deferred.
- Replacing Hinkal for the BALANCE/transfer layer — optional; the interface lets balance stay
  Hinkal while execution moves to own-stack.
