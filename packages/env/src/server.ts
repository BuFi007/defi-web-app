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

  // x402 / facilitator
  X402_FACILITATOR_URL: z.string().url().optional(),
  X402_NETWORK: z.string().optional(),
  X402_RECEIVER_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),

  // pricing / oracles
  MARKET_DATA_RPC_URL: z.string().url().optional(),

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
