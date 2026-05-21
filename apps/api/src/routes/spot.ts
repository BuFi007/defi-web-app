import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { verifyTypedData, type Address, type Hex } from "viem";

import {
  buildVenueSpotIntent,
  spotIntentRequestSchema,
  type BuiltSpotIntent,
} from "@bufi/fx-spot";
import type { WalletSession } from "@bufi/shared-types";

import { errorStatus, jsonSafe } from "../services";

// ─────────────────────────── quote store ───────────────────────────
// In-memory RFQ quote store. Lives in the API process — quotes expire
// after `ttlSec` seconds and are evicted lazily on lookup + on a
// best-effort interval sweep. Production hardening (Redis-backed,
// per-key counters, replay defence) lives in a follow-up PR; the
// shape here is the contract the follow-up has to keep.
//
// Stored shape:
//   quoteId   — opaque, random hex id we hand back to callers
//   builtAt   — Unix seconds the quote was minted
//   expiresAt — Unix seconds when the quote becomes invalid
//   built     — full `BuiltSpotIntent` so /spot/fills can re-verify
//               the signature against the exact `typedData` we
//               handed out at quote time
//   request   — the parsed `spotIntentRequestSchema` input (used to
//               re-derive `nonce` etc. for the persisted fill)
interface StoredQuote {
  quoteId: string;
  builtAt: number;
  expiresAt: number;
  built: BuiltSpotIntent;
  request: z.infer<typeof spotIntentRequestSchema>;
}

const quoteStore = new Map<string, StoredQuote>();

