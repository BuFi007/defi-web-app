/**
 * FX² Arcade HTTP surface. Ported from fx-bento monorepo's
 * `apps/api/src/routes/fx-bento.ts`.
 *
 * Conventions kept from the source:
 *   - `/prepare` and the bare verb both return tx calldata + safety report.
 *   - `/dev/*` mirrors the prod surface but pokes the in-memory simulator,
 *     so the same client code can exercise lifecycle transitions without
 *     onchain state. Gated by NODE_ENV.
 *   - Auth: wallet-session middleware is already mounted globally in
 *     `apps/api/src/server.ts`. Endpoints that mutate require a session.
 */

import { getBentoRpcUrl } from "@bufi/contracts/bento";
import {
  CommitSelectionSchema,
  CreateFxBentoRoomSchema,
  JoinFxBentoRoomSchema,
  OnchainRoomConfigSchema,
  RevealSelectionSchema,
  SettleFxBentoRoomSchema,
  SettlementPayoutRootSchema,
  TileSelectionSchema,
  commitFxBentoSelection,
  createFxBentoPublicClient,
  createFxBentoRoom,
  getFxBentoClaimProof,
  getFxBentoLeaderboard,
  getFxBentoRoom,
  joinFxBentoRoom,
  listFxBentoRooms,
  prepareClaimPrizeTransaction,
  prepareCommitSelectionTransaction,
  prepareCreateRoomTransaction,
  prepareFinalizeResultsTransaction,
  prepareJoinRoomTransaction,
  prepareLeaveRoomTransaction,
  prepareRefundTransaction,
  prepareRevealSelectionTransaction,
  prepareSubmitResultsTransaction,
  revealFxBentoSelection,
  safetyCheckFxBentoTransaction,
  serializeTransactionRequest,
  settleFxBentoRoom,
  HexSchema as BentoHexSchema,
  type FxBentoContractEngineConfig,
  type FxBentoTransactionRequest,
} from "@bufi/fx-bento";
import type { WalletSession } from "@bufi/shared-types";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import { errorStatus } from "../services";

const fxBentoRoutes = new Hono();

// ---------- request schemas ----------

const ChainQuerySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
});

const CommitTransactionSchema = z.object({
  roundIndex: z.coerce.number().int().min(0),
  commitment: BentoHexSchema,
});

const RevealTransactionSchema = z.object({
  roundIndex: z.coerce.number().int().min(0),
  selection: TileSelectionSchema,
  nonce: BentoHexSchema,
});

const SubmitResultsSchema = z.object({
  resultsRoot: BentoHexSchema,
  metadataURI: z.string().min(1).default("ipfs://pending"),
  payout: SettlementPayoutRootSchema,
  attestation: BentoHexSchema.optional(),
});

const RoomClaimSchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  amount: z
    .union([z.string().regex(/^\d+$/), z.number().int().nonnegative(), z.bigint()])
    .optional(),
  proof: z.array(BentoHexSchema).optional(),
});

// ---------- helpers ----------

const DEFAULT_CHAIN_ID = 43113;

function engineFromQuery(chainId?: number): FxBentoContractEngineConfig {
  const resolvedChainId =
    chainId ?? Number(process.env.FX_BENTO_CHAIN_ID ?? DEFAULT_CHAIN_ID);
  return { chainId: resolvedChainId };
}

async function parseBody<T>(c: Context, schema: z.ZodType<T>) {
  const raw = await c.req.json().catch(() => ({}));
  return schema.safeParse(raw);
}

function parseChainQuery(reqUrl: string) {
  return ChainQuerySchema.parse(Object.fromEntries(new URL(reqUrl).searchParams));
}

async function transactionPayload(
  engine: FxBentoContractEngineConfig,
  request: FxBentoTransactionRequest,
  options: { roomId?: string } = {},
) {
  const rpcUrl = getBentoRpcUrl(engine.chainId);
  const client = rpcUrl
    ? createFxBentoPublicClient({ chainId: engine.chainId, rpcUrl })
    : undefined;
  const safety = await safetyCheckFxBentoTransaction({
    engine,
    request,
    roomId: options.roomId,
    indexedRoom: null,
    client,
  });
  return { transaction: serializeTransactionRequest(request), safety };
}

function assertDevSimulatorEnabled() {
  const env = process.env.NODE_ENV ?? "development";
  if (env !== "development" && env !== "test") {
    throw new Error("dev_simulator_disabled");
  }
}

function simulatorFallbackRoom(id: string) {
  return getFxBentoRoom(id);
}

// ---------- routes ----------

