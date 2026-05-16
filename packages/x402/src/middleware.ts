/**
 * Hono middleware that gates a route behind a nanopayment.
 *
 * Flow:
 *   1. No `Payment-Signature` header → 402 with multi-accept envelope.
 *   2. Header present → decode, settle via the configured verifier,
 *      attach receipt to ctx as `c.get("x402")`, call next().
 *   3. Settle rejected → 402 with the verifier's error.
 *
 * Provider-agnostic — pass any `PaymentVerifier` impl. Sendero's flow
 * inspired this scheme, but the SDK dependency is owned by the verifier
 * implementation, not the middleware.
 */

import type { MiddlewareHandler } from "hono";

import type { ReceiptStore } from "./receipts";
import type {
  DecodedPaymentPayload,
  PaymentReceipt,
  PaymentRequiredEnvelope,
  PaymentVerifier,
} from "./types";

export interface X402MiddlewareOpts {
  toolName: string;
  /** Decimal USDC string. e.g. "0.0050". */
  priceUsdc: string;
  sellerAddress: string;
  verifier: PaymentVerifier;
  receipts?: ReceiptStore;
  /** Optional resource description shown in the 402 envelope. */
  resource?: { url: string; description: string; mimeType: string };
}

export interface X402RequestContext {
  receipt: PaymentReceipt;
}

declare module "hono" {
  interface ContextVariableMap {
    x402: X402RequestContext;
  }
}

export function paymentRequired(opts: X402MiddlewareOpts): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("Payment-Signature");
    if (!header) {
      return c.json(await buildEnvelope(opts), 402);
    }

    let payload: DecodedPaymentPayload;
    try {
      payload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    } catch (e) {
      return c.json(
        { ...emptyEnvelope(opts), error: `invalid Payment-Signature: ${(e as Error).message}` },
        402,
      );
    }

    // Replay protection: if we've seen this receipt already, reject.
    if (opts.receipts && payload.accepted) {
      const maybeId = String(payload.payload?.receiptId ?? "");
      if (maybeId && (await opts.receipts.has(maybeId))) {
        return c.json(
          { ...emptyEnvelope(opts), error: "receipt already settled" },
          402,
        );
      }
    }

    let receipt: PaymentReceipt;
    try {
      receipt = await opts.verifier.verify(payload, {
        toolName: opts.toolName,
        priceUsdc: opts.priceUsdc,
        sellerAddress: opts.sellerAddress,
      });
    } catch (e) {
      return c.json(
        { ...emptyEnvelope(opts), error: (e as Error).message },
        402,
      );
    }

    if (opts.receipts) await opts.receipts.put(opts.toolName, receipt);
    c.set("x402", { receipt });
    await next();
  };
}

function emptyEnvelope(opts: X402MiddlewareOpts): PaymentRequiredEnvelope {
  return {
    x402Version: 1,
    accepts: [],
    resource: opts.resource ?? {
      url: "",
      description: opts.toolName,
      mimeType: "application/json",
    },
  };
}

async function buildEnvelope(opts: X402MiddlewareOpts): Promise<PaymentRequiredEnvelope> {
  const accepts = await opts.verifier.buildAccepts({
    toolName: opts.toolName,
    priceUsdc: opts.priceUsdc,
    sellerAddress: opts.sellerAddress,
  });
  return {
    x402Version: 1,
    accepts,
    resource: opts.resource ?? {
      url: "",
      description: opts.toolName,
      mimeType: "application/json",
    },
  };
}
