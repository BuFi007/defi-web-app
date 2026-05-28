# Privacy Dogfood Report — Ghost / Shielded Pools

> Run: 2026-05-28 · Model: Opus 4.8 · Method: adversarial (verify, don't trust the "Groth16 = private" label)
> Target: `FxPrivacyEntrypoint` @ `0xd1bEB7Ba76D234c65e26F9F53e7efD1b1f36f985` (Arc 5042002) + `/api/ghost/*` routes
> Question asked: **do our contracts actually deliver privacy, or do the routes/events leak the link between depositor and recipient?**

## Verdict

**The cryptography is sound and cosmetic.** The Groth16 commitment/nullifier scheme correctly hides *which* deposit a withdrawal spends. It does not matter — because the data sitting next to the proof deanonymizes users without touching the proof at all.

**A chain-analysis adversary links depositor → recipient with ~95% confidence and an effective anonymity set of 1.** The privacy claim in `llms.txt` ("positions and balances are hidden behind Groth16 zero-knowledge proofs") is **false in practice** for the deployed surface.

## Ground truth — the public event schema (from `FxPrivacyEntrypoint.ts` ABI)

```
Deposited(address depositor INDEXED, address pool INDEXED, uint256 commitment, uint256 amount)
Relayed(address pool INDEXED, address recipient INDEXED, uint256 amount)
CrossCurrencyRelayed(address fromPool INDEXED, address toAsset INDEXED, address recipient INDEXED, uint256 amountIn, uint256 amountOut)
```

Everything an attacker needs is public:
- `depositor` and `recipient` are **indexed topics** → directly queryable by address.
- `amount` on both legs is **plaintext** and **user-chosen / arbitrary** (e.g. 9.20).
- Cross-currency emits **both** `amountIn` and `amountOut`, and the rate is fixed & published (1 USDC = 0.92 EURC).

## The killer leak — amount fingerprinting (severity: CRITICAL for a privacy product)

Arbitrary plaintext amounts are unique labels. Deposit 9.20 → later a Relayed of 9.20 to `0xBEEF`. No other in-window deposit equals 9.20, so the match is decisive. The ZK proof hides the merkle path; it does nothing about the value field printed next to it.

- **Anonymity set collapses to 1.** Nominal set = all concurrent deposits; amount-matching reduces it to the single deposit that could produce that withdrawal amount.
- **Groth16 soundness is irrelevant to the attack.** The adversary never attacks the proof. (Independent adversary agent, 95% confidence, set size 1.)
- **This is the Tornado Cash lesson:** unlinkability requires **fixed denominations** + a real anonymity set. Arbitrary amounts = pseudo-privacy.

## Cross-currency makes it worse

`amountOut / 0.92 = amountIn` is a deterministic, invertible function. A 8.464 EURC withdrawal back-solves to a 9.20 USDC deposit. Cross-currency *feels* like extra mixing (different asset, different pool) but the fixed rate **re-links across asset boundaries** and leaks the source amount just as cleanly.

## The "ZK PnL attestation" is theater

`ghost_pnl` is described as "net flow = deposits − withdrawals." Both legs are public and (per above) linkable, so the "private" P&L is computable from public data by anyone who can match amounts. It hides nothing that isn't already derivable.

## API / off-chain layer (secondary, but real)

- **Routes echo plaintext correlatable fields**: `/api/ghost/deposit` returns `depositor` + `amount`; `/api/ghost/relay` returns `recipient` + `amount`; `/api/ghost/swap` returns `amountIn`/`estimatedOut`/`recipient`. Request + response bodies cross the wire in plaintext.
- **The MCP is a trusted intermediary that sees both legs.** One server handles the deposit request (depositor) and the relay request (recipient); even with on-chain privacy, the API operator (or any proxy/APM/MITM in front of it) can timing-correlate the two.
- **Mitigating finding (corrected my own initial over-claim):** the structured `hyperLog` does NOT log request bodies — only route + request_id + timing. So the *log file* leak is timing-only, not address/amount. Bodies are still exposed in memory and on the wire.
- **The routes don't actually perform ZK.** `/api/ghost/relay` returns contract params + the string instruction "derive nullifier from secret… Groth16 via snarkjs." Privacy depends entirely on a client the API doesn't control, while the API's copy ("trade privately, hidden behind Groth16") oversells the deployed surface.

## What's actually fine (positive ledger)

- The commitment/nullifier circuit design itself is standard and sound — the foundation is reusable.
- Secrets/nullifiers are NOT sent to the server in the current route schema (proof is client-side) — good, keep this invariant.
- Deposit-is-public / withdrawal-is-private is the correct *shape*; the failure is in amount handling, not topology.

## Fixes (ranked; to be condensed into the plan)

1. **Fixed denominations** (1 / 10 / 100 / …). The single highest-leverage fix — makes amounts collide so 9.20 is no longer a fingerprint. Withdrawals must equal a denomination, not an arbitrary number.
2. **If arbitrary amounts are a hard product requirement:** confidential amounts (Pedersen commitments + range proofs) so the value field is never plaintext; and/or randomized relayer fees/splits so withdrawn value never equals any single deposited value.
3. **Enforce a real anonymity set**: gate withdrawals on N same-denomination deposits existing first; batch/pool withdrawals.
4. **Randomized time delays / mixing window** to kill the deposit→withdrawal timing proximity.
5. **Cross-currency:** stop emitting both `amountIn` and `amountOut`; avoid a single fixed published rate (ranges/auctions) — otherwise the invertible rate re-links everything.
6. **API honesty + hygiene:** until denominations land, downgrade the `llms.txt` privacy claim (state plainly that amounts are linkable); stop echoing plaintext `amount`/`recipient` in responses; document that a single MCP operator can timing-correlate both legs.

## Methodology

- Verified the event schema against the actual `FxPrivacyEntrypoint` ABI (`packages/contracts/src/abis/FxPrivacyEntrypoint.ts`) — ground truth, not the marketing copy.
- Confirmed live route echo surface by hitting `/api/ghost/{deposit,relay,swap}` on a local server.
- Confirmed the structured log does NOT capture bodies (corrected an initial over-claim — Gateman on myself).
- Independent adversarial agent given ONLY the public event schema + a realistic scenario; reproduced the amount-correlation attack at 95% confidence, anonymity set 1.
