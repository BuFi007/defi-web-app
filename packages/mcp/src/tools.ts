/**
 * Default tool registrations — the canonical list of workflows this
 * stack exposes to MCP clients. Schemas only; execution bodies live
 * in the consuming app or call into the domain packages.
 *
 * Tools that move money or hit the chain are marked
 * `requiresSignature: true`. Tools that read paid market data are
 * marked `requiresPaymentUsdc`.
 */

import { z } from "zod";

import type { ToolDefinition } from "./registry";

const addressLike = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const chainIdLike = z.union([z.literal(43113), z.literal(919), z.literal(5042002)]);

export const inspectPerpsMarketInput = z.object({
  chainId: chainIdLike,
  marketId: z.string().min(1),
});
export const inspectPerpsMarketOutput = z.object({
  marketId: z.string(),
  oracleTimestamp: z.number(),
  fundingBps: z.number(),
  openInterestUsdc: z.string(),
});

export const quotePerpInput = z.object({
  chainId: chainIdLike,
  marketId: z.string(),
  side: z.enum(["long", "short"]),
  sizeUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  leverage: z.number().int().min(1).max(50),
});
export const quotePerpOutput = z.object({
  indicativePrice: z.string(),
  estimatedFundingBps: z.number(),
  oracleTimestamp: z.number(),
});

export const createPerpIntentInput = z.object({
  chainId: chainIdLike,
  marketId: z.string(),
  trader: addressLike,
  side: z.enum(["long", "short"]),
  sizeUsdc: z.string(),
  leverage: z.number().int().min(1).max(50),
  deadline: z.number().int(),
  nonce: z.string(),
});
export const createPerpIntentOutput = z.object({
  intentId: z.string(),
  digest: z.string(),
});

export const createBentoRoomInput = z.object({
  chainId: chainIdLike,
  marketId: z.string(),
  entryFeeUsdc: z.string(),
  chipsPerPlayer: z.number().int().min(1).max(10_000),
  maxPlayers: z.number().int().min(2).max(64),
  startsAt: z.number().int(),
  endsAt: z.number().int(),
});
export const createBentoRoomOutput = z.object({ roomId: z.string() });

export const joinBentoRoomInput = z.object({
  roomId: z.string(),
  player: addressLike,
});
export const joinBentoRoomOutput = z.object({ ok: z.literal(true) });

export const settleBentoRoomInput = z.object({ roomId: z.string() });
export const settleBentoRoomOutput = z.object({
  winners: z.array(z.object({ player: addressLike, prizeUsdc: z.string() })),
});

export const inspectBentoRoomInput = z.object({ roomId: z.string() });
export const inspectBentoRoomOutput = z.object({
  roomId: z.string(),
  status: z.string(),
  players: z.array(addressLike),
});

export const inspectTelaranaMarketInput = z.object({
  chainId: chainIdLike,
  marketId: z.string(),
});
export const inspectTelaranaMarketOutput = z.object({
  marketId: z.string(),
  utilizationBps: z.number(),
  borrowApyBps: z.number(),
  supplyApyBps: z.number(),
});

export const inspectLoanPositionInput = z.object({
  borrower: addressLike,
  marketId: z.string(),
});
export const inspectLoanPositionOutput = z.object({
  positionId: z.string(),
  collateralAmount: z.string(),
  borrowAmount: z.string(),
  healthFactorBps: z.number(),
});

export const oracleFreshnessInput = z.object({
  chainId: chainIdLike,
  source: z.enum(["uniswap-v4", "pyth", "chainlink", "internal"]),
});
export const oracleFreshnessOutput = z.object({
  source: z.string(),
  lastUpdated: z.number(),
  ageSeconds: z.number(),
  stale: z.boolean(),
});

export const triggerIndexerSyncInput = z.object({
  scope: z.enum(["all", "perps", "arcade", "telarana"]).default("all"),
});
export const triggerIndexerSyncOutput = z.object({
  triggeredAt: z.number(),
});

/**
 * Build a default registry. Consumers wire `execute` bodies via
 * `registry.register`; this file only owns the schema/permission/gate
 * metadata so the surface stays declarative.
 */
