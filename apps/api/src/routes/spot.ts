import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  createPublicClient,
  defineChain,
  http,
  parseEventLogs,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";

import {
  FxBentoPoolRegistryAbi,
  getBentoAddress,
  getBentoDeployment,
} from "@bufi/contracts/bento";
import {
  buildVenueSpotIntent,
  spotIntentRequestSchema,
  type BuiltSpotIntent,
} from "@bufi/fx-spot";
import type { WalletSession } from "@bufi/shared-types";

// `requireRole` is exported from `../middleware/api-key` and is the
// recommended middleware-style guard for non-typed Hono routes. We do
// the same role check inline below on the LP endpoints so the
// `OpenAPIHono` route-union stays intact for `hc<AppType>` clients.
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

// ─────────────────────────── /spot/pools schemas ───────────────────────────
const SpotPool = z
  .object({
    poolId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    chainId: z.number().int().positive(),
    currency0: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    currency1: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    fee: z.number().int().nonnegative(),
    tickSpacing: z.number().int(),
    hook: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    oracleSource: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    allowed: z.boolean(),
    maxStaleSeconds: z.number().int().nonnegative(),
  })
  .openapi("SpotPool");

const SpotPoolsResponse = z
  .object({
    pools: z.array(SpotPool),
    cachedAt: z.number().int().nonnegative(),
    cacheTtlSec: z.number().int().nonnegative(),
  })
  .openapi("SpotPoolsResponse");

// ─────────────────────────── LP position schemas ───────────────────────────
// `amount0` / `amount1` are uint-strings (10⁰… 10²⁵⁶-1), tick bounds are
// int24. We keep this minimal — the on-chain settlement layer (the
// follow-up PR) will lift the validation against the actual pool key.
const LpAddPositionRequest = z
  .object({
    amount0: z.string().regex(/^\d+$/),
    amount1: z.string().regex(/^\d+$/),
    tickLower: z.number().int(),
    tickUpper: z.number().int(),
  })
  .openapi("SpotLpAddPositionRequest");

const LpPositionStatus = z.enum(["queued", "settled", "failed"]);

const LpAddPositionResponse = z
  .object({
    status: LpPositionStatus,
    positionId: z.string(),
    poolId: z.string(),
    /** Empty string until the on-chain settlement keeper lands this position. */
    txDigest: z.string(),
  })
  .openapi("SpotLpAddPositionResponse");

const LpRemovePositionResponse = z
  .object({
    status: LpPositionStatus,
    positionId: z.string(),
    poolId: z.string(),
    txDigest: z.string(),
  })
  .openapi("SpotLpRemovePositionResponse");

// ─────────────────────────── pools cache ───────────────────────────
// Pools change on the order of "an admin sets a new market live", which
// in this protocol happens days-to-weeks apart. `readContract` against
// public Avalanche Fuji / Arc RPCs is the slow part (~600–2000ms), so we
// cache the enumerated list aggressively. TTL override via
// SPOT_POOLS_CACHE_TTL_SEC.
//
// Enumeration strategy: PoolRegistry doesn't expose a `listPools()` view,
// so we read past `PoolAllowed(bytes32,address,address,address,bool)`
// logs from the registry's start block, dedupe by poolId, then call
// `getPool(poolId)` for the canonical state of each pool. The dedup is
// important: a pool that was allowed → disallowed → re-allowed shows up
// three times in the event stream.
type SpotPoolPayload = z.infer<typeof SpotPool>;

interface PoolsCacheEntry {
  cachedAt: number;
  pools: SpotPoolPayload[];
}

const poolsCache = new Map<number /* chainId */, PoolsCacheEntry>();

function poolsCacheTtlSec(): number {
  const raw = process.env.SPOT_POOLS_CACHE_TTL_SEC;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return 30;
}

function defaultSpotChainId(): number {
  const raw = process.env.SPOT_DEFAULT_CHAIN_ID;
  const parsed = raw ? Number(raw) : NaN;
  // Default to Arc Testnet — that's where the canonical pool registry is
  // most often populated for the demo flows. Fuji is reachable via
  // ?chainId=43113.
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return 5042002;
}

// Shape returned by `PoolRegistry.getPool(bytes32)` — mirrors the tuple
// in the ABI string. Cast site is the single `readContract` call below;
// keeping the type local so a future ABI bump triggers a compile error
// here rather than at every consumer.
interface RegistryPoolRecord {
  key: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  };
  baseToken: Address;
  quoteToken: Address;
  oracleSource: Address;
  allowed: boolean;
  maxStaleSeconds: number;
  tickSpacing: number;
  hook: Address;
}