fxBentoRoutes.get("/rooms", async (c) => {
  return c.json({ rooms: listFxBentoRooms() });
});

fxBentoRoutes.post("/rooms/prepare", async (c) => {
  const parsed = await parseBody(c, OnchainRoomConfigSchema);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  try {
    const engine = engineFromQuery(parseChainQuery(c.req.url).chainId);
    const request = prepareCreateRoomTransaction(engine, parsed.data);
    const payload = await transactionPayload(engine, request);
    c.var.log.info("route_ok");
    return c.json(payload);
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/rooms", async (c) => {
  const parsed = await parseBody(c, OnchainRoomConfigSchema);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  try {
    const engine = engineFromQuery(parseChainQuery(c.req.url).chainId);
    const request = prepareCreateRoomTransaction(engine, parsed.data);
    const payload = await transactionPayload(engine, request);
    c.var.log.info("route_ok");
    return c.json(payload);
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/dev/rooms", async (c) => {
  try {
    assertDevSimulatorEnabled();
    const parsed = await parseBody(c, CreateFxBentoRoomSchema);
    if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
    c.var.log.info("route_ok");
    return c.json(createFxBentoRoom(parsed.data), 201);
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.get("/rooms/:id", async (c) => {
  const room = simulatorFallbackRoom(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  return c.json(room);
});

fxBentoRoutes.get("/rooms/:id/players", async (c) => {
  const room = simulatorFallbackRoom(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  return c.json({ players: room.players });
});

fxBentoRoutes.get("/rooms/:id/rounds", async (c) => {
  const room = simulatorFallbackRoom(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  return c.json({ rounds: room.rounds });
});

fxBentoRoutes.post("/rooms/:id/join", async (c) => {
  try {
    const engine = engineFromQuery(parseChainQuery(c.req.url).chainId);
    const request = prepareJoinRoomTransaction(engine, c.req.param("id"));
    const payload = await transactionPayload(engine, request, { roomId: c.req.param("id") });
    c.var.log.info("route_ok");
    return c.json(payload);
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/rooms/:id/join/prepare", async (c) => {
  try {
    const engine = engineFromQuery(parseChainQuery(c.req.url).chainId);
    const request = prepareJoinRoomTransaction(engine, c.req.param("id"));
    const payload = await transactionPayload(engine, request, { roomId: c.req.param("id") });
    c.var.log.info("route_ok");
    return c.json(payload);
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/dev/rooms/:id/join", async (c) => {
  try {
    assertDevSimulatorEnabled();
    const session = c.get("walletSession") as WalletSession | null;
    if (!session) return c.json({ error: "wallet session required" }, 401);
    const parsed = await parseBody(c, JoinFxBentoRoomSchema);
    if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
    c.var.log.info("route_ok");
    return c.json(joinFxBentoRoom(c.req.param("id"), parsed.data));
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/rooms/:id/leave", async (c) => {
  try {
    const engine = engineFromQuery(parseChainQuery(c.req.url).chainId);
    const request = prepareLeaveRoomTransaction(engine, c.req.param("id"));
    const payload = await transactionPayload(engine, request, { roomId: c.req.param("id") });
    c.var.log.info("route_ok");
    return c.json(payload);
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/rooms/:id/refund", async (c) => {
  try {
    const engine = engineFromQuery(parseChainQuery(c.req.url).chainId);
    const request = prepareRefundTransaction(engine, c.req.param("id"));
    const payload = await transactionPayload(engine, request, { roomId: c.req.param("id") });
    c.var.log.info("route_ok");
    return c.json(payload);
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/rooms/:id/refund/prepare", async (c) => {
  try {
    const engine = engineFromQuery(parseChainQuery(c.req.url).chainId);
    const request = prepareRefundTransaction(engine, c.req.param("id"));
    const payload = await transactionPayload(engine, request, { roomId: c.req.param("id") });
    c.var.log.info("route_ok");
    return c.json(payload);
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/rooms/:id/commit", async (c) => {
  try {
    const parsed = await parseBody(c, CommitTransactionSchema);
    if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
    const engine = engineFromQuery(parseChainQuery(c.req.url).chainId);
    const request = prepareCommitSelectionTransaction(engine, {
      roomId: c.req.param("id"),
      roundIndex: parsed.data.roundIndex,
      commitment: parsed.data.commitment,
    });
    const payload = await transactionPayload(engine, request, { roomId: c.req.param("id") });
    c.var.log.info("route_ok");
    return c.json(payload);
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/dev/rooms/:id/commit", async (c) => {
  try {
    assertDevSimulatorEnabled();
    const parsed = await parseBody(c, CommitSelectionSchema);
    if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
    c.var.log.info("route_ok");
    return c.json(commitFxBentoSelection(c.req.param("id"), parsed.data));
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/rooms/:id/reveal", async (c) => {
  try {
    const parsed = await parseBody(c, RevealTransactionSchema);
    if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
    const engine = engineFromQuery(parseChainQuery(c.req.url).chainId);
    const request = prepareRevealSelectionTransaction(engine, {
      roomId: c.req.param("id"),
      roundIndex: parsed.data.roundIndex,
      selection: parsed.data.selection,
      nonce: parsed.data.nonce,
    });
    const payload = await transactionPayload(engine, request, { roomId: c.req.param("id") });
    c.var.log.info("route_ok");
    return c.json(payload);
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/dev/rooms/:id/reveal", async (c) => {
  try {
    assertDevSimulatorEnabled();
    const parsed = await parseBody(c, RevealSelectionSchema);
    if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
    c.var.log.info("route_ok");
    return c.json(revealFxBentoSelection(c.req.param("id"), parsed.data));
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.get("/rooms/:id/leaderboard", async (c) => {
  const room = simulatorFallbackRoom(c.req.param("id"));
  if (!room) return c.json({ error: "room_not_found" }, 404);
  return c.json({ leaderboard: getFxBentoLeaderboard(room.id), source: "simulator" });
});

fxBentoRoutes.post("/rooms/:id/settle", async (c) => {
  try {
    const parsed = await parseBody(c, SubmitResultsSchema);
    if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
    const engine = engineFromQuery(parseChainQuery(c.req.url).chainId);
    const request = prepareSubmitResultsTransaction(engine, {
      roomId: c.req.param("id"),
      resultsRoot: parsed.data.resultsRoot,
      metadataURI: parsed.data.metadataURI ?? "ipfs://pending",
      payout: parsed.data.payout,
      attestation: parsed.data.attestation,
    });
    const payload = await transactionPayload(engine, request, { roomId: c.req.param("id") });
    c.var.log.info("route_ok");
    return c.json(payload);
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/rooms/:id/finalize", async (c) => {
  try {
    const engine = engineFromQuery(parseChainQuery(c.req.url).chainId);
    const request = prepareFinalizeResultsTransaction(engine, c.req.param("id"));
    const payload = await transactionPayload(engine, request, { roomId: c.req.param("id") });
    c.var.log.info("route_ok");
    return c.json(payload);
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/dev/rooms/:id/settle", async (c) => {
  try {
    assertDevSimulatorEnabled();
    const parsed = await parseBody(c, SettleFxBentoRoomSchema);
    if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
    c.var.log.info("route_ok");
    return c.json(settleFxBentoRoom(c.req.param("id"), parsed.data));
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.get("/rooms/:id/claims/:address", async (c) => {
  try {
    const query = parseChainQuery(c.req.url);
    const chainId = query.chainId ?? engineFromQuery().chainId;
    const proof = await getFxBentoClaimProof({
      chainId,
      roomId: c.req.param("id"),
      player: c.req.param("address"),
    });
    return c.json({
      roomId: c.req.param("id"),
      address: c.req.param("address").toLowerCase(),
      claimable: !!proof?.finalized,
      claimed: false,
      amount: proof?.amount ?? "0",
      proof: proof?.proof ?? [],
      proofReady: !!proof?.proofReady,
      settlementRoot: proof?.settlementRoot ?? null,
      source: proof ? "settlement_result_store" : "simulator",
    });
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

fxBentoRoutes.post("/rooms/:id/claim", async (c) => {
  try {
    const parsed = await parseBody(c, RoomClaimSchema);
    if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
    const engine = engineFromQuery(parsed.data.chainId);
    const session = c.get("walletSession") as WalletSession | null;
    const player = session?.address;
    const proof = player
      ? await getFxBentoClaimProof({
          chainId: engine.chainId,
          roomId: c.req.param("id"),
          player,
        })
      : null;
    const amount = parsed.data.amount ?? proof?.amount;
    const proofItems = parsed.data.proof ?? proof?.proof;
    if (amount === undefined || proofItems === undefined) {
      return c.json({ error: "claim_proof_not_ready" }, 409);
    }
    const request = prepareClaimPrizeTransaction(engine, {
      roomId: c.req.param("id"),
      amount,
      proof: proofItems,
    });
    const payload = await transactionPayload(engine, request, { roomId: c.req.param("id") });
    c.var.log.info("route_ok");
    return c.json(payload);
  } catch (e) {
    c.var.log.error("route_error", { err: (e as Error).message });
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

export { fxBentoRoutes };