export function defaultToolDescriptors(): Array<
  Omit<ToolDefinition<unknown, unknown>, "execute" | "canExecute">
> {
  return [
    {
      name: "perps.inspectMarket",
      description: "Read a perps market's current state from the indexer.",
      inputSchema: inspectPerpsMarketInput as unknown as ToolDefinition<unknown, unknown>["inputSchema"],
      outputSchema: inspectPerpsMarketOutput as unknown as ToolDefinition<unknown, unknown>["outputSchema"],
    },
    {
      name: "perps.quote",
      description: "Get a tradeable quote for a perp position. Paid: includes premium oracle simulation.",
      inputSchema: quotePerpInput as unknown as ToolDefinition<unknown, unknown>["inputSchema"],
      outputSchema: quotePerpOutput as unknown as ToolDefinition<unknown, unknown>["outputSchema"],
      requiresPaymentUsdc: "0.0010",
    },
    {
      name: "perps.createIntent",
      description: "Build an EIP-712 trade intent and return the digest for the trader to sign.",
      inputSchema: createPerpIntentInput as unknown as ToolDefinition<unknown, unknown>["inputSchema"],
      outputSchema: createPerpIntentOutput as unknown as ToolDefinition<unknown, unknown>["outputSchema"],
      requiresSignature: true,
    },
    {
      name: "bento.createRoom",
      description: "Create an FX² Arcade room. Paid: room creation fee.",
      inputSchema: createBentoRoomInput as unknown as ToolDefinition<unknown, unknown>["inputSchema"],
      outputSchema: createBentoRoomOutput as unknown as ToolDefinition<unknown, unknown>["outputSchema"],
      requiresPaymentUsdc: "0.5000",
    },
    {
      name: "bento.joinRoom",
      description: "Join an FX² Arcade room. Caller signs entry-fee transfer onchain — runner returns digest.",
      inputSchema: joinBentoRoomInput as unknown as ToolDefinition<unknown, unknown>["inputSchema"],
      outputSchema: joinBentoRoomOutput as unknown as ToolDefinition<unknown, unknown>["outputSchema"],
      requiresSignature: true,
    },
    {
      name: "bento.settle",
      description: "Settle an FX² Arcade room and pay winners from escrow.",
      inputSchema: settleBentoRoomInput as unknown as ToolDefinition<unknown, unknown>["inputSchema"],
      outputSchema: settleBentoRoomOutput as unknown as ToolDefinition<unknown, unknown>["outputSchema"],
    },
    {
      name: "bento.inspectRoom",
      description: "Read a room's current state from the indexer.",
      inputSchema: inspectBentoRoomInput as unknown as ToolDefinition<unknown, unknown>["inputSchema"],
      outputSchema: inspectBentoRoomOutput as unknown as ToolDefinition<unknown, unknown>["outputSchema"],
    },
    {
      name: "telarana.inspectMarket",
      description: "Inspect an FX Telaraña lending market.",
      inputSchema: inspectTelaranaMarketInput as unknown as ToolDefinition<unknown, unknown>["inputSchema"],
      outputSchema: inspectTelaranaMarketOutput as unknown as ToolDefinition<unknown, unknown>["outputSchema"],
    },
    {
      name: "telarana.inspectLoan",
      description: "Inspect a single borrower's loan position.",
      inputSchema: inspectLoanPositionInput as unknown as ToolDefinition<unknown, unknown>["inputSchema"],
      outputSchema: inspectLoanPositionOutput as unknown as ToolDefinition<unknown, unknown>["outputSchema"],
    },
    {
      name: "oracle.freshness",
      description: "Check oracle freshness — agent should refuse to trade on stale data.",
      inputSchema: oracleFreshnessInput as unknown as ToolDefinition<unknown, unknown>["inputSchema"],
      outputSchema: oracleFreshnessOutput as unknown as ToolDefinition<unknown, unknown>["outputSchema"],
    },
    {
      name: "indexer.sync",
      description: "Trigger a safe indexer resync.",
      inputSchema: triggerIndexerSyncInput as unknown as ToolDefinition<unknown, unknown>["inputSchema"],
      outputSchema: triggerIndexerSyncOutput as unknown as ToolDefinition<unknown, unknown>["outputSchema"],
    },
  ];
}
