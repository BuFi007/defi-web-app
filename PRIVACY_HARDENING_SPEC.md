# Privacy Hardening Spec — Ghost Mode

> From the scaled adversarial audit (5 parallel lenses) of `fx-telarana` contracts + `defi-web-app` MCP surface, 2026-05-28. Companion to `PRIVACY_DOGFOOD_REPORT.md`. Contract paths are in `~/coding-dojo/fx-telarana/`.

## Executive finding

There are **two privacy paths** and they fail differently:

1. **0xbow Privacy Pools base** (`FxPrivacyEntrypoint` + `FxPrivacyPool`) — real commitment/nullifier/Groth16 shielding, but weakened by (a) **arbitrary amounts** → amount-fingerprinting → anonymity set ≈ 1, and (b) a **permissive ASP** that rubber-stamps every deposit, nullifying the design's compliance/anonymity guarantee.
2. **Ghost spoke/KYC path** (`FxGhostSpokeRouter` + `FxGhostCommitmentRegistry` + `FxGhostKycHook`) — **stores the depositor address in plaintext** alongside the commitment + beneficiary + amount, indexed in events and in a public getter. **Zero anonymity** against any observer. The KYC gate records who deposited, which is fundamentally incompatible with the privacy claim.

The cryptography (Groth16 commitment/nullifier) is sound. Privacy fails at: amount handling, the KYC/registry plaintext, the permissive ASP, the cross-currency dual-leg event, and the off-chain single-operator path.

## Findings by severity

| # | Sev | Finding | Evidence | Fix layer |
|---|-----|---------|----------|-----------|
| 1 | CRIT | Depositor `account` stored + emitted (indexed) + public getter in the ghost commitment path | `FxGhostCommitmentRegistry.sol:28,62-70,108-110`; `FxGhostSpokeRouter.sol:65-75,130-143` | contract + **product decision (KYC vs privacy)** |
| 2 | CRIT | KYC gate binds verified identity to deposit by construction | `FxGhostSpokeRouter.sol:130-133`; `FxGhostKycHook.sol:198-213` | product decision → ZK membership proof |
| 3 | CRIT | Arbitrary amounts (deposit `_value`, withdraw `withdrawnValue` pubSignal) → anonymity set ≈ 1 | `PrivacyPool.sol:90`; `ProofLib.sol:60`; `Entrypoint.sol:329` | **circuit** + contract gate |
| 4 | CRIT | Cross-currency emits both legs (`_withdrawnAmount`,`_buyAmount`) + indexed `_recipient`; fixed rate → 97% linkable across assets | `FxPrivacyEntrypoint.sol:97-105,246-254` | contract (event) + rate |
| 5 | HIGH | Permissive ASP rubber-stamps all deposits; single deployer key holds OWNER + ASP_POSTMAN (can shrink set to 1) | `Entrypoint.sol:43,85,93-104`; deploy scripts | ops/config + CAS on `updateRoot` |
| 6 | HIGH | No mixing window / anchor-age; deposit+withdraw adjacent blocks; `registeredAt` stored but unused | `FxGhostCommitmentRegistry.sol:141-147` | contract |
| 7 | HIGH | Off-chain: one MCP operator sees both legs (deposit depositor + relay recipient); cleartext bodies | `apps/hyper-mcp/src/routes/ghost.ts`; `app.ts` | defi-web-app + ops |
| 8 | MED | Relay fee (`relayFeeBPS`) user-chosen → per-trade fingerprint; relayer/fee-recipient clustering | `FxPrivacyEntrypoint.sol:194-198`; SDK `feeRecipient ?? recipient` | contract + SDK |
| 9 | MED | Morpho rehypothecation supply/withdraw timing side-channel | `FxPrivacyPool.sol:142-152,187-248` | contract (batch rebalance) |

**Positive (keep):** Groth16 proof + witness stay **client-side** in the SDK (`privacyTradeClient.ts` injected `IWithdrawalProver`; secrets never serialized) — verified. The cross-currency relayer trust model is tight (measured-delta checks). `hyperLog` does not log bodies.

## What a real fix requires (by layer)

- **Circuit (heaviest):** denominations or hidden amounts need the Groth16 withdrawal circuit to constrain `withdrawnValue` to a denomination set, OR Pedersen-commit the value + range proof. New trusted setup / new `WithdrawalVerifier`. **No `.circom` in-repo — verifiers are deployed; this is a ZK workstream, not a Solidity edit.**
- **Contract (in fx-telarana, has 42-test suite):** remove `account` from the ghost registry record/events (#1); drop indexed `_recipient`/`_relayer` + redundant amount legs from `CrossCurrencyRelayed` (#4); add denomination gates on deposit/withdraw (#3, necessary-not-sufficient without circuit); mixing-window/anchor-age (#6); fee tiers (#8); batched Morpho rebalance (#9). **Blast radius: event-ABI changes break Ponder indexer + SDK consumers.**
- **Ops/config:** split OWNER vs ASP_POSTMAN keys, run a real ASP, add compare-and-set `updateRoot` (#5).
- **defi-web-app (lowest risk, in our control):** stop echoing `depositor`/`recipient`/`amount` in ghost route responses; deny-list ghost bodies from Sentry; document the single-operator trust assumption (#7).

## The gating decision (product/compliance — not an engineering call)

**Is Ghost Mode meant to be private FROM the protocol/KYC attester, or only from the public?**
- If **compliance requires recording the depositor** → on-chain privacy against that observer is impossible; the honest move is to **change the claim**, not the contract (findings #1/#2 become "by design, disclosed").
- If **Ghost Mode must be truly private** → the KYC gate must become a **ZK membership proof** ("I hold a pass of level ≥ N" without revealing which), and the registry must stop storing `account`.

This fork determines whether #1/#2 are a contract rewrite or a doc change, so it gates the largest chunk of work.

## Recommended implementation sequence (post-decision)

1. **defi-web-app off-chain hardening (#7)** — safe, in-repo, deployable via the hardened pipeline. Stop echoing correlatable fields; Sentry deny-list. *Can start immediately, no fork dependency.*
2. **Resolve the KYC fork** → then either rewrite the ghost registry/KYC path (#1/#2) or correct the marketing.
3. **Cross-currency event hygiene (#4)** — contract change; coordinate the event-ABI change with the Ponder indexer + SDK.
4. **ASP + key split (#5)** — ops; high value, low code.
5. **Denominations (#3)** — the ZK circuit workstream; largest effort; the real "full privacy scale" fix.
6. **Mixing window, fee tiers, batched rebalance (#6/#8/#9)** — contract follow-ons.
