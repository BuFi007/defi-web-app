/**
 * Integrator API-key auth for the webhook management routes.
 *
 * Wave H2 spec: subscriptions are scoped to an integrator API key. We
 * deliberately don't roll our own key-issuance flow here — the assumption
 * is that integrators get their key out-of-band (operator hands them one
 * provisioned in `BUFI_WEBHOOK_INTEGRATORS`, comma-separated `id:secret`
 * pairs). The route just derives an `integratorId` from the presented key
 * so the store can scope list/revoke ops.
 *
 * Format: `X-Bufi-Api-Key: <id>.<secret>` where the secret is a hex string.
 * The `id` segment scopes the subscription; the secret is constant-time
 * compared against the configured value.
 *
 * Dev fallback (NODE_ENV !== "production"): any non-empty key is accepted,
 * and we treat the entire header value as the integratorId. This keeps the
 * local-dev story sane without forcing every contributor to provision keys.
 */

import type { Context } from "hono";
import { timingSafeEqual } from "node:crypto";

export interface IntegratorIdentity {
  integratorId: string;
}

interface ConfiguredKey {
  id: string;
  secret: string;
}

let cachedKeys: ConfiguredKey[] | null = null;

function configuredKeys(): ConfiguredKey[] {
  if (cachedKeys) return cachedKeys;
  const raw = process.env.BUFI_WEBHOOK_INTEGRATORS ?? "";
  cachedKeys = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(":");
      if (idx <= 0) return null;
      return { id: entry.slice(0, idx), secret: entry.slice(idx + 1) };
    })
    .filter((entry): entry is ConfiguredKey => entry !== null);
  return cachedKeys;
}

export function authenticateIntegrator(c: Context): IntegratorIdentity | null {
  const presented = c.req.header("x-bufi-api-key");
  if (!presented) return null;

  const isProd = process.env.NODE_ENV === "production";

  const dot = presented.indexOf(".");
  if (dot > 0) {
    const id = presented.slice(0, dot);
    const secret = presented.slice(dot + 1);
    const keys = configuredKeys();
    const match = keys.find((k) => k.id === id);
    if (match && constantTimeEq(secret, match.secret)) {
      return { integratorId: id };
    }
    if (isProd) return null;
  }

  // Dev fallback — accept the raw header value as the integrator id.
  if (!isProd) return { integratorId: presented };
  return null;
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return timingSafeEqual(bufA, bufB);
}

/** Tests reset between cases — clears the lazy env cache. */
export function _resetIntegratorKeyCache(): void {
  cachedKeys = null;
}
