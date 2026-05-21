# `lib/permit2/` — Uniswap Permit2 web scaffolding (Wave H4)

Pre-built frontend primitives for the one-signature USDC deposit flow. Goes
live the moment the Permit2 (a) router from `fx-telarana#26` ships and the
per-chain env var is set; until then, `usePermit2Signature()` reports
"feature flag off" and call sites stay on the legacy `approve` +
`transferFrom` path.

## Why this lands BEFORE the contract router

The Permit2 contract itself is universally deployed at the canonical
`0x000000000022D473030F116dDEE9F6B43aC78BA3` on every EVM chain we
target. What we're waiting on is the BUFI protocol router that will
consume our permits (`fx-telarana#26`). Two of the three pieces of the
one-sig UX —

1. building the EIP-712 `PermitSingle` / `PermitTransferFrom` typed-data,
2. asking the wallet to sign it,

— can be implemented + tested today against the canonical Permit2 spec.
The third (handing `(permit, signature)` to the router) is gated on the
contract address showing up in
`NEXT_PUBLIC_PERMIT2_ROUTER_ADDRESS_<chainId>`. When that env flips, the
hook starts returning real signed envelopes instead of `null`, and call
sites flip from the fallback approve flow to the one-sig flow without
any further code change.

## Public surface

```ts
import {
  // Constants
  PERMIT2_ADDRESS,            // 0x000000000022D473030F116dDEE9F6B43aC78BA3
  ALLOWANCE_EXPIRATION_DEFAULTS,

  // Typed-data builders (pure, side-effect-free)
  buildPermitSingleTypedData,
  buildPermitTransferFromTypedData,

  // React hook (wagmi-bound)
  usePermit2Signature,

  // Feature-flag resolver
  resolvePermit2Router,
  isPermit2RouterAvailable,

  // Nonce reader (SignatureTransfer bitmap walker)
  nextPermit2Nonce,
} from "@/lib/permit2";
```

## File layout

| File                       | Responsibility                                                                |
| -------------------------- | ----------------------------------------------------------------------------- |
| `constants.ts`             | `PERMIT2_ADDRESS`, domain name, allowance/sig-deadline defaults.              |
| `types.ts`                 | `PermitSingle*` / `PermitTransferFrom*` shapes + EIP-712 type tables.         |
| `typed-data.ts`            | `buildPermit2Domain`, `buildPermitSingleTypedData`, `buildPermitTransferFromTypedData`. |
| `router.ts`                | Per-chain env lookup (`NEXT_PUBLIC_PERMIT2_ROUTER_ADDRESS_<chainId>`).        |
| `use-permit-signature.ts`  | `usePermit2Signature()` — wagmi-bound React hook.                             |
| `next-nonce.ts`            | SignatureTransfer bitmap walker (`nonceBitmap(owner, wordPos)`).              |
| `index.ts`                 | Barrel re-export.                                                             |
| `*.test.ts`                | bun:test suites for typed-data, nonce walker, router.                         |

## Why hand-rolled instead of `@uniswap/permit2-sdk`?

- The Permit2 typed-data shape is **fully captured** in ~60 lines of
  TypeScript (see `types.ts` + `typed-data.ts`). The SDK adds an
  `ethers v5` peer + ~10 transitive deps for the same surface.
- Self-consistency tests in `typed-data.test.ts` hand-walk the EIP-712
  envelope (typeHash → struct hash → domain separator → digest) and
  compare against viem's `hashTypedData`. The two paths agreeing is
  cryptographic proof that our message ordering + field types match
  what the on-chain `Permit2.permit()` would recover from.
- If a future Permit2 v2 needs the SDK's encode helpers, we can adopt
  it then — the public surface here is small enough to swap.

Stop condition from the brief was honoured: SDK was considered, the
diff stays small with hand-rolled typed-data + first-party tests, so
hand-rolling is the right call.

## Feature flag mechanism

```ts
// Off — env var unset:
resolvePermit2Router(5042002) // → null
isPermit2RouterAvailable(5042002) // → false

// On — env set in .env.local:
//   NEXT_PUBLIC_PERMIT2_ROUTER_ADDRESS_5042002=0xRouterAddress…
resolvePermit2Router(5042002) // → "0xRouterAddress…"
isPermit2RouterAvailable(5042002) // → true
```

The hook surfaces both `signPermit*` methods that return `null` when the
router is unavailable, and an `isAvailable(chainId)` predicate for UI
gating. **Critically**, the hook does not throw or warn when the flag is
off — it's a normal, expected branch, so call sites can transparently
fall through to the legacy approve flow.

Supported chains today:

