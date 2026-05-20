/// <reference types="bun-types" />
/**
 * Unit tests for the Permit2 nonce-bitmap walker.
 *
 * The bitmap-decoding logic is pure (no network), so we test it directly
 * with synthetic word values. `nextPermit2Nonce()` is tested with a
 * minimal mock PublicClient that returns scripted bitmap reads.
 *
 * Run with: bun test apps/web/lib/permit2/next-nonce.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  decodeNonceFromBitmap,
  lowestUnsetBit,
  nextPermit2Nonce,
  Permit2NonceExhaustedError,
} from "./next-nonce";

describe("lowestUnsetBit", () => {
  test("returns 0 for an empty bitmap (no nonces used)", () => {
    expect(lowestUnsetBit(0n)).toBe(0);
  });

  test("returns 1 when only bit 0 is consumed", () => {
    expect(lowestUnsetBit(0b1n)).toBe(1);
  });

  test("returns 2 when bits 0+1 are consumed", () => {
    expect(lowestUnsetBit(0b11n)).toBe(2);
  });

  test("skips gaps — returns 0 when bit 1 is set but bit 0 isn't", () => {
    // bitmap = 0b10 — bit 1 set, bit 0 free.
    expect(lowestUnsetBit(0b10n)).toBe(0);
  });

  test("finds the gap in 0b1101 → bit 1 free", () => {
    expect(lowestUnsetBit(0b1101n)).toBe(1);
  });

  test("returns 255 when only the top bit is free", () => {
    const allButTop = (1n << 256n) - 1n - (1n << 255n);
    expect(lowestUnsetBit(allButTop)).toBe(255);
  });

  test("returns -1 when every bit is set (word fully consumed)", () => {
    const full = (1n << 256n) - 1n;
    expect(lowestUnsetBit(full)).toBe(-1);
  });
});

describe("decodeNonceFromBitmap", () => {
  test("encodes wordPos=0, bit=0 → nonce=0", () => {
    expect(decodeNonceFromBitmap({ wordPos: 0n, bitmap: 0n })).toBe(0n);
  });

  test("encodes wordPos=1, bit=0 → nonce=256", () => {
    expect(decodeNonceFromBitmap({ wordPos: 1n, bitmap: 0n })).toBe(256n);
  });

  test("encodes wordPos=3, bit=5 (bits 0-4 consumed) → nonce=773", () => {
    // 3 << 8 == 768; 768 + 5 = 773.
    expect(
      decodeNonceFromBitmap({ wordPos: 3n, bitmap: 0b11111n }),
    ).toBe(773n);
  });

  test("returns null when the word is fully consumed", () => {
    const full = (1n << 256n) - 1n;
    expect(decodeNonceFromBitmap({ wordPos: 0n, bitmap: full })).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// nextPermit2Nonce — exercised via a mock PublicClient.readContract.
// ---------------------------------------------------------------------------

interface MockReadContract {
  bitmaps: Map<bigint, bigint>; // wordPos → bitmap
  callCount: number;
}

function makeMockClient(scripted: Record<string, bigint>) {
  const bitmaps = new Map<bigint, bigint>();
  for (const [k, v] of Object.entries(scripted)) {
    bitmaps.set(BigInt(k), v);
  }
  const state: MockReadContract = { bitmaps, callCount: 0 };

  // Cast to any — we only implement readContract, which is all
  // nextPermit2Nonce uses.
  const client = {
    readContract: async (args: { args: [unknown, bigint] }) => {
      state.callCount += 1;
      const wordPos = args.args[1];
      return state.bitmaps.get(wordPos) ?? 0n;
    },
  } as unknown as Parameters<typeof nextPermit2Nonce>[0];

  return { client, state };
}

describe("nextPermit2Nonce", () => {
  const OWNER = "0x1234567890123456789012345678901234567890" as const;

  test("returns 0 when the bitmap is empty", async () => {
    const { client, state } = makeMockClient({});
    const nonce = await nextPermit2Nonce(client, { owner: OWNER });
    expect(nonce).toBe(0n);
    expect(state.callCount).toBe(1);
  });

  test("returns the first free bit in word 0", async () => {
    // bits 0-6 consumed; bit 7 free
    const { client } = makeMockClient({ "0": 0b1111111n });
    const nonce = await nextPermit2Nonce(client, { owner: OWNER });
    expect(nonce).toBe(7n);
  });

  test("advances to word 1 when word 0 is fully consumed", async () => {
    const full = (1n << 256n) - 1n;
    const { client, state } = makeMockClient({ "0": full });
    const nonce = await nextPermit2Nonce(client, { owner: OWNER });
    // word 0 full → fall through to word 1, which is empty → bit 0.
    // Encoded: (1 << 8) | 0 = 256.
    expect(nonce).toBe(256n);
    expect(state.callCount).toBe(2);
  });

  test("respects a custom wordPos start", async () => {
    const { client } = makeMockClient({ "5": 0b11n });
    const nonce = await nextPermit2Nonce(client, {
      owner: OWNER,
      wordPos: 5n,
    });
    // wordPos=5, bit=2: (5 << 8) | 2 = 1282.
    expect(nonce).toBe(1282n);
  });

  test("throws Permit2NonceExhaustedError when maxWordsToScan is exhausted", async () => {
    const full = (1n << 256n) - 1n;
    const { client } = makeMockClient({
      "0": full,
      "1": full,
      "2": full,
    });
    await expect(
      nextPermit2Nonce(client, { owner: OWNER, maxWordsToScan: 3 }),
    ).rejects.toBeInstanceOf(Permit2NonceExhaustedError);
  });
});
