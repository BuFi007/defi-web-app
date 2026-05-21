/**
 * HMAC-SHA256 signing + verification for the webhook delivery surface.
 *
 * Signature input is the concatenation `${timestamp}.${nonce}.${body}` so a
 * replay can be detected on the receiver side even if the body alone matches
 * a previously-delivered event. Receivers compare in constant time, reject
 * stale timestamps, and dedup on `nonce`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface SignArgs {
  body: string;
  nonce: string;
  timestamp: number;
  secret: string;
}

export interface VerifyArgs extends SignArgs {
  signature: string;
  /** Allowed clock skew window. Default 300 seconds (5 min). */
  toleranceSeconds?: number;
  /** Inject for tests; defaults to Date.now()/1000. */
  nowSeconds?: number;
}

export type VerifyResult = { valid: true } | { valid: false; reason: string };

/**
 * Sign the canonical message `${timestamp}.${nonce}.${body}` with
 * HMAC-SHA256(secret) and return a lowercase hex digest.
 */
export function signWebhook(args: SignArgs): string {
  const canonical = canonicalMessage(args.timestamp, args.nonce, args.body);
  return createHmac("sha256", args.secret).update(canonical).digest("hex");
}

/**
 * Verify a presented signature against the expected HMAC. Returns a
 * structured `{ valid, reason? }` so callers can surface a useful 4xx body
 * without leaking the expected digest.
 *
 * Checks (in order):
 *  1. timestamp is a finite integer
 *  2. timestamp is within `toleranceSeconds` of now
 *  3. signature is a hex string the right length (64 chars for sha256)
 *  4. constant-time compare against `signWebhook(...)` output
 */
export function verifyWebhook(args: VerifyArgs): VerifyResult {
  const tolerance = args.toleranceSeconds ?? 300;
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!Number.isFinite(args.timestamp) || !Number.isInteger(args.timestamp)) {
    return { valid: false, reason: "invalid_timestamp" };
  }
  const skew = Math.abs(now - args.timestamp);
  if (skew > tolerance) {
    return { valid: false, reason: "timestamp_outside_tolerance" };
  }

  if (typeof args.signature !== "string" || args.signature.length !== 64) {
    return { valid: false, reason: "signature_malformed" };
  }
  if (!/^[0-9a-f]{64}$/.test(args.signature)) {
    return { valid: false, reason: "signature_malformed" };
  }

  const expected = signWebhook(args);
  // timingSafeEqual requires equal-length buffers; we just verified .length=64
  // and that .signature is hex so this is always safe.
  const a = Buffer.from(args.signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) {
    return { valid: false, reason: "signature_length_mismatch" };
  }
  if (!timingSafeEqual(a, b)) {
    return { valid: false, reason: "signature_mismatch" };
  }
  return { valid: true };
}

/**
 * Generate a fresh HMAC secret. Uses 32 random bytes -> 64 hex chars.
 * Exposed so route handlers (create + rotate) share the same source.
 */
export function generateWebhookSecret(): string {
  // Lazy-load to keep this module fast to import in tests that only call sign/verify.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return randomBytes(32).toString("hex");
}

/**
 * Hash a secret for at-rest storage. We use HMAC-SHA256 keyed by a
 * deployment-wide pepper (env: `BUFI_WEBHOOK_PEPPER`) so a DB leak alone
 * isn't enough to forge signatures. Falls back to plain SHA256 if no pepper
 * is set (still preferable to storing the raw secret).
 */
export function hashSecret(secret: string, pepper?: string): string {
  const effectivePepper = pepper ?? process.env.BUFI_WEBHOOK_PEPPER ?? "";
  if (effectivePepper) {
    return createHmac("sha256", effectivePepper).update(secret).digest("hex");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(secret).digest("hex");
}

function canonicalMessage(
  timestamp: number,
  nonce: string,
  body: string,
): string {
  return `${timestamp}.${nonce}.${body}`;
}
