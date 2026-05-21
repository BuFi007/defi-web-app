/**
 * ZeroDev call + timestamp policy builders for the perp trading flow.
 *
 * The policy surface area is intentionally tight:
 *   - FxOrderSettlement.settleMatch   — fill maker+taker
 *   - FxOrderSettlement.cancelOrder   — pull an open intent
 *   - FxMarginAccount.depositMargin   — pre-fund the kernel for trading
 *   - FxMarginAccount.withdrawMargin  — pull funds back out
 *
 * `settleMatch` is the only one the trader's session key has to call
 * directly today — the matcher submits it on Arc Testnet — but we
 * include it so future direct-fill UX (e.g. self-match for the user's
 * own RFQ) is not gated by a permissions hop. Margin moves are included
 * because they're the second-most-frequent popup; deposit/withdraw via
 * session key is a clear UX win once the kernel-as-trader caveat
 * (see session-keys-README.md) is accepted.
 *
 * The contract surface is verified at
 * `/Users/criptopoeta/coding-dojo/fx-telarana/contracts/src/perp/FxOrderSettlement.sol:120-127`:
 *   `SignatureChecker.isValidSignatureNow(order.trader, hash, sig)`
 * That OZ helper falls through to `IERC1271(signer).isValidSignature(...)`
 * when the trader is a contract, so a ZeroDev kernel signing via its
 * permission validator returns true for `order.trader = kernelAddress`
 * + a session-key-signed digest. No contract change required.
 */

import {
  FxMarginAccountAbi,
  FxOrderSettlementAbi,
  Perps,
} from "@bufi/contracts";
import {
  toCallPolicy,
  toTimestampPolicy,
  CallPolicyVersion,
} from "@zerodev/permissions/policies";
import type { Address } from "viem";

export const DEFAULT_SESSION_KEY_TTL_SECONDS = 60 * 60; // 1 hour

export interface SessionKeyPolicyOptions {
  chainId: number;
  /** Unix seconds; defaults to now. */
  validAfter?: number;
  /** Unix seconds; defaults to `validAfter + DEFAULT_SESSION_KEY_TTL_SECONDS`. */
  validUntil?: number;
}

export interface ResolvedSessionKeyPolicy {
  chainId: number;
  validAfter: number;
  validUntil: number;
  orderSettlement: Address;
  marginAccount: Address;
  /** Result of `toCallPolicy(...)` — ready to pass to `toPermissionValidator`. */
  callPolicy: ReturnType<typeof toCallPolicy>;
  /** Result of `toTimestampPolicy(...)` — same. */
  timestampPolicy: ReturnType<typeof toTimestampPolicy>;
}

/**
 * Build the policy bundle for a session key. Throws if the chain has no
 * registered FxOrderSettlement / FxMarginAccount deployment so callers
 * don't silently create a kernel that can't trade.
 */
export function buildPerpSessionKeyPolicies(
  opts: SessionKeyPolicyOptions,
): ResolvedSessionKeyPolicy {
  const orderSettlement = Perps.getPerpsContractAddress(opts.chainId, "FxOrderSettlement");
  const marginAccount = Perps.getPerpsContractAddress(opts.chainId, "FxMarginAccount");
  if (!orderSettlement || !marginAccount) {
    throw new Error(
      `session-key-policies: no perps deployment for chainId=${opts.chainId}; ` +
        `cannot build a call policy without FxOrderSettlement + FxMarginAccount addresses`,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const validAfter = opts.validAfter ?? now;
  const validUntil = opts.validUntil ?? validAfter + DEFAULT_SESSION_KEY_TTL_SECONDS;

  if (validUntil <= validAfter) {
    throw new Error(
      `session-key-policies: validUntil (${validUntil}) must be > validAfter (${validAfter})`,
    );
  }

  const callPolicy = toCallPolicy({
    policyVersion: CallPolicyVersion.V0_0_4,
    permissions: [
      {
        target: orderSettlement,
        valueLimit: 0n,
        abi: FxOrderSettlementAbi,
        functionName: "settleMatch",
      },
      {
        target: orderSettlement,
        valueLimit: 0n,
        abi: FxOrderSettlementAbi,
        functionName: "cancelOrder",
      },
      {
        target: marginAccount,
        valueLimit: 0n,
        abi: FxMarginAccountAbi,
        functionName: "depositMargin",
      },
      {
        target: marginAccount,
        valueLimit: 0n,
        abi: FxMarginAccountAbi,
        functionName: "withdrawMargin",
      },
    ],
  });

  const timestampPolicy = toTimestampPolicy({
    validAfter,
    validUntil,
  });

  return {
    chainId: opts.chainId,
    validAfter,
    validUntil,
    orderSettlement,
    marginAccount,
    callPolicy,
    timestampPolicy,
  };
}