function defaultTtlSec(): number {
  const raw = process.env.SPOT_QUOTE_TTL_SEC;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return 30;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function sweepExpired(): void {
  const t = nowSec();
  for (const [id, q] of quoteStore) {
    if (q.expiresAt <= t) quoteStore.delete(id);
  }
}

function newQuoteId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `q_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// Best-effort background sweep. `unref()` so the timer doesn't hold
// the Bun event loop open in tests / short-lived scripts.
const sweepHandle = setInterval(sweepExpired, 10_000) as unknown as {
  unref?: () => void;
};
sweepHandle.unref?.();

// ─────────────────────────── schemas ───────────────────────────
// `QuoteRequest` is the same shape `spotIntentRequestSchema` validates,
// re-declared here as an openapi-tagged zod schema. We deliberately
// don't import the runtime schema into the openapi route (the @bufi/fx-spot
// package doesn't carry the `.openapi(...)` tags), instead we parse the
// raw body through `spotIntentRequestSchema` inside the handler so both
// surfaces agree.
const QuoteRequest = z
  .object({
    sourceChainId: z.literal(43113).default(43113),
    destinationChainId: z.literal(5042002).default(5042002),
    symbol: z.enum(["EURC", "JPYC", "MXNB", "CHFC"]),
    trader: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    amountIn: z.string().regex(/^\d+$/),
    minAmountOut: z.string().regex(/^\d+$/),
    maxExecutionFee: z.string().regex(/^\d+$/).default("0"),
    deadline: z.number().int().positive(),
    nonce: z.string().regex(/^\d+$/),
    referrer: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    campaignId: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
    data: z.string().regex(/^0x([a-fA-F0-9]{2})*$/).optional(),
  })
  .openapi("SpotQuoteRequest");

// `typedData` and `calldata` are large and effectively opaque to the
// client — surface as passthrough so we don't have to clone viem's
// `TypedDataDomain` shape into zod here. The fields the caller actually
// touches (router, digest, quoteId, ttlSec, expiresAt) are typed
// concretely.
const QuoteResponse = z
  .object({
    quoteId: z.string(),
    router: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    digest: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    typedData: z
      .object({
        domain: z.unknown(),
        types: z.unknown(),
        primaryType: z.string(),
        message: z.unknown(),
      })
      .passthrough(),
    calldata: z.string().regex(/^0x([a-fA-F0-9]{2})*$/),
    ttlSec: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .openapi("SpotQuoteResponse");

const FillRequest = z
  .object({
    quoteId: z.string(),
    signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
    trader: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  })
  .openapi("SpotFillRequest");

const FillResponse = z
  .object({
    fillId: z.string(),
    quoteId: z.string(),
    status: z.enum(["accepted", "rejected"]),
    reason: z.string().optional(),
  })
  .openapi("SpotFillResponse");

const ErrorResponse = z
  .object({ error: z.string(), issues: z.unknown().optional() })
  .openapi("SpotErrorResponse");

// ─────────────────────────── routes ───────────────────────────
const quoteRoute = createRoute({
  method: "post",
  path: "/quote",
  tags: ["spot"],
  summary: "Build an unsigned spot RFQ quote",
  description:
    "Public, no-auth. Returns the EIP-712 typed data + venue router calldata for a venue spot intent, along with an opaque `quoteId` the client redeems via POST /spot/fills. Quotes expire after `ttlSec` (env: SPOT_QUOTE_TTL_SEC, default 30).",
  request: {
    body: {
      content: { "application/json": { schema: QuoteRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: QuoteResponse } },
      description: "Quote minted",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Malformed body",
    },
    424: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Venue router not configured for the requested chain",
    },
    500: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Unexpected error",
    },
  },
});

const fillsRoute = createRoute({
  method: "post",
  path: "/fills",
  tags: ["spot"],
  summary: "Submit a signed fill against a previously-issued quote",
  description:
    "Wallet-session required. Verifies the EIP-712 signature against the exact typedData handed out by POST /spot/quote, then persists the fill. Quote must not be expired.",
  request: {
    body: {
      content: { "application/json": { schema: FillRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: FillResponse } },
      description: "Fill accepted or rejected (see `status`)",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Malformed body or expired/unknown quote",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Wallet session required",
    },
    403: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Trader does not match wallet session",
    },
    404: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Quote not found or already expired",
    },
  },
});

// @deprecated — kept for back-compat with existing callers. New
// integrations should use `POST /spot/quote` + `POST /spot/fills`.
// Behaves exactly as before: wallet-session required, returns the
// `BuiltSpotIntent` in one shot with no TTL/quoteId.
const intentsRoute = createRoute({
  method: "post",
  path: "/intents",
  tags: ["spot"],
  summary: "[deprecated] Single-shot venue spot intent build (no quote/fill split)",
  description:
    "Legacy endpoint. Builds + returns a venue spot intent in one call. Use `POST /spot/quote` + `POST /spot/fills` for the RFQ flow. Kept callable so existing integrations don't break.",
  request: {
    body: {
      content: { "application/json": { schema: QuoteRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z
            .object({
              routeId: z.string(),
              router: z.string(),
              digest: z.string(),
              typedData: z.unknown(),
              calldata: z.string(),
            })
            .passthrough()
            .openapi("SpotIntentLegacyResponse"),
        },
      },
      description: "Built intent",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Malformed body",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Wallet session required",
    },
    403: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Trader must match session address",
    },
  },
});

// Chain `.openapi(...)` calls so the resulting `spotRoutes` variable
// carries the full typed route union — see markets.ts for the same
// pattern. The chain capture is what `typedApp.route("/spot", spotRoutes)`
// in server.ts surfaces to `hc<AppType>`.
const spotRoutes = new OpenAPIHono()
  .openapi(quoteRoute, async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = spotIntentRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
    }
    try {
      const built = buildVenueSpotIntent(parsed.data);
      const ttlSec = defaultTtlSec();
      const builtAt = nowSec();
      const expiresAt = builtAt + ttlSec;
      const quoteId = newQuoteId();
      quoteStore.set(quoteId, {
        quoteId,
        builtAt,
        expiresAt,
        built,
        request: parsed.data,
      });
      return c.json(
        jsonSafe({
          quoteId,
          router: built.router,
          digest: built.digest,
          typedData: built.typedData,
          calldata: built.calldata,
          ttlSec,
          expiresAt,
        }) as z.infer<typeof QuoteResponse>,
        200,
      );
    } catch (e) {
      const status = errorStatus(e);
      // QuoteResponse only enumerates 400 / 424 / 500; collapse any other
      // upstream status onto 500 so the typed surface stays narrow.
      const narrowed: 400 | 424 | 500 =
        status === 400 ? 400 : status === 424 ? 424 : 500;
      return c.json({ error: (e as Error).message }, narrowed);
    }
  })
  .openapi(fillsRoute, async (c) => {
    const session = c.get("walletSession") as WalletSession | null;
    if (!session) return c.json({ error: "wallet session required" }, 401);
    const raw = await c.req.json().catch(() => ({}));
    const parsed = FillRequest.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
    }
    const { quoteId, signature, trader } = parsed.data;
    if (trader.toLowerCase() !== session.address.toLowerCase()) {
      return c.json({ error: "trader must match session address" }, 403);
    }
    // Lazy eviction on lookup — keeps `sweepExpired` from being load-bearing.
    sweepExpired();
    const stored = quoteStore.get(quoteId);
    if (!stored) return c.json({ error: "quote not found" }, 404);
    if (stored.expiresAt <= nowSec()) {
      quoteStore.delete(quoteId);
      return c.json({ error: "quote expired" }, 404);
    }
    if (
      stored.built.request.trader.toLowerCase() !== trader.toLowerCase()
    ) {
      return c.json({ error: "trader does not match quote" }, 403);
    }
    let valid = false;
    try {
      valid = await verifyTypedData({
        ...stored.built.typedData,
        address: trader as Address,
        signature: signature as Hex,
      });
    } catch (e) {
      return c.json(
        {
          fillId: "",
          quoteId,
          status: "rejected" as const,
          reason: `verify failed: ${(e as Error).message}`,
        },
        200,
      );
    }
    if (!valid) {
      return c.json(
        {
          fillId: "",
          quoteId,
          status: "rejected" as const,
          reason: "signature did not recover trader",
        },
        200,
      );
    }
    // Persist a synthetic fill id. Real persistence (db / venue router
    // dispatch) lands in a follow-up — for now this is the contract.
    const fillId = `f_${stored.built.digest.slice(2, 18)}_${nowSec().toString(16)}`;
    // One-shot redemption: drop the quote so the same signature can't
    // be replayed as a new fill.
    quoteStore.delete(quoteId);
    return c.json(
      {
        fillId,
        quoteId,
        status: "accepted" as const,
      },
      200,
    );
  })
  .openapi(intentsRoute, async (c) => {
    const session = c.get("walletSession") as WalletSession | null;
    if (!session) return c.json({ error: "wallet session required" }, 401);
    const raw = await c.req.json().catch(() => ({}));
    const parsed = spotIntentRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
    }
    if (parsed.data.trader.toLowerCase() !== session.address.toLowerCase()) {
      return c.json({ error: "trader must match session address" }, 403);
    }
    try {
      const built = buildVenueSpotIntent(parsed.data);
      return c.json(
        jsonSafe({
          routeId: built.routeId,
          router: built.router,
          digest: built.digest,
          typedData: built.typedData,
          calldata: built.calldata,
        }),
        200,
      );
    } catch (e) {
      const status = errorStatus(e);
      const narrowed: 400 | 401 | 403 = status === 401 ? 401 : status === 403 ? 403 : 400;
      return c.json({ error: (e as Error).message }, narrowed);
    }
  });

export { spotRoutes };
