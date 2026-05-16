import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { paymentRequired } from "./middleware";
import { createInMemoryReceiptStore } from "./receipts";
import { mockVerifier } from "./verify";

describe("x402 paymentRequired middleware", () => {
  const app = new Hono();
  const receipts = createInMemoryReceiptStore();
  app.use(
    "/paid",
    paymentRequired({
      toolName: "perps.quote.premium",
      priceUsdc: "0.0050",
      sellerAddress: "0x000000000000000000000000000000000000dEaD",
      verifier: mockVerifier,
      receipts,
    }),
  );
  app.get("/paid", (c) => c.json({ ok: true, receipt: c.get("x402").receipt.receiptId }));

  test("returns 402 with envelope when no header is sent", async () => {
    const res = await app.request("/paid");
    expect(res.status).toBe(402);
    const body = (await res.json()) as { accepts: unknown[] };
    expect(Array.isArray(body.accepts)).toBe(true);
    expect(body.accepts.length).toBe(1);
  });

  test("returns 402 when payload is malformed", async () => {
    const res = await app.request("/paid", {
      headers: { "Payment-Signature": "not-base64" },
    });
    expect(res.status).toBe(402);
  });

  test("passes through when verifier accepts", async () => {
    const payload = {
      x402Version: 1,
      payload: { mockReceipt: true, payer: "0xCAFE" },
    };
    const header = Buffer.from(JSON.stringify(payload)).toString("base64");
    const res = await app.request("/paid", {
      headers: { "Payment-Signature": header },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; receipt: string };
    expect(body.ok).toBe(true);
    expect(body.receipt).toContain("mock_");
  });
});
