import { z } from "zod";

export const chainIdSchema = z.union([
  z.literal(43113),
  z.literal(919),
  z.literal(5042002),
]);

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const bytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
export const usdcAmountSchema = z.string().regex(/^\d+(\.\d{1,6})?$/);

export const createRoomRequest = z.object({
  chainId: chainIdSchema,
  marketId: z.string().min(1),
  entryFeeUsdc: usdcAmountSchema,
  chipsPerPlayer: z.number().int().min(1).max(10_000),
  maxPlayers: z.number().int().min(2).max(64),
  startsAt: z.number().int(),
  endsAt: z.number().int(),
  /** Bps the protocol keeps. Hard-capped — protocol must never take uncapped risk. */
  rakeBps: z.number().int().min(0).max(2000),
});

export const createRoomResponse = z.object({
  roomId: z.string(),
  escrowAddress: addressSchema,
});

export const joinRoomRequest = z.object({
  roomId: z.string(),
  player: addressSchema,
});

export const joinRoomResponse = z.object({
  roomId: z.string(),
  /** EIP-712 digest the player signs to authorize the entry-fee transfer. */
  digest: bytes32Schema,
  deadline: z.number().int(),
});

export const commitRequest = z.object({
  roomId: z.string(),
  player: addressSchema,
  /** keccak256(abi.encode(salt, tileId, chips)). */
  commitment: bytes32Schema,
});

export const revealRequest = z.object({
  roomId: z.string(),
  player: addressSchema,
  salt: bytes32Schema,
  tileId: z.string(),
  chips: z.number().int().min(1),
});

export const settleRequest = z.object({ roomId: z.string() });

export const settleResponse = z.object({
  roomId: z.string(),
  totalPrizePoolUsdc: usdcAmountSchema,
  rakeUsdc: usdcAmountSchema,
  winners: z.array(
    z.object({
      player: addressSchema,
      score: z.number().int(),
      prizeUsdc: usdcAmountSchema,
    }),
  ),
});

export type CreateRoomRequest = z.infer<typeof createRoomRequest>;
export type CreateRoomResponse = z.infer<typeof createRoomResponse>;
export type JoinRoomRequest = z.infer<typeof joinRoomRequest>;
export type JoinRoomResponse = z.infer<typeof joinRoomResponse>;
export type CommitRequest = z.infer<typeof commitRequest>;
export type RevealRequest = z.infer<typeof revealRequest>;
export type SettleRequest = z.infer<typeof settleRequest>;
export type SettleResponse = z.infer<typeof settleResponse>;
