/**
 * Integrator-facing verification helper. Re-exports a stable surface for
 * webhook receivers so they don't need to import internal modules.
 *
 * Usage on the integrator side:
 *
 *   import { verifyWebhookRequest } from "@bufi/webhooks/verify";
 *
 *   const sig = req.headers.get("X-Bufi-Signature");
 *   const nonce = req.headers.get("X-Bufi-Nonce");
 *   const ts = Number(req.headers.get("X-Bufi-Timestamp"));
 *   const body = await req.text();
 *   const result = verifyWebhookRequest({
 *     body, signature: sig!, nonce: nonce!,
 *     timestamp: ts, secret: process.env.BUFI_WEBHOOK_SECRET!,
 *   });
 *   if (!result.valid) return new Response(`bad webhook: ${result.reason}`, { status: 401 });
 */

import { verifyWebhook, type VerifyResult } from "./hmac";

export interface VerifyWebhookRequestArgs {
  body: string;
  signature: string;
  nonce: string;
  timestamp: number;
  secret: string;
  /** Allowed clock skew in seconds. Default 300. */
  toleranceSeconds?: number;
}

export function verifyWebhookRequest(args: VerifyWebhookRequestArgs): VerifyResult {
  return verifyWebhook(args);
}

export { signWebhook } from "./hmac";
export type { VerifyResult } from "./hmac";
export {
  WEBHOOK_HEADER_SIGNATURE,
  WEBHOOK_HEADER_NONCE,
  WEBHOOK_HEADER_TIMESTAMP,
  WEBHOOK_HEADER_EVENT_TYPE,
  WEBHOOK_HEADER_ATTEMPT,
  type WebhookEvent,
  type WebhookEventType,
  type FillWebhookEvent,
  type LiquidationWebhookEvent,
  type FundingWebhookEvent,
} from "./types";
