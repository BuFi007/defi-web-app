import { describe, expect, test } from "bun:test";

import { parseFiniteDecimal } from "./numeric";

describe("parseFiniteDecimal", () => {
  test("rejects empty / whitespace", () => {
    expect(parseFiniteDecimal("", 6)).toBeNull();
    expect(parseFiniteDecimal("   ", 6)).toBeNull();
  });

  test("rejects 'Infinity'", () => {
    expect(parseFiniteDecimal("Infinity", 6)).toBeNull();
    expect(parseFiniteDecimal("-Infinity", 6)).toBeNull();
  });

  test("rejects scientific notation '1e308'", () => {
    // Without our shape check this would parse to 1e308 and silently
    // saturate to Infinity at multiply time. Now rejected at the input.
    expect(parseFiniteDecimal("1e308", 6)).toBeNull();
  });

  test("rejects negatives like '-1'", () => {
    expect(parseFiniteDecimal("-1", 6)).toBeNull();
    expect(parseFiniteDecimal("-0.5", 6)).toBeNull();
  });

  test("rejects more than maxDecimals digits past the point", () => {
    // 15 decimals at maxDecimals=6 — must reject (silent truncation hides
    // user dust and would mismatch onchain rounding).
    expect(parseFiniteDecimal("1.123456789012345", 6)).toBeNull();
    expect(parseFiniteDecimal("1.1234567", 6)).toBeNull();
  });

  test("accepts well-formed decimals within precision", () => {
    expect(parseFiniteDecimal("0", 6)).toBe(0);
    expect(parseFiniteDecimal("1", 6)).toBe(1);
    expect(parseFiniteDecimal("1.5", 6)).toBe(1.5);
    expect(parseFiniteDecimal("1.123456", 6)).toBe(1.123456);
    expect(parseFiniteDecimal("0.000001", 6)).toBe(0.000001);
    expect(parseFiniteDecimal(".5", 6)).toBe(0.5);
  });

  test("rejects garbage / mixed strings", () => {
    expect(parseFiniteDecimal("12abc", 6)).toBeNull();
    expect(parseFiniteDecimal("NaN", 6)).toBeNull();
    expect(parseFiniteDecimal("0x10", 6)).toBeNull();
    expect(parseFiniteDecimal("+1", 6)).toBeNull();
    expect(parseFiniteDecimal("1,000", 6)).toBeNull();
  });

  test("rejects values that overflow Number after shape check", () => {
    // Long integer that JS coerces to Infinity. Caught by the
    // Number.isFinite guard.
    const huge = "1" + "0".repeat(400);
    expect(parseFiniteDecimal(huge, 6)).toBeNull();
  });
});
