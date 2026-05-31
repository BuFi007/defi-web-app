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
3. **Resolution index** — viewing-key-scoped executor→user map (private "my positions"); the
   `resolveOwnedExecutions` impl.
4. **`BufiOwnStackProvider`** — implement the interface; flip `createGhostRegistry` to route
   Arc execution → own-stack (balance/transfer can stay Hinkal or move too, per the interface).
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