| Chain                  | chainId    | Env var                                            |
| ---------------------- | ---------- | -------------------------------------------------- |
| Arc testnet            | `5042002`  | `NEXT_PUBLIC_PERMIT2_ROUTER_ADDRESS_5042002`       |
| Avalanche Fuji         | `43113`    | `NEXT_PUBLIC_PERMIT2_ROUTER_ADDRESS_43113`         |

Adding a chain: append to `KNOWN_CHAIN_ENVS` in `router.ts` — Next's
build-time inliner picks up the new key automatically.

## Composition with `useSimulatedWrite` (PR #44) + `useOptimisticPlaceOrder` (PR #49)

The hooks here are deliberately submission-agnostic. The intended
call-site shape, post fx-telarana#26 merge:

```tsx
"use client";

import { useAccount, useChainId, usePublicClient } from "wagmi";
import {
  usePermit2Signature,
  resolvePermit2Router,
  nextPermit2Nonce,
  ALLOWANCE_EXPIRATION_DEFAULTS,
} from "@/lib/permit2";
// Imports below assume PR #44 / PR #49 have landed.
import { useSimulatedWrite } from "@/lib/web3/use-simulated-write";
import { useOptimisticPlaceOrder } from "@/lib/perps/use-optimistic-place-order";

// Router ABI fragment lives in @bufi/fx-telarana once #26 lands.
import { FxPermit2RouterAbi } from "@bufi/fx-telarana/abi";

export function useDepositWithPermit2() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const permit2 = usePermit2Signature();
  const write = useSimulatedWrite();
  const optimistic = useOptimisticPlaceOrder();

  return async (params: { token: `0x${string}`; amount: bigint; marketParams: unknown }) => {
    const router = resolvePermit2Router(chainId);
    if (!router || !address || !publicClient) {
      // Feature flag OFF — caller renders the legacy approve+supply flow.
      return { ok: false as const, reason: "permit2-unavailable" };
    }

    const now = Math.floor(Date.now() / 1000);
    const nonce = await nextPermit2Nonce(publicClient, { owner: address });

    const signed = await permit2.signPermitTransferFrom({
      chainId,
      token: params.token,
      amount: params.amount,
      nonce,
      deadline: BigInt(now + ALLOWANCE_EXPIRATION_DEFAULTS.sigDeadlineSec),
    });
    if (!signed) return { ok: false as const, reason: "user-cancelled-or-flagged-off" };

    // Optimistic UI flips immediately — write.submit pumps the actual tx.
    optimistic.markPending({ amount: params.amount });

    await write.submit({
      address: signed.spender, // router
      abi: FxPermit2RouterAbi,
      functionName: "supplyWithPermit2",
      args: [params.marketParams, signed.permit, signed.signature],
    });

    return { ok: true as const };
  };
}
```

This wiring is **deliberately not included in this PR** — call-site
integration is gated on the contract router shipping (`fx-telarana#26`).
The sketch above is the contract this scaffolding promises to honour.

## AllowanceTransfer vs SignatureTransfer — which to use?

Permit2 has two distinct signing flows; we model both.

- **`PermitSingle` (AllowanceTransfer)** — long-lived. The user grants
  the router a permitted pull amount + expiration; the router can pull
  up to that amount repeatedly until expiry. Right shape for "approve
  once, trade many times" UX, but increases standing-allowance surface
  area.
- **`PermitTransferFrom` (SignatureTransfer)** — single-use. Each
  signature authorises exactly one transfer against a fresh bitmap
  nonce. Right shape for "one-sig per deposit" with a tight per-deposit
  audit trail.

For the perps-deposit router we expect SignatureTransfer to win on
auditability (each deposit is its own signed authorisation). The hook
exposes both so the integrating PR can pick the right one without
needing to refactor this module.

## Nonce model — bitmap, not counter

SignatureTransfer uses a per-owner `nonceBitmap(owner, wordPos)`
mapping. Each 256-bit word holds 256 single-use nonce bits. The encoded
nonce is `(wordPos << 8) | bitPos`. `nextPermit2Nonce()` scans the
bitmap from `wordPos=0`, finds the lowest unset bit, and returns the
encoded nonce. Stateless — no localStorage, all state lives on-chain.

AllowanceTransfer uses a strictly-monotonic per-(owner, token, spender)
counter — much simpler. We don't ship a reader for that here; the
allowance triple is available via Permit2's `allowance()` view, which
call sites can read directly when they need the next allowance nonce.

## Acceptance status

- `bun run --filter ./apps/web typecheck` clean
- `bun test apps/web/lib/permit2/` — typed-data, nonce, router suites all pass
- `usePermit2Signature.isAvailable(chainId)` returns `false` in dev (env unset)
- Self-consistency: viem `hashTypedData` digest === hand-walked EIP-712 digest
  for both `PermitSingle` and `PermitTransferFrom`
