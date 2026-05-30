# Privacy Circuit Workplan — "fully private" Ghost Mode

Goal: make Ghost Mode genuinely unlinkable (depositor ↔ recipient), deferring the
KYC/compliance binding (#1/#2) to a later, separate decision. This is the plan the
amount-privacy work follows across both repos.

Date: 2026-05-30. Supersedes the amount sections of `PRIVACY_HARDENING_SPEC.md`
(the 9-finding audit) with a concrete, sequenced build plan.

---

## The load-bearing truth: amounts are necessarily public

On a transparent chain you **cannot hide a withdrawal amount** while settling in a
standard ERC20:

- The pool withdraws by calling `token.transfer(recipient, withdrawnValue)` — the
  transfer amount is public in the token's `Transfer` event regardless of the proof.
- The Groth16 withdraw circuit (`privacy-pools-core/.../withdraw.circom`, pinned
  `a80836a`) declares `withdrawnValue` as a **public signal**. Verified in-repo:
  `relay`/`relayCrossCurrency` take `pubSignals: uint256[8]`.

So "confidential amounts" is not a circuit tweak — it requires abandoning direct
ERC20 settlement (shielded balance accounting / a confidential token). That's a
major re-architecture (tier C3 below), not the near-term path.

**The realistic full-privacy lever is FIXED DENOMINATIONS:** if every deposit and
withdrawal is one of a small shared set of amounts, the public amount carries no
linking information — many deposits match each withdrawal, lifting the anonymity
set off 1 (the Tornado model). And critically, **denomination enforcement needs no
new trusted setup** — see C1.

---

## Leaks by layer (recap)

| Layer | Leak | Status |
|---|---|---|
| Circuit | `withdrawnValue` public → amount-matching → anon set ≈ 1 | floor; fixed by denominations (C1) not by editing the circuit |
| Contract | `CrossCurrencyRelayed` emits `amountIn`+`amountOut`+indexed `_recipient` at fixed rate → ~97% cross-asset linkable (#4); no mixing window (#6); user-chosen `relayFeeBPS` fingerprint (#8) | C2 (fx-telarana) |
| HTTP/Ops | one operator sees both legs; Sentry sink (#7) | **shipped** (see below) |
| Identity | depositor `account` stored/emitted; KYC binds identity (#1/#2) | **DEFERRED** by decision |

---

## Tiers

### C1 — Fixed denominations (the main win; NO new trusted setup) ✅ design locked

The deployed `WithdrawalVerifier` already range-checks `withdrawnValue`/`remainingValue`
to 128 bits. Constraining values to a denomination **set** is an *additional*
`require()` at the Solidity layer — the circuit and verifier stay **byte-identical**
(lockstep with pin `a80836a` preserved). No `.circom` change, no ceremony.

Steps:
1. **MCP advice layer (defi-web-app) — DONE this commit.** `/ghost/deposit` refuses
   off-denomination amounts; `/ghost/pools` surfaces the set; `/ghost/privacy-check`
   scores against denomination membership; `privacyNotice.denominations` documents it.
   Denomination sets: stablecoins `1/10/100/1000/10000`, cirBTC `0.001/0.01/0.1/1`.
2. **Contract gate (fx-telarana) — DONE + DEPLOYED + LIVE on Arc Testnet.**
   Authoritative enforcement via OZ-style `_beforeDeposit`/`_beforeWithdraw` hooks on
   the vendored `Entrypoint` (proof/withdraw logic + `WithdrawalVerifier` untouched) +
   overrides in `FxPrivacyEntrypoint` that `revert NotADenomination`; `relayCrossCurrency`
   gated too. Owner-gated `setDenominations`/`setDenominationGateEnabled`; gate OFF by
   default. 7 tests, 22/22 entrypoint suite. Deployed 2026-05-30 via
   `ConfigurePrivacyDenominations.s.sol`: new impl `0x56A4a05862aC57E0E1432f5e2CAC0Cd9852608fE`
   UUPS-upgraded into proxy `0xD11cDdd1f04e850d3810a71608A49907c80f2736`; `setDenominations`
   set for all 6 assets; verified `denominationGateEnabled=true` for each and
   `isDenomination` correct (USDC 100✓/50✗, cirBTC 0.1✓/100✗). An off-denomination
   deposit/withdrawal now reverts on-chain, not just at the MCP advice layer.
3. **SDK (`@bufi/fx-telarana-sdk`)** — expose the denomination set + a `splitIntoDenominations(amount)`
   helper so larger amounts fan out into multiple denomination deposits/withdrawals.

Anonymity set after C1 = number of deposits sharing that denomination. Real, soft
until volume builds, but off 1.

### C2 — Contract event + behavior hygiene (fx-telarana; no ceremony)

- **#4** Drop the redundant amount leg and the indexed `_recipient`/`_relayer` from
  `CrossCurrencyRelayed`; ideally route cross-currency as deposit-to-EURC-pool so it
  doesn't emit a paired-amount event at all.
- **#6** Enforce a mixing window: use the already-stored `registeredAt` to require a
  minimum anchor age between deposit and withdrawal (the MCP linter already warns at
  `GHOST_MIN_MIX_SECONDS=3600`; make it on-chain).
- **#8** Replace user-chosen `relayFeeBPS` with a small fixed fee-tier set so the fee
  isn't a per-trade fingerprint.

⚠️ **Blast radius:** event-ABI changes break the Ponder indexer + any SDK consumer.
fx-telarana has a 42-test suite — run it; update Ponder schema + SDK decoders in the
same change.

### C3 — Confidential amounts (FUTURE; needs ceremony + re-architecture)

Only if denominations prove insufficient. Make `withdrawnValue` private and stop
settling in raw ERC20:
- Pedersen-commit the value + Groth16 range proof + balance-conservation constraint.
- Pool tracks value commitments; exit still ultimately reveals an amount unless via
  denominations — so C3 mostly helps *internal* transfers, not exits.
- Requires a **new trusted setup ceremony**, a new `WithdrawalVerifier` deploy, and
  regenerated prover artifacts (wasm/zkey, ~600KB browser bundle). This is a ZK
  workstream, not a Solidity edit. Treat as a separate funded project.

### OPS — off-chain operator hygiene (defi-web-app) ✅ shipped

- `beforeSend` already scrubs ghost request bodies from Sentry.
- **This commit:** `instrumentMcpCall` no longer tags the caller wallet on ghost spans
  ("wallet X used ghost at time T" was itself a correlation point) — Sentry now holds
  zero ghost-linkable identity.
- Deposit response already does not echo the depositor.
- Relay/swap still echo `recipient` (the caller needs it for the proof) — that's
  caller-visible only, not stored. The residual single-operator correlation is
  disclosed in `privacyNotice.offChain`; the structural fix is split operators or a
  self-hosted relayer (out of scope here).

---

## Sequence

1. **C1 step 1 + OPS** — shipped (this commit, MCP lane). No ceremony.
2. **C1 step 2 (contract denomination gate) + C2 (event hygiene, mixing window, fee tiers)**
   — fx-telarana, one change set, run the 42-test suite + update Ponder + SDK. No ceremony.
3. **C1 step 3 (SDK denomination helpers).**
4. **C3** — only if needed; separate ceremony-bearing project.

KYC/compliance binding (#1/#2) is intentionally **out of this plan** — decide and
implement separately, after the unlinkability baseline is in place.
