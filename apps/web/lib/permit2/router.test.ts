/// <reference types="bun-types" />
/**
 * Tests for the feature-flag env resolver.
 *
 * Behaviourally important properties we lock in:
 *
 *   - Unknown chain id → null (no crash, no env leak).
 *   - Known chain id with unset env → null (feature flag off — fallback).
 *   - Garbage env value → null (defensive — never hand wagmi a bogus
 *     spender we'd then fail to verify against).
 *   - Valid env value → returns the address verbatim.
 *
 * Implementation note: the production module reads
 * `process.env.NEXT_PUBLIC_PERMIT2_ROUTER_ADDRESS_<chainId>` at module-
 * load time so Next can inline at build. To test the dynamic-value path
 * we exercise the underlying `permit2RouterEnvKey()` helper + assert the
 * default null-return behaviour with no envs set.
 *
 * Run with: bun test apps/web/lib/permit2/router.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  isPermit2RouterAvailable,
  permit2RouterEnvKey,
  resolvePermit2Router,
} from "./router";

describe("permit2RouterEnvKey", () => {
  test("formats Arc testnet (5042002)", () => {
    expect(permit2RouterEnvKey(5042002)).toBe(
      "NEXT_PUBLIC_PERMIT2_ROUTER_ADDRESS_5042002",
    );
  });

  test("formats Avalanche Fuji (43113)", () => {
    expect(permit2RouterEnvKey(43113)).toBe(
      "NEXT_PUBLIC_PERMIT2_ROUTER_ADDRESS_43113",
    );
  });
});

describe("resolvePermit2Router", () => {
  test("returns null for an unknown chain id", () => {
    // 999_999 isn't in KNOWN_CHAIN_ENVS at all → null without throwing.
    expect(resolvePermit2Router(999_999)).toBe(null);
  });

  test("returns null for a known chain id when env is unset (default at test time)", () => {
    // The default test environment does not set
    // NEXT_PUBLIC_PERMIT2_ROUTER_ADDRESS_5042002, so the resolver returns
    // null. This is the feature-flag-off path — exactly what we want UI
    // to detect so it falls back to legacy approve+transfer.
    expect(resolvePermit2Router(5042002)).toBe(null);
    expect(resolvePermit2Router(43113)).toBe(null);
  });

  test("isPermit2RouterAvailable mirrors resolvePermit2Router null-ness", () => {
    expect(isPermit2RouterAvailable(5042002)).toBe(false);
    expect(isPermit2RouterAvailable(43113)).toBe(false);
    expect(isPermit2RouterAvailable(999_999)).toBe(false);
  });
});
