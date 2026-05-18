/**
 * Tiny shared helpers for Hono route handlers. These replace patterns
 * that were inline-duplicated across every route file:
 *   - `await c.req.json().catch(() => ({}))` + `schema.safeParse(raw)`
 *   - `c.get("walletSession") as WalletSession | null; if (!session) ...`
 *   - `address.toLowerCase() !== session.address.toLowerCase()`
 *   - `Number(c.req.query("chainId") ?? <default>)`
 *   - `c.var.log.info("route_ok")` / `c.var.log.error("route_error", { err })`
 *
 * Keep each helper small + free of route-specific logic. If a helper
 * grows past ~20 lines or needs domain-aware branching, extract a
 * per-route helper instead — this file is for cross-cutting plumbing.
 */
import type { Context } from "hono";
import type { ZodTypeAny, z } from "zod";

import type { WalletSession } from "@bufi/shared-types";

import { errorStatus } from "./services";

/** Parse + validate the request body. On failure returns the 400
 *  response so the caller can `return await` it directly. */
export async function parseBody<S extends ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: c.json({ error: "bad body", issues: parsed.error.issues }, 400),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Read the wallet session set by the wallet-session middleware. Returns
 *  the 401 response on miss so the caller can `return await` it. */
export function getSession(
  c: Context,
): { ok: true; session: WalletSession } | { ok: false; response: Response } {
  const session = c.get("walletSession") as WalletSession | null;
  if (!session) {
    return { ok: false, response: c.json({ error: "wallet session required" }, 401) };
  }
  return { ok: true, session };
}

/** Case-insensitive address match. Returns the 403 response on mismatch
 *  so the caller can `return await` it. The expected human-readable
 *  message is "<field> must match session address". */
export function assertAddressMatches(
  c: Context,
  actual: string,
  session: WalletSession,
  field = "trader",
): { ok: true } | { ok: false; response: Response } {
  if (actual.toLowerCase() !== session.address.toLowerCase()) {
    return {
      ok: false,
      response: c.json({ error: `${field} must match session address` }, 403),
    };
  }
  return { ok: true };
}

/** Read chainId from query, coerce to number, default if missing. Throws
 *  via `c.json(...)` 400 if the value is non-numeric — caller returns it
 *  directly. Pass `defaultChainId` if a missing value should fall through
 *  to a hub chain default. */
export function getChainIdFromQuery(
  c: Context,
  defaultChainId?: number,
): { ok: true; chainId: number } | { ok: false; response: Response } {
  const raw = c.req.query("chainId");
  if (raw === undefined) {
    if (defaultChainId === undefined) {
      return { ok: false, response: c.json({ error: "chainId is required" }, 400) };
    }
    return { ok: true, chainId: defaultChainId };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, response: c.json({ error: "chainId must be an integer" }, 400) };
  }
  return { ok: true, chainId: n };
}

/** Structured success log + JSON response in one call. The shape matches
 *  what every route was already emitting via `c.var.log.info("route_ok")`. */
export function jsonOk<T>(c: Context, body: T): Response {
  c.var.log.info("route_ok");
  return c.json(body as Record<string, unknown>);
}

/** Structured error log + JSON error response. Status comes from
 *  `errorStatus()` so the mapping stays consistent across routes. */
export function jsonError(c: Context, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  c.var.log.error("route_error", { err: message });
  return c.json({ error: message }, errorStatus(err));
}
