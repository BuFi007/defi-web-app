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

## Bundler / paymaster wiring (Wave F4)

ZeroDev's `createKernelAccountClient` needs a bundler URL to submit
`settleMatch` / `cancelOrder` / `depositMargin` / `withdrawMargin`
UserOps. Arc Testnet does not have a ZeroDev project ID, so Wave F4
routes the rails through Pimlico instead — the kernel signing stays
ZeroDev, but the bundler + paymaster are Pimlico (which speaks the
ERC-7677 paymaster RPC schema viem consumes directly).

```
EOA (one popup, owner approval)
   │
   ▼
ZeroDev kernel (session-key-policies.ts)
   │ session key signs each UserOp
   ▼
buildKernelClient()           ← apps/web/lib/perps/pimlico-client.ts
   │  bundlerTransport → Pimlico bundler RPC
   │  paymaster         → Pimlico paymaster RPC (ERC-7677) — OPTIONAL
   ▼
On-chain settleMatch / cancelOrder / depositMargin / withdrawMargin
```

### Env vars

| Var                                       | Required | Notes |
|-------------------------------------------|----------|-------|
| `NEXT_PUBLIC_PIMLICO_BUNDLER_URL`         | yes      | Pimlico bundler URL template, e.g. `https://api.pimlico.io/v2/{CHAIN_ID}/rpc?apikey=<key>`. `{CHAIN_ID}` is substituted at runtime so one var serves Arc + Fuji. |
| `NEXT_PUBLIC_PIMLICO_PAYMASTER_URL`       | no       | Same template, paymaster path. Omit to pay UserOp gas in USDC (Arc's native gas) instead of sponsoring. |
| `NEXT_PUBLIC_PIMLICO_SPONSORSHIP_POLICY_ID` | no     | Pimlico sponsorship policy id. Passed via `paymasterContext` so only allow-listed UserOps get sponsored. |

The API key is `NEXT_PUBLIC_*` because Pimlico scopes keys to a
referrer / domain allowlist; the risk of bare exposure is bounded to
"someone burns the budget" rather than "someone drains funds". Tighten
the allowlist in the Pimlico dashboard for prod.

### Hooks

```
apps/web/lib/perps/pimlico-client.ts          buildKernelClient(), isPimlicoConfigured()
apps/web/lib/perps/use-session-key-write.ts   useSessionKeyWrite() — kernel UserOp submit
apps/web/lib/perps/use-fast-perp-write.ts     useFastPerpWrite()   — composer with EOA fallback
```

`useFastPerpWrite()` is the call-site-facing surface. It exposes:

```ts
const { submit, isActive } = useFastPerpWrite();
const { txHash, mode } = await submit({
  address: settlementAddress,
  abi: FxOrderSettlementAbi,
  functionName: "settleMatch",
  args: [...],
});
// mode === "session-key" → UserOp via Pimlico
// mode === "eoa"         → wagmi writeContract
```

### Fallback strategy

The composer tries the session-key path first when `isActive === true`.
If `submit()` throws for ANY reason (Pimlico 500, kernel not deployed,
policy mismatch, RPC blip), it logs a console warning and falls
through to the EOA `walletClient.writeContract(...)` path. The user
sees their normal wallet popup — same flow they had before session
keys existed — never a hard failure. The `fallbackReason` field on
the result surfaces the underlying error for an optional toast.

When PR #44's `useSimulatedWrite` lands, swap the inline `eoaSubmit`
body for `useSimulatedWrite().submit(...)`. The composer's public API
(`{ submit, isActive }`) doesn't change.

### Integration pattern (call sites)

Wave F4 ships the PRIMITIVE LAYER only — the actual swap-in at
`order-entry-cta.tsx` / `<MarginPanel />` is a follow-up so this PR
stays small. To wire a call site:

```diff
- const { signTypedDataAsync } = useSignTypedData();
- // ... build EIP-712, sign, POST ...
+ const { submit } = useFastPerpWrite();
+ const { txHash, mode } = await submit({
+   address: settlement,
+   abi: FxOrderSettlementAbi,
+   functionName: "settleMatch",
+   args: [makerOrder, takerOrder, fillSizeE18, priceE18],
+ });
```

For the place-order flow specifically, the EIP-712 path stays — the
matcher consumes signed intents off-chain. Session keys are about
direct on-chain calls (settleMatch self-fill, cancelOrder,
deposit/withdraw margin).

### Pimlico cost notes

- Free tier: enough for testnet demo + early mainnet (low TPS).
- Production: bundler + paymaster typically ~$50–200/mo on Pimlico's
  growth tier depending on volume; check the live pricing page for
  current numbers. The biggest cost lever is sponsorship — gating
  sponsored UserOps via the policy ID keeps spend bounded.
- Self-hosted alternative: Alto (Pimlico's open-source bundler) +
  Skandha (Etherspot's). Slot for later once volume warrants
  cutting Pimlico out of the path.

### Open items

- **ERC-4337 on Arc Testnet**: confirmed Arc's RPC accepts the
  standard EntryPoint v0.7 + bundler interface. Pimlico's chain
  registry needs `5042002` listed; if it isn't yet, the env var stays
  unset and the composer silently uses the EOA path.
- **EIP-7702 mode**: once Arc clients support it, the
  `eip7702Account` createKernelAccount path keeps `order.trader =
  userEOA` AND uses the session-key validator — eliminating the
  deposit-to-kernel caveat entirely. Stays a future-PR concern; the
  current PR works with the kernel-as-trader path.

## File map

```
session-key-storage.ts                           encrypted localStorage (PBKDF2 + AES-GCM)
session-key-policies.ts                          call + timestamp policy builders
use-session-key.ts                               React hook — enable / revoke / decrypt
pimlico-client.ts                                bundler + paymaster wiring (Wave F4)
use-session-key-write.ts                         kernel UserOp submit hook (Wave F4)
use-fast-perp-write.ts                           composer: session-key + EOA fallback (Wave F4)
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
