/**
 * Hand-rolled Permit2 EIP-712 typed-data builders.
 *
 * Mirrors the output of `@uniswap/permit2-sdk` (specifically
 * `SignatureTransfer.getPermitData()` and `AllowanceTransfer.getPermitData()`)
 * without adding the SDK as a dependency. The Permit2 typed-data shape is
 * trivially small and stable — pulling in the SDK would add a transitive
 * `ethers v5` dep we already have to keep in sync.
 *
 * Verified against:
 *   - https://github.com/Uniswap/permit2/blob/main/src/EIP712.sol
 *   - https://github.com/Uniswap/permit2/blob/main/src/libraries/PermitHash.sol
 *   - https://docs.uniswap.org/contracts/permit2/reference/allowance-transfer
 *   - https://docs.uniswap.org/contracts/permit2/reference/signature-transfer
 *
 * Both flavours share the same EIP-712 domain — Permit2 deliberately omits
 * the `version` field so callers must NOT include it (some EIP-712 libs add
 * it by default; we hand-build the domain to avoid that footgun).
 */

import type { TypedDataDomain } from "viem";

import { PERMIT2_ADDRESS, PERMIT2_DOMAIN_NAME } from "./constants";
import {
  PERMIT_DETAILS_TYPE,
  PERMIT_SINGLE_TYPE,
  PERMIT_TRANSFER_FROM_TYPE,
  TOKEN_PERMISSIONS_TYPE,
  type PermitSingleArgs,
  type PermitSingleMessage,
  type PermitTransferFromArgs,
  type PermitTransferFromMessage,
} from "./types";

/**
 * Build the EIP-712 domain Permit2 expects. Note the deliberate absence of
 * `version` — Permit2's `DOMAIN_SEPARATOR()` hashes only
 * `keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)")`.
 */
export function buildPermit2Domain(chainId: number): TypedDataDomain {
  return {
    name: PERMIT2_DOMAIN_NAME,
    chainId,
    verifyingContract: PERMIT2_ADDRESS,
  };
}

// ---------------------------------------------------------------------------
// AllowanceTransfer — PermitSingle
// ---------------------------------------------------------------------------

export interface PermitSingleTypedData {
  domain: TypedDataDomain;
  types: {
    PermitDetails: typeof PERMIT_DETAILS_TYPE;
    PermitSingle: typeof PERMIT_SINGLE_TYPE;
  };
  primaryType: "PermitSingle";
  message: PermitSingleMessage;
}

/**
 * Build the typed-data envelope for a long-lived allowance signature.
 * Caller supplies `spender` directly (typically resolved from
 * `resolvePermit2Router(chainId)`).
 */
export function buildPermitSingleTypedData(
  args: PermitSingleArgs & { spender: `0x${string}` },
): PermitSingleTypedData {
  return {
    domain: buildPermit2Domain(args.chainId),
    types: {
      PermitDetails: PERMIT_DETAILS_TYPE,
      PermitSingle: PERMIT_SINGLE_TYPE,
    },
    primaryType: "PermitSingle",
    message: {
      details: {
        token: args.token,
        amount: args.amount,
        expiration: args.expiration,
        nonce: args.nonce,
      },
      spender: args.spender,
      sigDeadline: args.sigDeadline,
    },
  };
}

// ---------------------------------------------------------------------------
// SignatureTransfer — PermitTransferFrom
// ---------------------------------------------------------------------------

export interface PermitTransferFromTypedData {
  domain: TypedDataDomain;
  types: {
    TokenPermissions: typeof TOKEN_PERMISSIONS_TYPE;
    PermitTransferFrom: typeof PERMIT_TRANSFER_FROM_TYPE;
  };
  primaryType: "PermitTransferFrom";
  message: PermitTransferFromMessage;
}

/**
 * Build the typed-data envelope for a single-use SignatureTransfer.
 * Each signature authorises exactly ONE `permitTransferFrom()` call.
 */
export function buildPermitTransferFromTypedData(
  args: PermitTransferFromArgs & { spender: `0x${string}` },
): PermitTransferFromTypedData {
  return {
    domain: buildPermit2Domain(args.chainId),
    types: {
      TokenPermissions: TOKEN_PERMISSIONS_TYPE,
      PermitTransferFrom: PERMIT_TRANSFER_FROM_TYPE,
    },
    primaryType: "PermitTransferFrom",
    message: {
      permitted: {
        token: args.token,
        amount: args.amount,
      },
      spender: args.spender,
      nonce: args.nonce,
      deadline: args.deadline,
    },
  };
}
