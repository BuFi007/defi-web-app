import { describe, expect, test } from "bun:test";

import {
  generateWebhookSecret,
  hashSecret,
  signWebhook,
  verifyWebhook,
} from "../src/hmac";

describe("hmac sign + verify", () => {
  test("sign produces deterministic hex digests", () => {
    const args = {
      body: '{"hello":"world"}',
      nonce: "fill-0xabc-0xdef-0",
      timestamp: 1_700_000_000,
      secret: "s3cret",
    };
    const a = signWebhook(args);
    const b = signWebhook(args);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("verify accepts a fresh signature inside the tolerance window", () => {
    const secret = generateWebhookSecret();
    const body = '{"type":"fill"}';
    const nonce = "fill-0x1-0x2-0";
    const timestamp = 1_700_000_000;
    const signature = signWebhook({ body, nonce, timestamp, secret });

    const result = verifyWebhook({
      body,
      nonce,
      timestamp,
      secret,
      signature,
      nowSeconds: timestamp + 30,
    });
    expect(result.valid).toBe(true);
  });

  test("verify rejects tampered body", () => {
    const secret = "abc";
    const body = '{"original":true}';
    const sig = signWebhook({ body, nonce: "n", timestamp: 1, secret });

    const result = verifyWebhook({
      body: '{"original":false}',
      nonce: "n",
      timestamp: 1,
      secret,
      signature: sig,
      nowSeconds: 1,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("signature_mismatch");
  });

  test("verify rejects stale timestamps", () => {
    const secret = "abc";
    const args = { body: "{}", nonce: "n", timestamp: 1_000, secret };
    const sig = signWebhook(args);

    const result = verifyWebhook({
      ...args,
      signature: sig,
      nowSeconds: 1_000 + 301,
      toleranceSeconds: 300,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("timestamp_outside_tolerance");
  });

  test("verify rejects malformed signatures", () => {
    const result = verifyWebhook({
      body: "{}",
      nonce: "n",
      timestamp: 1,
      secret: "s",
      signature: "not-hex",
      nowSeconds: 1,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("signature_malformed");
  });

  test("verify rejects nonce tampering even with a valid-looking signature", () => {
    const secret = "abc";
    const sig = signWebhook({
      body: "{}",
      nonce: "real-nonce",
      timestamp: 1,
      secret,
    });
    const result = verifyWebhook({
      body: "{}",
      nonce: "attacker-nonce",
      timestamp: 1,
      secret,
      signature: sig,
      nowSeconds: 1,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("signature_mismatch");
  });

  test("generateWebhookSecret produces 64-char hex", () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(secret).not.toBe(generateWebhookSecret());
  });

  test("hashSecret with pepper differs from plain hash", () => {
    const secret = "abc";
    const plain = hashSecret(secret, "");
    const peppered = hashSecret(secret, "deployment-pepper");
    expect(plain).not.toBe(peppered);
    // Same inputs -> same hash
    expect(hashSecret(secret, "deployment-pepper")).toBe(peppered);
  });
});
