import { z } from "zod";

/**
 * Server-side env schema. Reads from process.env at module-load time.
 * Throws on the first read if anything required is missing — surface
 * the error eagerly so misconfigured deploys fail fast.
 *
 * Optional vars degrade features gracefully (e.g. no LIVEBLOCKS_SECRET_KEY
 * → realtime is disabled, not a crash).
 */
const schema = z.object({
  // realtime
  LIVEBLOCKS_SECRET_KEY: z.string().optional(),

  // indexer
  PONDER_RPC_URL_ARC_TESTNET: z.string().url().optional(),
  PONDER_RPC_URL_AVAX_FUJI: z.string().url().optional(),
  DATABASE_URL: z.string().optional(),
  DATABASE_PRIVATE_URL: z.string().optional(),
  BUFI_DB_PATH: z.string().optional(),
  BENTO_DB_PATH: z.string().optional(),

  // rpc — public chain endpoints. Optional with hardcoded defaults baked
  // into @bufi/contracts so dev keeps working without env config.
  AVALANCHE_FUJI_RPC_URL: z.string().url().optional(),
  ARC_TESTNET_RPC_URL: z.string().url().optional(),

  // x402 / facilitator
  X402_FACILITATOR_URL: z.string().url().optional(),
  X402_NETWORK: z.string().optional(),
  X402_RECEIVER_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),

  // pricing / oracles
  MARKET_DATA_RPC_URL: z.string().url().optional(),
  PYTH_HERMES_URL: z.string().url().optional(),
  PYTH_MAX_STALE_SECONDS: z.coerce.number().int().positive().default(30),

  // contracts
  CONTRACT_ADDRESSES_JSON: z.string().optional(),
  TREASURY_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),

  // signer (DEV ONLY — never set in production)
  API_SIGNER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  KEEPER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  GATEWAY_API_BASE: z.string().url().optional(),
  GATEWAY_SIGNER_OUT: z.string().optional(),
  // 30s default poll. Most keepers either self-throttle to a longer
  // cadence (LIQUIDATOR_INTERVAL_MS=30s, FUNDING_INTERVAL_MS=1h, etc.)
  // or are stub-only (pyth / gateway-signer / arcade-settler / spot —
  // they log a "wire X here" note at boot, no per-tick work). 5s was
  // aggressive enough to dominate dev:complete's terminal pane with
  // re-rendered scan lines. Override per-deploy via env.
  KEEPER_POLL_MS: z.coerce.number().int().positive().default(30_000),
  PORT: z.coerce.number().int().positive().optional(),

  // observability — Sentry DSNs. When unset, the Sentry init helpers
  // no-op silently (see apps/api/src/sentry.ts and apps/web/lib/sentry/*).
  SENTRY_DSN_WEB: z.string().url().optional(),
  SENTRY_DSN_API: z.string().url().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

let _cached: z.infer<typeof schema> | null = null;

export function serverEnv(): z.infer<typeof schema> {
  if (_cached) return _cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`@bufi/env: invalid server env:\n${issues}`);
  }
  _cached = parsed.data;
  return _cached;
}

export type ServerEnv = z.infer<typeof schema>;

// ────────────────────────────── CONTRACT_ADDRESSES_JSON ────────────────────
//
// Operators can override deployed contract addresses without rebuilding the
// `@bufi/contracts` manifests by setting `CONTRACT_ADDRESSES_JSON` to a JSON
// string of the shape:
//
//   { "<chainId>": { "<contractName>": "0x<hex>" } }
//
// Example:
//   {"43113":{"feeCollector":"0x1234..."},"5042002":{"clearinghouse":"0xabc..."}}
//
// The parser validates shape at first call and caches the result. Callers go
// through `getContractAddressOverride(chainId, contractName)` and fall back to
// the deployment manifest baked into `@bufi/contracts` when no override exists.

export type Hex = `0x${string}`;
export type ContractAddressOverrides = Record<string, Record<string, Hex>>;

const hexAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 40-char hex address");

const contractAddressesJsonSchema = z.record(
  z.string().regex(/^\d+$/, "chain id keys must be numeric strings"),
  z.record(z.string().min(1), hexAddressSchema),
);

let _overridesCached: ContractAddressOverrides | null | undefined;

function loadContractAddressOverrides(): ContractAddressOverrides | null {
  if (_overridesCached !== undefined) return _overridesCached;
  const raw = serverEnv().CONTRACT_ADDRESSES_JSON;
  if (!raw) {
    _overridesCached = null;
    return _overridesCached;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `@bufi/env: CONTRACT_ADDRESSES_JSON is not valid JSON: ${(e as Error).message}`,
    );
  }
  const result = contractAddressesJsonSchema.safeParse(parsedJson);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`@bufi/env: invalid CONTRACT_ADDRESSES_JSON shape:\n${issues}`);
  }
  _overridesCached = result.data as ContractAddressOverrides;
  return _overridesCached;
}

/**
 * Lookup an env-provided address override for the given chain + contract.
 * Returns `undefined` when no override is configured — callers should fall
 * back to the deployment manifest in that case.
 */
export function getContractAddressOverride(
  chainId: number | string,
  contractName: string,
): Hex | undefined {
  const overrides = loadContractAddressOverrides();
  if (!overrides) return undefined;
  const chainKey = String(chainId);
  return overrides[chainKey]?.[contractName];
}

/**
 * Test-only escape hatch — clears the cached env + override parse. Avoid in
 * application code; required so unit tests can swap process.env between runs.
 */
export function __resetServerEnvCacheForTests(): void {
  _cached = null;
  _overridesCached = undefined;
}