async function readPoolList(chainId: number): Promise<SpotPoolPayload[]> {
  const deployment = getBentoDeployment(chainId);
  if (!deployment) throw new Error(`pool registry not configured for chain ${chainId}`);
  const registryAddress = getBentoAddress(chainId, "PoolRegistry");
  if (!registryAddress) {
    throw new Error(`pool registry address missing for chain ${chainId}`);
  }
  const client = createPublicClient({
    chain: defineChain({
      id: chainId,
      name: `spot-pools-${chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [deployment.rpcUrl] } },
    }),
    transport: http(deployment.rpcUrl),
  });
  // Pull every PoolAllowed log since the registry's start block, then
  // dedupe by poolId. We trust `getPool` for the authoritative state of
  // each pool — the event tells us a poolId *existed*, not its current
  // shape.
  const rawLogs = await client.getLogs({
    address: registryAddress,
    fromBlock: BigInt(deployment.indexerStartBlock),
    toBlock: "latest",
  });
  const parsedLogs = parseEventLogs({
    abi: FxBentoPoolRegistryAbi,
    eventName: "PoolAllowed",
    logs: rawLogs,
  });
  const seen = new Set<Hex>();
  const ids: Hex[] = [];
  for (const log of parsedLogs) {
    const id = log.args.poolId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const pool = (await client.readContract({
          address: registryAddress,
          abi: FxBentoPoolRegistryAbi,
          functionName: "getPool",
          args: [id],
        })) as RegistryPoolRecord;
        const payload: SpotPoolPayload = {
          poolId: id,
          chainId,
          currency0: pool.key.currency0,
          currency1: pool.key.currency1,
          fee: Number(pool.key.fee),
          tickSpacing: Number(pool.key.tickSpacing),
          hook: pool.hook,
          oracleSource: pool.oracleSource,
          allowed: pool.allowed,
          maxStaleSeconds: Number(pool.maxStaleSeconds),
        };
        return payload;
      } catch {
        // `getPool` reverts on unknown ids (shouldn't happen after our
        // dedupe, but RPC can race with a `setPool` mid-call). Drop the
        // row rather than fail the whole enumeration.
        return null;
      }
    }),
  );
  return results.filter((r): r is SpotPoolPayload => r !== null);
}

async function getPools(chainId: number): Promise<PoolsCacheEntry> {
  const ttl = poolsCacheTtlSec();
  const cached = poolsCache.get(chainId);
  if (cached && nowSec() - cached.cachedAt < ttl) return cached;
  const pools = await readPoolList(chainId);
  const entry: PoolsCacheEntry = { cachedAt: nowSec(), pools };
  poolsCache.set(chainId, entry);
  return entry;
}

/** Test-only — clears the cache between cases. */
export function _resetSpotPoolsCache(): void {
  poolsCache.clear();
}

// ─────────────────────────── LP intent store ───────────────────────────
// Scaffold persistence for queued add/remove LP intents. Same shape as
// the perps intent store (apps/api/src/services.ts → tradingDb.perpsIntents)
// so the follow-up PR can swap this for a Redis/sqlite-backed table
// without changing the API surface.
//
// Production shape (follow-up):
//   `lp_intents` table — { positionId TEXT PK, poolId TEXT, kind ENUM,
//   amount0 NUMERIC, amount1 NUMERIC, tickLower INT, tickUpper INT,
//   status ENUM, txDigest TEXT?, createdAt INT, settledAt INT? }
interface LpIntent {
  positionId: string;
  poolId: string;
  kind: "add" | "remove";
  amount0?: string;
  amount1?: string;
  tickLower?: number;
  tickUpper?: number;
  status: z.infer<typeof LpPositionStatus>;
  txDigest: string;
  createdAt: number;
}

const lpIntentStore = new Map<string /* positionId */, LpIntent>();

function newPositionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `pos_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Test-only — clears intent store between cases. */
export function _resetLpIntentStore(): void {
  lpIntentStore.clear();
}

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

// ─────────────────────────── /spot/pools route ───────────────────────────
const poolsRoute = createRoute({
  method: "get",
  path: "/pools",
  tags: ["spot"],
  summary: "Enumerate allowed v4 spot pools",
  description:
    "Public, no-auth. Reads the on-chain `PoolRegistry` for the requested chain (default Arc Testnet; override via `?chainId=43113` for Fuji) by replaying `PoolAllowed` logs and resolving each unique poolId via `getPool`. Cached in-process for `SPOT_POOLS_CACHE_TTL_SEC` seconds (default 30). The on-chain pool list changes on the order of days, so the freshness ceiling is intentional.",
  request: {
    query: z.object({
      chainId: z
        .string()
        .regex(/^\d+$/)
        .optional()
        .openapi({ description: "EIP-155 chain id; default 5042002 (Arc Testnet)." }),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: SpotPoolsResponse } },
      description: "Pool list",
    },
    424: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Pool registry not configured for the requested chain",
    },
    500: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Pool registry read failed",
    },
  },
});

// ─────────────────────────── /spot/pools/:id/positions routes ─────────────
const positionsAddRoute = createRoute({
  method: "post",
  path: "/pools/{id}/positions",
  tags: ["spot"],
  summary: "Queue an LP add-liquidity position against a pool",
  description:
    "Market-setter API key required (`X-API-Key`). Persists an `add` intent in the LP intent store and returns `{ status: 'queued', positionId, txDigest }`. On-chain settlement (PoolManager `modifyLiquidity` through the FX² hook) is performed by a follow-up keeper PR — the API surface here is the contract B2B integrators can start integrating against today.",
  request: {
    params: z.object({
      id: z.string().regex(/^0x[a-fA-F0-9]{64}$/).openapi({ description: "Pool id (bytes32)" }),
    }),
    body: {
      content: { "application/json": { schema: LpAddPositionRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: LpAddPositionResponse } },
      description: "Position intent queued",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Malformed body or poolId",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Market-setter API key required",
    },
  },
});

const positionsRemoveRoute = createRoute({
  method: "delete",
  path: "/pools/{id}/positions/{positionId}",
  tags: ["spot"],
  summary: "Queue an LP remove-liquidity intent against a pool",
  description:
    "Market-setter API key required (`X-API-Key`). Persists a `remove` intent referencing the queued / settled `positionId`. On-chain settlement is keeper-driven, same path as the add endpoint.",
  request: {
    params: z.object({
      id: z.string().regex(/^0x[a-fA-F0-9]{64}$/).openapi({ description: "Pool id (bytes32)" }),
      positionId: z.string().openapi({ description: "Opaque position id returned by POST" }),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: LpRemovePositionResponse } },
      description: "Remove intent queued",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Market-setter API key required",
    },
    404: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Unknown positionId",
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
  })
  .openapi(poolsRoute, async (c) => {
    const { chainId } = c.req.valid("query");
    const resolved = chainId ? Number(chainId) : defaultSpotChainId();
    try {
      const { cachedAt, pools } = await getPools(resolved);
      return c.json(
        {
          pools,
          cachedAt,
          cacheTtlSec: poolsCacheTtlSec(),
        },
        200,
      );
    } catch (e) {
      const msg = (e as Error).message;
      // "not configured" / "address missing" map to 424. Everything else
      // is an RPC failure, surface as 500 so the caller knows to retry.
      const narrowed: 424 | 500 =
        msg.includes("not configured") || msg.includes("missing")
          ? 424
          : 500;
      return c.json({ error: msg }, narrowed);
    }
  })
  // Both LP endpoints check the api-key role inline. We *could* mount
  // `requireRole("market-setter")` via `.use(...)` but that erases the
  // `OpenAPIHono` typed-route union back to `Hono`, breaking the
  // `hc<AppType>` inference downstream. Doing the check inside the
  // handler keeps the typed surface intact and matches the 401-only
  // response the openapi schema documents.
  .openapi(positionsAddRoute, async (c) => {
    if (c.get("apiKeyRole") !== "market-setter") {
      return c.json(
        { error: "market-setter API key required" },
        401,
      );
    }
    const { id } = c.req.valid("param");
    const raw = await c.req.json().catch(() => ({}));
    const parsed = LpAddPositionRequest.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
    }
    if (parsed.data.tickLower >= parsed.data.tickUpper) {
      return c.json({ error: "tickLower must be strictly less than tickUpper" }, 400);
    }
    const positionId = newPositionId();
    const intent: LpIntent = {
      positionId,
      poolId: id,
      kind: "add",
      amount0: parsed.data.amount0,
      amount1: parsed.data.amount1,
      tickLower: parsed.data.tickLower,
      tickUpper: parsed.data.tickUpper,
      // Scaffold: on-chain settlement (PoolManager.modifyLiquidity through
      // the FX² hook) lands in a follow-up PR. The status surface and
      // positionId shape are the contract the follow-up has to keep.
      status: "queued",
      txDigest: "",
      createdAt: nowSec(),
    };
    lpIntentStore.set(positionId, intent);
    return c.json(
      {
        status: intent.status,
        positionId,
        poolId: id,
        txDigest: intent.txDigest,
      },
      200,
    );
  })
  .openapi(positionsRemoveRoute, async (c) => {
    if (c.get("apiKeyRole") !== "market-setter") {
      return c.json(
        { error: "market-setter API key required" },
        401,
      );
    }
    const { id, positionId } = c.req.valid("param");
    const existing = lpIntentStore.get(positionId);
    if (!existing || existing.poolId !== id) {
      return c.json({ error: "unknown position" }, 404);
    }
    // We deliberately do NOT delete the row — it's the audit trail. The
    // remove intent becomes its own row keyed off a fresh positionId so
    // the keeper can reconcile add/remove pairs.
    const removeId = newPositionId();
    lpIntentStore.set(removeId, {
      positionId: removeId,
      poolId: id,
      kind: "remove",
      status: "queued",
      txDigest: "",
      createdAt: nowSec(),
    });
    return c.json(
      {
        status: "queued" as const,
        positionId: removeId,
        poolId: id,
        txDigest: "",
      },
      200,
    );
  });

export { spotRoutes };
