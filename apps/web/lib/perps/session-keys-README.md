# Perp Session Keys (Wave E3)

## What this enables

One MetaMask popup → up to 1 hour of zero-popup perp trading. The user
authorises a fresh in-memory EOA ("session key") to act on behalf of a
ZeroDev kernel smart account, scoped to a small set of perp functions
on `FxOrderSettlement` and `FxMarginAccount`. Every subsequent order is
signed by the session key with no wallet prompt.

## Why it works without any contract change

`FxOrderSettlement._validateOrder`
(`/Users/criptopoeta/coding-dojo/fx-telarana/contracts/src/perp/FxOrderSettlement.sol:120-127`)
uses OpenZeppelin's `SignatureChecker.isValidSignatureNow(trader, hash, sig)`.
That helper:

- For an EOA `trader`, runs `ecrecover` (today's path).
- For a contract `trader`, calls `IERC1271(trader).isValidSignature(hash, sig)`.

ZeroDev kernels implement ERC-1271 and dispatch the call to the active
validator. When the session-key permission validator is installed, it
returns `MAGICVALUE` iff the session key signed the digest and every
policy passes. Result: `order.trader = kernelAddress` + session-key sig
is accepted on-chain with no Solidity edits.

## The one UX caveat: deposit-to-kernel

Because `order.trader` becomes the kernel address (not the user's EOA),
the trader's USDC margin must live in `FxMarginAccount` under the
**kernel address**, not the EOA address. Concretely:

1. First time the user enables fast trading we derive the kernel address
   from the user's EOA + ZeroDev's deterministic deployment (so the same
   EOA → the same kernel address across sessions on the same chain).
2. The user calls `FxMarginAccount.depositMargin(kernelAddress, amount)`.
   This is the ONE extra mental step compared to vanilla EOA trading.
3. Trades execute against the kernel's margin balance. Funding /
   liquidation / P&L all credit/debit the kernel.
4. To withdraw, the user (or the session key, while still authorised)
   calls `FxMarginAccount.withdrawMargin(kernelAddress, amount)`. Funds
   land in the kernel; one final EOA tx pulls them back to the EOA.

The UI flow in `<SessionKeyToggle>` makes this caveat explicit before
the first authorisation popup. A user who has already deposited to
their EOA path can still trade the EOA way — the feature flag is
strictly additive.

## Feature flag

`NEXT_PUBLIC_SESSION_KEYS_ENABLED=true` exposes the toggle.
When `false` (default) the toggle is hidden, no kernel is created, and
the EOA `useSignTypedData` path in `usePlaceOrder` runs unchanged.

Until QA passes end-to-end on Arc Testnet with a real Pimlico bundler
+ paymaster wired up, the flag stays off in production.

## Open items (paymaster / bundler)

ZeroDev's `createKernelAccountClient` needs a bundler URL (Pimlico or
ZeroDev-hosted) to submit `settleMatch` UserOps. Arc Testnet does not
yet have a ZeroDev project ID provisioned; on the next pass we either:

- (a) configure a Pimlico endpoint that routes to Arc Testnet's bundler
  and sponsor UserOps via a Circle-issued paymaster, OR
- (b) defer to EIP-7702 mode once Arc's clients support it (the
  `eip7702Account` createKernelAccount path keeps `order.trader = userEOA`
  AND uses the session-key validator — eliminating the deposit-to-kernel
  caveat entirely).

This worktree ships the policy + storage + UI scaffolding. The bundler
wire-up + acceptance tests live downstream of paymaster sign-off.

## File map

```
session-key-storage.ts     encrypted localStorage (PBKDF2 + AES-GCM)
session-key-policies.ts    call + timestamp policy builders
use-session-key.ts         React hook — enable / revoke / decrypt
components/trade-island/session-key-toggle.tsx   the "Enable fast trading" UI
app/[locale]/settings/session-keys/page.tsx      manage active sessions
```

## Related links

- Roadmap pillar 10 (Frontend & UX) — PR #46 in
  `docs/roadmap-production-perps.md`.
- Wave D `useOptimisticPlaceOrder` — `feat/wk1d3-perps-optimistic-ui`.
  API receives the EIP-712 sig; session key signs the same typed data
  with `trader=kernelAddress` and ERC-1271 validates server-side via
  the contract.
- PR #44 `useSimulatedWrite` — accepts any `WalletClient`, so the
  kernel's `KernelAccountClient` can drop in unchanged when bundler is
  configured.
