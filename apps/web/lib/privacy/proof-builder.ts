/**
 * Main-thread helpers for assembling a `ProofGenInput` from on-chain data.
 *
 * The Web Worker doesn't reach the RPC directly — callers (React hooks,
 * server actions, etc.) gather the commitment / nullifier / Merkle path
 * here, then ship the result through the comlink boundary. Keeping the
 * builders here means the worker bundle stays tiny.
 *
 * This file is deliberately viem-friendly (the rest of apps/web is on
 * viem 2.x) and avoids any reference to wagmi or React — so server-side
 * code (e.g. previews) can call it too.
 */

import {
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import type {
  FieldHex,
  MerklePath,
  ProofGenInput,
  WithdrawContext,
  WithdrawWitness,
} from "./types";

/**
 * Encode the withdrawal context the same way
 * `FxPrivacyEntrypoint._encodeContext` does on the slice-3 branch. The
 * circuit constrains the proof against `keccak256(this)`, so the
 * encoding MUST be byte-identical to the contract version.
 *
 * Layout:
 *   abi.encode(
 *     address buyToken,
 *     uint256 minBuyAmount,
 *     address recipient,
 *     uint256 chainId,
 *     bytes   swapData
 *   )
 */
export function encodeWithdrawContext(ctx: WithdrawContext): Hex {
  return encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "address" },
      { type: "uint256" },
      { type: "bytes" },
    ],
    [
      ctx.buyToken,
      ctx.minBuyAmount,
      ctx.recipient,
      BigInt(ctx.chainId),
      ctx.swapData ?? "0x",
    ],
  );
}

/**
 * keccak256 of the encoded context — this is the value the prover binds
 * into the proof's public signals (see `withdraw.circom` → `context`).
 */
export function hashWithdrawContext(ctx: WithdrawContext): FieldHex {
  return keccak256(encodeWithdrawContext(ctx)) as FieldHex;
}

/**
 * Sanity-check a Merkle path before handing it to the worker. The worker
 * will fail loudly on mismatch — but main-thread validation gives the
 * UI a chance to show a helpful "stale state, please refresh" message
 * before paying the 2-8s proof cost.
 */
export function validateMerklePath(path: MerklePath, expectedDepth: number) {
  if (path.siblings.length !== expectedDepth) {
    throw new Error(
      `Merkle path siblings length ${path.siblings.length} ≠ circuit depth ${expectedDepth}`,
    );
  }
  if (path.indices.length !== expectedDepth) {
    throw new Error(
      `Merkle path indices length ${path.indices.length} ≠ circuit depth ${expectedDepth}`,
    );
  }
  for (const idx of path.indices) {
    if (idx !== 0 && idx !== 1) {
      throw new Error(`Merkle path index ${idx} must be 0 or 1`);
    }
  }
}

/**
 * Convenience constructor — pairs witness + context into the worker
 * payload. Doesn't validate; call `validateMerklePath` first if the
 * Merkle path came from a third-party indexer.
 */
export function buildProofGenInput(args: {
  commitment: FieldHex;
  nullifier: FieldHex;
  merklePath: MerklePath;
  value: bigint;
  buyToken: Address;
  minBuyAmount: bigint;
  recipient: Address;
  chainId: number;
  swapData?: Hex;
}): ProofGenInput {
  const witness: WithdrawWitness = {
    commitment: args.commitment,
    nullifier: args.nullifier,
    merklePath: args.merklePath,
    value: args.value,
  };
  const context: WithdrawContext = {
    buyToken: args.buyToken,
    minBuyAmount: args.minBuyAmount,
    recipient: args.recipient,
    chainId: args.chainId,
    swapData: args.swapData,
  };
  return { witness, context };
}
