/**
 * Read the next fresh Permit2 SignatureTransfer nonce.
 *
 * Permit2 stores consumed SignatureTransfer nonces as a per-owner bitmap:
 *
 *   mapping(address owner => mapping(uint256 wordPos => uint256 bitmap)) public nonceBitmap;
 *
 * To find the next unused nonce we read `nonceBitmap(owner, wordPos)` and
 * scan for the lowest unset bit. The on-chain nonce is then:
 *
 *   nonce = (wordPos << 8) | bitPos
 *
 * Reference: https://github.com/Uniswap/permit2/blob/main/src/SignatureTransfer.sol
 *
 * This is stateless — the bitmap lives on-chain, so no localStorage cache
 * needed. Callers should re-read just before signing to dodge races with
 * concurrent permits from the same EOA.
 */

import type { Address, PublicClient } from "viem";

import { PERMIT2_ADDRESS } from "./constants";

/**
 * Minimal ABI fragment for the bitmap getter. Hand-written instead of
 * importing a full Permit2 ABI — keeps the surface small and side-steps
 * any version drift in published artifacts.
 */
export const PERMIT2_NONCE_BITMAP_ABI = [
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "wordPos", type: "uint256" },
    ],
    name: "nonceBitmap",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Locate the lowest unset bit (LSB-first) in a 256-bit word.
 *
 * Returns -1 if the word is fully consumed (all bits set). Callers should
 * advance `wordPos` and retry in that case — see `nextPermit2Nonce`.
 *
 * Implementation: cheap O(256) bit scan. The bitmap is at most ~256 bits
 * so micro-optimising with a de Bruijn lookup is not worth the complexity.
 */
export function lowestUnsetBit(word: bigint): number {
  if (word === 0n) return 0;
  for (let bit = 0; bit < 256; bit += 1) {
    if (((word >> BigInt(bit)) & 1n) === 0n) return bit;
  }
  return -1;
}

export interface NextPermit2NonceArgs {
  /** EOA whose bitmap to scan. */
  owner: Address;
  /**
   * Starting word position. Defaults to 0 — the first 256 nonces. Callers
   * rarely need to change this; primarily a hook for tests + advanced
   * batching schemes that intentionally partition nonce space.
   */
  wordPos?: bigint;
  /**
   * Safety cap. We won't scan more than `maxWordsToScan` words before
   * giving up. 16 words = 4096 nonces is way past any realistic single-EOA
   * usage. Tunable for tests.
   */
  maxWordsToScan?: number;
}

/**
 * Read `owner`'s nonceBitmap and return the next fresh nonce as the
 * encoded uint256: `(wordPos << 8) | bitPos`.
 *
 * Throws `Permit2NonceExhaustedError` if `maxWordsToScan` words are all
 * full — which would mean ~4k consecutive permits with no in-protocol
 * cleanup, i.e. something is very wrong.
 */
export async function nextPermit2Nonce(
  publicClient: PublicClient,
  args: NextPermit2NonceArgs,
): Promise<bigint> {
  const startWord = args.wordPos ?? 0n;
  const maxWords = args.maxWordsToScan ?? 16;

  for (let i = 0; i < maxWords; i += 1) {
    const wordPos = startWord + BigInt(i);
    const word = (await publicClient.readContract({
      address: PERMIT2_ADDRESS,
      abi: PERMIT2_NONCE_BITMAP_ABI,
      functionName: "nonceBitmap",
      args: [args.owner, wordPos],
    })) as bigint;
    const bit = lowestUnsetBit(word);
    if (bit !== -1) {
      return (wordPos << 8n) | BigInt(bit);
    }
  }

  throw new Permit2NonceExhaustedError(
    `No free Permit2 nonce found in ${maxWords} words starting at wordPos=${startWord}`,
  );
}

export class Permit2NonceExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Permit2NonceExhaustedError";
  }
}

/**
 * Pure helper — exposed for tests + callers that have already fetched
 * the bitmap themselves (e.g. via multicall) and just want to decode it.
 */
export function decodeNonceFromBitmap(args: {
  wordPos: bigint;
  bitmap: bigint;
}): bigint | null {
  const bit = lowestUnsetBit(args.bitmap);
  if (bit === -1) return null;
  return (args.wordPos << 8n) | BigInt(bit);
}
