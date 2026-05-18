/**
 * FX² Arcade / FX Bento event handlers.
 *
 * Subscribed contracts (both Arc Testnet + Avalanche Fuji — addresses sourced
 * from packages/contracts/deployments/bento-{arc-testnet,avalanche-fuji}.json
 * and registered in ponder.config.ts):
 *   FXBentoRoomFactory        → BentoRoomFactory{Arc,Fuji}
 *   FXBentoRoomEscrow         → BentoRoomEscrow{Arc,Fuji}
 *   FXBentoCommitmentManager  → BentoCommitmentManager{Arc,Fuji}
 *   FXBentoRoundManager       → BentoRoundManager{Arc,Fuji}
 *   FXBentoSettlementManager  → BentoSettlementManager{Arc,Fuji}
 *
 * Event → table mapping (event names are the literal ones declared in the
 * packages/contracts/src/abis/FxBento*.ts ABI files):
 *
 *   FXBentoRoomFactory:
 *     RoomCreated(roomId, poolId, entryToken, entryFee)
 *       → arcadeRoom insert (status='lobby'). The contract-read pulls the
 *         rest of the room config (rounds, roundDuration, lockBuffer,
 *         minPlayers, maxPlayers, startTime, rakeBps, gridConfigHash,
 *         payoutHash, isPrivate) — mirroring the perps.ts position-read
 *         pattern. `chipsPerPlayer` is a client-side concept (chip count
 *         is committed per round in commitSelection), so we default it to
 *         0 here and let the API derive it from CommitmentManager events.
 *     RoomStatusUpdated(roomId, status)
 *       → arcadeRoom patch (status enum: lobby/locked/settling/settled/
 *         finalized/cancelled — derived from uint8)
 *
 *   FXBentoRoomEscrow:
 *     RoomJoined(roomId, player)
 *       → arcadePlacement insert (id=`${roomId}:${player}:_pending`,
 *         tileId='_pending' until reveal)
 *     RoomLeft(roomId, player)
 *       → arcadePlacement patch (leftAt set)
 *     RoomCancelled(roomId)
 *       → arcadeRoom patch (status='cancelled', cancelledAt set)
 *     RoomLocked(roomId, escrowed)
 *       → arcadeRoom patch (status='locked', prizePoolUsdc=escrowed,
 *         lockedAt set)
 *     RoomSettled(roomId, resultsRoot, payoutSchemaHash, payoutTotal,
 *                 protocolFee)
 *       → arcadeRoom patch (status='settled', resultsRoot snapshot,
 *         payoutTotal/protocolFee written, rakeBps derived if missing)
 *     Refunded(roomId, player, amount)
 *       → arcadePlacement patch (refundedAt + refundedAmount)
 *     PrizeClaimed(roomId, player, amount)
 *       → arcadePlacement patch (claimedAt + claimedTxHash + prizeAmount)
 *
 *   FXBentoCommitmentManager:
 *     SelectionCommitted(roomId, roundIndex, player, commitment)
 *       → arcadePlacement upsert (commitment + commitmentTxHash, roundIndex
 *         tagged on the row — placement ID is per-room/player so multiple
 *         round commitments overwrite the latest commitment field)
 *     SelectionRevealed(roomId, roundIndex, player, selectedTilesHash)
 *       → arcadePlacement patch (revealedAt + revealedSelectionHash +
 *         revealedTxHash; tileId set to short hash so the UI can render
 *         distinct placements per round)
 *
 *   FXBentoRoundManager:
 *     RoundStarted(roomId, roundIndex, startTime, lockTime, endTime,
 *                  anchorSnapshotId)
 *       → arcadeRound upsert (status='started')
 *     AnchorRecorded(roomId, roundIndex, price, snapshotId)
 *       → arcadeRound patch (anchorPrice + anchorSnapshotId,
 *         status='anchor_recorded')
 *     SettlementRecorded(roomId, roundIndex, price, snapshotId)
 *       → arcadeRound patch (settlementPrice + settlementSnapshotId,
 *         status='settled')
 *
 *   FXBentoSettlementManager:
 *     ResultsSubmitted(roomId, resultsRoot, metadataURI)
 *       → arcadeSettlement insert (stage='submitted') + arcadeRoom patch
 *         (status='settling', resultsRoot, metadataURI)
 *     ResultsChallenged(roomId, proof)
 *       → arcadeSettlement insert (stage='challenged')
 *     ChallengeResolved(roomId, accepted)
 *       → arcadeSettlement insert (stage='resolved', challengeAccepted)
 *     ResultsFinalized(roomId, resultsRoot)
 *       → arcadeSettlement insert (stage='finalized') + arcadeRoom patch
 *         (status='finalized', finalizedAt)
 *     SettlementRescued(roomId)
 *       → arcadeSettlement insert (stage='rescued')
 *
 * Events deliberately NOT indexed (low-signal admin/governance):
 *   FXBentoRoomFactory: EntryTokenAllowed, LimitsUpdated, EscrowUpdated
 *   FXBentoRoomEscrow:  SettlementManagerUpdated, ProtocolFeeClaimed
 *                       (treasury-internal, surfaced via fee vault later)
 *   FXBentoSettlementManager: SettlementRescueDelayUpdated
 *
 * Idempotency: every handler uses db.find + db.update (or
 * onConflictDoUpdate / onConflictDoNothing) and gates status regression
 * via STATUS_RANK so out-of-order delivery doesn't roll the room back.
 *
 * bigint → pglite mapping: arcadeRound prices are int256 (can be negative);
 * we store them as decimal strings in `text` columns to round-trip safely
 * through pglite. All other bigint columns use the native `t.bigint()`
 * mapping (drizzle handles the TEXT under the hood on pglite).
 *
 * Money invariant validated on RoomSettled: payoutTotal + protocolFee ==
 * sum(prizeClaimed) — left for an API-layer sanity check once these rows
 * accumulate (the handler simply stores the snapshot).
 */
import { ponder } from "ponder:registry";
import type { Context } from "ponder:registry";
import {
  arcadePlacement,
  arcadeRoom,
  arcadeRound,
  arcadeSettlement,
} from "ponder:schema";
import type { Address, Hex } from "viem";

import { FxBentoRoomFactoryAbi } from "@bufi/contracts/bento";
import { lowerHex } from "@bufi/shared-types/hex";

// ─────────────────────────── Type aliases ──────────────────────────────────

type FactoryContractName = "BentoRoomFactoryArc" | "BentoRoomFactoryFuji";
type EscrowContractName = "BentoRoomEscrowArc" | "BentoRoomEscrowFuji";
type CommitmentContractName = "BentoCommitmentManagerArc" | "BentoCommitmentManagerFuji";
type RoundContractName = "BentoRoundManagerArc" | "BentoRoundManagerFuji";
type SettlementContractName =
  | "BentoSettlementManagerArc"
  | "BentoSettlementManagerFuji";

type RoomStatusFromContract =
  | "lobby"
  | "locked"
  | "settling"
  | "settled"
  | "finalized"
  | "cancelled";

const ROOM_STATUS_RANK: Record<RoomStatusFromContract, number> = {
  lobby: 1,
  locked: 2,
  settling: 3,
  settled: 4,
  finalized: 5,
  cancelled: 6,
};

const ROOM_STATUS_BY_ENUM: Record<number, RoomStatusFromContract> = {
  0: "lobby",
  1: "locked",
  2: "settling",
  3: "settled",
  4: "finalized",
  5: "cancelled",
};

// ────────────────────── FXBentoRoomFactory handlers ────────────────────────

for (const contractName of [
  "BentoRoomFactoryArc",
  "BentoRoomFactoryFuji",
] as const satisfies readonly FactoryContractName[]) {
  ponder.on(`${contractName}:RoomCreated`, async ({ event, context }) => {
    const id = roomKey(event.args.roomId);
    const config = await readRoomConfig({
      context,
      contractName,
      roomId: event.args.roomId,
      blockNumber: event.block.number,
    });

    const startTime = config?.startTime ?? 0n;
    const rounds = config?.rounds ?? 0;
    const roundDuration = config?.roundDuration ?? 0;
    const lockBuffer = config?.lockBuffer ?? 0;
    const endsAt = startTime + BigInt(rounds) * BigInt(roundDuration + lockBuffer);

    const row = {
      roomId: id,
      chainId: context.chain.id,
      marketId: lowerHex(event.args.poolId),
      entryFeeUsdc: event.args.entryFee,
      // chipsPerPlayer is a client/grid concept (chip count is committed
      // per round, not at creation) — default to 0; UI can hydrate via
      // CommitmentManager events.
      chipsPerPlayer: 0,
      maxPlayers: config?.maxPlayers ?? 0,
      status: "lobby" as RoomStatusFromContract,
      startsAt: startTime,
      endsAt,
      prizePoolUsdc: 0n,
      rakeBps: config?.rakeBps ?? 0,
      poolId: lowerHex(event.args.poolId),
      entryToken: lowerHex(event.args.entryToken),
      minPlayers: config?.minPlayers ?? null,
      rounds: config?.rounds ?? null,
      roundDuration: config?.roundDuration ?? null,
      lockBuffer: config?.lockBuffer ?? null,
      gridConfigHash: config?.gridConfigHash ?? null,
      payoutHash: config?.payoutHash ?? null,
      isPrivate: config?.isPrivate ?? null,
      lockedAt: null,
      settledAt: null,
      finalizedAt: null,
      cancelledAt: null,
      resultsRoot: null,
      payoutSchemaHash: null,
      payoutTotal: null,
      protocolFee: null,
      metadataURI: null,
      eventBlock: event.block.number,
      eventTxHash: lowerHex(event.transaction.hash),
      eventLogIndex: event.log.logIndex,
      updatedAt: event.block.timestamp,
    };

    await context.db.insert(arcadeRoom).values(row).onConflictDoNothing();
  });

  ponder.on(`${contractName}:RoomStatusUpdated`, async ({ event, context }) => {
    const next = ROOM_STATUS_BY_ENUM[Number(event.args.status)];
    if (!next) return;
    await patchRoom({
      context,
      roomId: event.args.roomId,
      patch: { status: next, updatedAt: event.block.timestamp },
      block: event.block,
      tx: event.transaction,
      logIndex: event.log.logIndex,
    });
  });
}

// ─────────────────────── FXBentoRoomEscrow handlers ────────────────────────

for (const contractName of [
  "BentoRoomEscrowArc",
  "BentoRoomEscrowFuji",
] as const satisfies readonly EscrowContractName[]) {
  ponder.on(`${contractName}:RoomJoined`, async ({ event, context }) => {
    const id = placementKey({
      roomId: event.args.roomId,
      player: event.args.player,
      tileId: "_pending",
    });
    await context.db
      .insert(arcadePlacement)
      .values({
        id,
        roomId: roomKey(event.args.roomId),
        player: lowerHex(event.args.player),
        tileId: "_pending",
        chips: 0,
        commitment: null,
        revealedAt: null,
        chainId: context.chain.id,
        roundIndex: null,
        joinedAt: event.block.timestamp,
        joinedTxHash: lowerHex(event.transaction.hash),
        leftAt: null,
        refundedAt: null,
        refundedAmount: null,
        commitmentTxHash: null,
        revealedSelectionHash: null,
        revealedTxHash: null,
        prizeAmount: null,
        claimedAt: null,
        claimedTxHash: null,
        eventBlock: event.block.number,
        eventTxHash: lowerHex(event.transaction.hash),
        eventLogIndex: event.log.logIndex,
      })
      .onConflictDoNothing();
  });

  ponder.on(`${contractName}:RoomLeft`, async ({ event, context }) => {
    await patchPlacement({
      context,
      roomId: event.args.roomId,
      player: event.args.player,
      tileId: "_pending",
      patch: { leftAt: event.block.timestamp },
    });
  });

  ponder.on(`${contractName}:RoomCancelled`, async ({ event, context }) => {
    await patchRoom({
      context,
      roomId: event.args.roomId,
      patch: {
        status: "cancelled",
        cancelledAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      },
      block: event.block,
      tx: event.transaction,
      logIndex: event.log.logIndex,
    });
  });

  ponder.on(`${contractName}:RoomLocked`, async ({ event, context }) => {
    await patchRoom({
      context,
      roomId: event.args.roomId,
      patch: {
        status: "locked",
        prizePoolUsdc: event.args.escrowed,
        lockedAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      },
      block: event.block,
      tx: event.transaction,
      logIndex: event.log.logIndex,
    });
  });

  ponder.on(`${contractName}:RoomSettled`, async ({ event, context }) => {
    const rakeBps = computeRakeBps({
      payoutTotal: event.args.payoutTotal,
      protocolFee: event.args.protocolFee,
    });
    await patchRoom({
      context,
      roomId: event.args.roomId,
      patch: {
        status: "settled",
        resultsRoot: lowerHex(event.args.resultsRoot),
        payoutSchemaHash: lowerHex(event.args.payoutSchemaHash),
        payoutTotal: event.args.payoutTotal,
        protocolFee: event.args.protocolFee,
        settledAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
        ...(rakeBps !== null ? { rakeBps } : {}),
      },
      block: event.block,
      tx: event.transaction,
      logIndex: event.log.logIndex,
    });
  });

  ponder.on(`${contractName}:Refunded`, async ({ event, context }) => {
    await patchPlacement({
      context,
      roomId: event.args.roomId,
      player: event.args.player,
      tileId: "_pending",
      patch: {
        refundedAt: event.block.timestamp,
        refundedAmount: event.args.amount,
      },
    });
  });

  ponder.on(`${contractName}:PrizeClaimed`, async ({ event, context }) => {
    await patchPlacement({
      context,
      roomId: event.args.roomId,
      player: event.args.player,
      tileId: "_pending",
      patch: {
        prizeAmount: event.args.amount,
        claimedAt: event.block.timestamp,
        claimedTxHash: lowerHex(event.transaction.hash),
      },
    });
  });
}

// ─────────────────── FXBentoCommitmentManager handlers ─────────────────────

for (const contractName of [
  "BentoCommitmentManagerArc",
  "BentoCommitmentManagerFuji",
] as const satisfies readonly CommitmentContractName[]) {
  ponder.on(`${contractName}:SelectionCommitted`, async ({ event, context }) => {
    const id = placementKey({
      roomId: event.args.roomId,
      player: event.args.player,
      tileId: "_pending",
    });
    const existing = await context.db.find(arcadePlacement, { id });
    const patch = {
      commitment: lowerHex(event.args.commitment),
      commitmentTxHash: lowerHex(event.transaction.hash),
      roundIndex: Number(event.args.roundIndex),
      chainId: context.chain.id,
      eventBlock: event.block.number,
      eventTxHash: lowerHex(event.transaction.hash),
      eventLogIndex: event.log.logIndex,
    };
    if (existing) {
      await context.db.update(arcadePlacement, { id }).set(patch);
    } else {
      // Commit landed before RoomJoined (partial backfill / re-org) — seed
      // a minimal placement row so the commitment is preserved.
      await context.db.insert(arcadePlacement).values({
        id,
        roomId: roomKey(event.args.roomId),
        player: lowerHex(event.args.player),
        tileId: "_pending",
        chips: 0,
        ...patch,
        revealedAt: null,
        joinedAt: null,
        joinedTxHash: null,
        leftAt: null,
        refundedAt: null,
        refundedAmount: null,
        revealedSelectionHash: null,
        revealedTxHash: null,
        prizeAmount: null,
        claimedAt: null,
        claimedTxHash: null,
      });
    }
  });

  ponder.on(`${contractName}:SelectionRevealed`, async ({ event, context }) => {
    await patchPlacement({
      context,
      roomId: event.args.roomId,
      player: event.args.player,
      tileId: "_pending",
      patch: {
        revealedAt: event.block.timestamp,
        revealedSelectionHash: lowerHex(event.args.selectedTilesHash),
        revealedTxHash: lowerHex(event.transaction.hash),
        roundIndex: Number(event.args.roundIndex),
      },
      seedOnMissing: {
        roomId: roomKey(event.args.roomId),
        player: lowerHex(event.args.player),
        tileId: "_pending",
        chainId: context.chain.id,
      },
    });
  });
}

// ───────────────────── FXBentoRoundManager handlers ────────────────────────

for (const contractName of [
  "BentoRoundManagerArc",
  "BentoRoundManagerFuji",
] as const satisfies readonly RoundContractName[]) {
  ponder.on(`${contractName}:RoundStarted`, async ({ event, context }) => {
    const id = roundKey(event.args.roomId, event.args.roundIndex);
    const row = {
      id,
      roomId: roomKey(event.args.roomId),
      chainId: context.chain.id,
      roundIndex: Number(event.args.roundIndex),
      startTime: BigInt(event.args.startTime),
      lockTime: BigInt(event.args.lockTime),
      endTime: BigInt(event.args.endTime),
      anchorSnapshotId: event.args.anchorSnapshotId,
      anchorPrice: null as string | null,
      settlementSnapshotId: null as bigint | null,
      settlementPrice: null as string | null,
      status: "started" as const,
      eventBlock: event.block.number,
      eventTxHash: lowerHex(event.transaction.hash),
      eventLogIndex: event.log.logIndex,
      updatedAt: event.block.timestamp,
    };
    await context.db
      .insert(arcadeRound)
      .values(row)
      .onConflictDoUpdate({
        startTime: row.startTime,
        lockTime: row.lockTime,
        endTime: row.endTime,
        anchorSnapshotId: row.anchorSnapshotId,
        status: row.status,
        updatedAt: row.updatedAt,
      });
  });

  ponder.on(`${contractName}:AnchorRecorded`, async ({ event, context }) => {
    const id = roundKey(event.args.roomId, event.args.roundIndex);
    const existing = await context.db.find(arcadeRound, { id });
    const patch = {
      anchorPrice: event.args.price.toString(),
      anchorSnapshotId: event.args.snapshotId,
      status: "anchor_recorded" as const,
      updatedAt: event.block.timestamp,
      eventBlock: event.block.number,
      eventTxHash: lowerHex(event.transaction.hash),
      eventLogIndex: event.log.logIndex,
    };
    if (existing) {
      await context.db.update(arcadeRound, { id }).set(patch);
    } else {
      await context.db.insert(arcadeRound).values({
        id,
        roomId: roomKey(event.args.roomId),
        chainId: context.chain.id,
        roundIndex: Number(event.args.roundIndex),
        startTime: null,
        lockTime: null,
        endTime: null,
        settlementSnapshotId: null,
        settlementPrice: null,
        ...patch,
      });
    }
  });

  ponder.on(`${contractName}:SettlementRecorded`, async ({ event, context }) => {
    const id = roundKey(event.args.roomId, event.args.roundIndex);
    const existing = await context.db.find(arcadeRound, { id });
    const patch = {
      settlementPrice: event.args.price.toString(),
      settlementSnapshotId: event.args.snapshotId,
      status: "settled" as const,
      updatedAt: event.block.timestamp,
      eventBlock: event.block.number,
      eventTxHash: lowerHex(event.transaction.hash),
      eventLogIndex: event.log.logIndex,
    };
    if (existing) {
      await context.db.update(arcadeRound, { id }).set(patch);
    } else {
      await context.db.insert(arcadeRound).values({
        id,
        roomId: roomKey(event.args.roomId),
        chainId: context.chain.id,
        roundIndex: Number(event.args.roundIndex),
        startTime: null,
        lockTime: null,
        endTime: null,
        anchorPrice: null,
        anchorSnapshotId: null,
        ...patch,
      });
    }
  });
}

// ──────────────── FXBentoSettlementManager handlers ────────────────────────

for (const contractName of [
  "BentoSettlementManagerArc",
  "BentoSettlementManagerFuji",
] as const satisfies readonly SettlementContractName[]) {
  ponder.on(`${contractName}:ResultsSubmitted`, async ({ event, context }) => {
    await insertSettlementRow({
      context,
      roomId: event.args.roomId,
      stage: "submitted",
      resultsRoot: event.args.resultsRoot,
      metadataURI: event.args.metadataURI,
      blockTimestamp: event.block.timestamp,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
    });
    await patchRoom({
      context,
      roomId: event.args.roomId,
      patch: {
        status: "settling",
        resultsRoot: lowerHex(event.args.resultsRoot),
        metadataURI: event.args.metadataURI,
        updatedAt: event.block.timestamp,
      },
      block: event.block,
      tx: event.transaction,
      logIndex: event.log.logIndex,
    });
  });

  ponder.on(`${contractName}:ResultsChallenged`, async ({ event, context }) => {
    await insertSettlementRow({
      context,
      roomId: event.args.roomId,
      stage: "challenged",
      resultsRoot: null,
      metadataURI: null,
      blockTimestamp: event.block.timestamp,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
    });
  });

  ponder.on(`${contractName}:ChallengeResolved`, async ({ event, context }) => {
    await insertSettlementRow({
      context,
      roomId: event.args.roomId,
      stage: "resolved",
      resultsRoot: null,
      metadataURI: null,
      challengeAccepted: event.args.accepted,
      blockTimestamp: event.block.timestamp,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
    });
  });

  ponder.on(`${contractName}:ResultsFinalized`, async ({ event, context }) => {
    await insertSettlementRow({
      context,
      roomId: event.args.roomId,
      stage: "finalized",
      resultsRoot: event.args.resultsRoot,
      metadataURI: null,
      blockTimestamp: event.block.timestamp,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
    });
    await patchRoom({
      context,
      roomId: event.args.roomId,
      patch: {
        status: "finalized",
        resultsRoot: lowerHex(event.args.resultsRoot),
        finalizedAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      },
      block: event.block,
      tx: event.transaction,
      logIndex: event.log.logIndex,
    });
  });

  ponder.on(`${contractName}:SettlementRescued`, async ({ event, context }) => {
    await insertSettlementRow({
      context,
      roomId: event.args.roomId,
      stage: "rescued",
      resultsRoot: null,
      metadataURI: null,
      blockTimestamp: event.block.timestamp,
      txHash: event.transaction.hash,
      logIndex: event.log.logIndex,
    });
  });
}

// ───────────────────────────── helpers ─────────────────────────────────────

type AnyBentoContext = Context<
  | `${FactoryContractName}:RoomCreated`
  | `${FactoryContractName}:RoomStatusUpdated`
  | `${EscrowContractName}:RoomJoined`
  | `${EscrowContractName}:RoomLeft`
  | `${EscrowContractName}:RoomCancelled`
  | `${EscrowContractName}:RoomLocked`
  | `${EscrowContractName}:RoomSettled`
  | `${EscrowContractName}:Refunded`
  | `${EscrowContractName}:PrizeClaimed`
  | `${CommitmentContractName}:SelectionCommitted`
  | `${CommitmentContractName}:SelectionRevealed`
  | `${RoundContractName}:RoundStarted`
  | `${RoundContractName}:AnchorRecorded`
  | `${RoundContractName}:SettlementRecorded`
  | `${SettlementContractName}:ResultsSubmitted`
  | `${SettlementContractName}:ResultsChallenged`
  | `${SettlementContractName}:ChallengeResolved`
  | `${SettlementContractName}:ResultsFinalized`
  | `${SettlementContractName}:SettlementRescued`
>;

interface RoomConfig {
  poolId: Hex;
  entryToken: Address;
  entryFee: bigint;
  minPlayers: number;
  maxPlayers: number;
  rounds: number;
  roundDuration: number;
  lockBuffer: number;
  startTime: bigint;
  rakeBps: number;
  payoutHash: Hex;
  gridConfigHash: Hex;
  isPrivate: boolean;
  inviteCodeHash: Hex;
  status: number;
}

async function readRoomConfig(args: {
  context: AnyBentoContext;
  contractName: FactoryContractName;
  roomId: bigint;
  blockNumber: bigint;
}): Promise<RoomConfig | null> {
  try {
    const result = await args.context.client.readContract({
      // The factory address is the contract that emitted the event; we look
      // it up off the context to avoid hard-coding the chain split.
      address: factoryAddress(args.context, args.contractName),
      abi: FxBentoRoomFactoryAbi,
      functionName: "getRoom",
      args: [args.roomId],
      blockNumber: args.blockNumber,
    });
    return normalizeRoomConfig(result);
  } catch {
    // getRoom can revert (e.g. on partial backfill against a redeployed
    // factory). We fall back to event-only data — the row still gets
    // inserted with whatever the event itself carried.
    return null;
  }
}

function factoryAddress(
  context: AnyBentoContext,
  contractName: FactoryContractName,
): Address {
  // The context.contracts map is keyed by the names declared in
  // ponder.config.ts; both BentoRoomFactoryArc and BentoRoomFactoryFuji are
  // guaranteed to exist there.
  const contracts = context.contracts as unknown as Record<
    FactoryContractName,
    { address: Address }
  >;
  return contracts[contractName].address;
}

function normalizeRoomConfig(value: unknown): RoomConfig {
  const tuple = value as {
    readonly poolId?: Hex;
    readonly entryToken?: Address;
    readonly entryFee?: bigint;
    readonly minPlayers?: number;
    readonly maxPlayers?: number;
    readonly rounds?: number;
    readonly roundDuration?: number;
    readonly lockBuffer?: number;
    readonly startTime?: bigint;
    readonly rakeBps?: number;
    readonly payoutHash?: Hex;
    readonly gridConfigHash?: Hex;
    readonly isPrivate?: boolean;
    readonly inviteCodeHash?: Hex;
    readonly status?: number;
    readonly 0?: Hex;
    readonly 1?: Address;
    readonly 2?: bigint;
    readonly 3?: number;
    readonly 4?: number;
    readonly 5?: number;
    readonly 6?: number;
    readonly 7?: number;
    readonly 8?: bigint;
    readonly 9?: number;
    readonly 10?: Hex;
    readonly 11?: Hex;
    readonly 12?: boolean;
    readonly 13?: Hex;
    readonly 14?: number;
  };
  return {
    poolId: tuple.poolId ?? tuple[0] ?? ("0x" as Hex),
    entryToken: tuple.entryToken ?? tuple[1] ?? ("0x" as Address),
    entryFee: tuple.entryFee ?? tuple[2] ?? 0n,
    minPlayers: Number(tuple.minPlayers ?? tuple[3] ?? 0),
    maxPlayers: Number(tuple.maxPlayers ?? tuple[4] ?? 0),
    rounds: Number(tuple.rounds ?? tuple[5] ?? 0),
    roundDuration: Number(tuple.roundDuration ?? tuple[6] ?? 0),
    lockBuffer: Number(tuple.lockBuffer ?? tuple[7] ?? 0),
    startTime: BigInt(tuple.startTime ?? tuple[8] ?? 0),
    rakeBps: Number(tuple.rakeBps ?? tuple[9] ?? 0),
    payoutHash: tuple.payoutHash ?? tuple[10] ?? ("0x" as Hex),
    gridConfigHash: tuple.gridConfigHash ?? tuple[11] ?? ("0x" as Hex),
    isPrivate: tuple.isPrivate ?? tuple[12] ?? false,
    inviteCodeHash: tuple.inviteCodeHash ?? tuple[13] ?? ("0x" as Hex),
    status: Number(tuple.status ?? tuple[14] ?? 0),
  };
}

interface PatchRoomArgs {
  context: AnyBentoContext;
  roomId: bigint;
  patch: Partial<{
    status: RoomStatusFromContract;
    prizePoolUsdc: bigint;
    rakeBps: number;
    lockedAt: bigint | null;
    settledAt: bigint | null;
    finalizedAt: bigint | null;
    cancelledAt: bigint | null;
    resultsRoot: Hex | null;
    payoutSchemaHash: Hex | null;
    payoutTotal: bigint | null;
    protocolFee: bigint | null;
    metadataURI: string | null;
    updatedAt: bigint;
  }>;
  block: { number: bigint };
  tx: { hash: Hex };
  logIndex: number;
}

async function patchRoom(args: PatchRoomArgs): Promise<void> {
  const id = roomKey(args.roomId);
  const existing = await args.context.db.find(arcadeRoom, { roomId: id });

  const nextStatus =
    args.patch.status &&
    (!existing ||
      ROOM_STATUS_RANK[args.patch.status] >=
        ROOM_STATUS_RANK[(existing.status as RoomStatusFromContract) ?? "lobby"])
      ? args.patch.status
      : (existing?.status as RoomStatusFromContract | undefined);

  const merged = {
    ...args.patch,
    ...(nextStatus ? { status: nextStatus } : {}),
    eventBlock: args.block.number,
    eventTxHash: lowerHex(args.tx.hash),
    eventLogIndex: args.logIndex,
  };

  if (existing) {
    await args.context.db.update(arcadeRoom, { roomId: id }).set(merged);
    return;
  }

  // Patch arrived before RoomCreated (partial backfill). Seed a minimal
  // row so the lifecycle isn't lost.
  await args.context.db.insert(arcadeRoom).values({
    roomId: id,
    chainId: args.context.chain.id,
    marketId: id,
    entryFeeUsdc: 0n,
    chipsPerPlayer: 0,
    maxPlayers: 0,
    status: (nextStatus ?? "lobby") as RoomStatusFromContract,
    startsAt: 0n,
    endsAt: 0n,
    prizePoolUsdc: args.patch.prizePoolUsdc ?? 0n,
    rakeBps: args.patch.rakeBps ?? 0,
    poolId: null,
    entryToken: null,
    minPlayers: null,
    rounds: null,
    roundDuration: null,
    lockBuffer: null,
    gridConfigHash: null,
    payoutHash: null,
    isPrivate: null,
    lockedAt: args.patch.lockedAt ?? null,
    settledAt: args.patch.settledAt ?? null,
    finalizedAt: args.patch.finalizedAt ?? null,
    cancelledAt: args.patch.cancelledAt ?? null,
    resultsRoot: args.patch.resultsRoot ?? null,
    payoutSchemaHash: args.patch.payoutSchemaHash ?? null,
    payoutTotal: args.patch.payoutTotal ?? null,
    protocolFee: args.patch.protocolFee ?? null,
    metadataURI: args.patch.metadataURI ?? null,
    eventBlock: args.block.number,
    eventTxHash: lowerHex(args.tx.hash),
    eventLogIndex: args.logIndex,
    updatedAt: args.patch.updatedAt ?? 0n,
  });
}

interface PatchPlacementArgs {
  context: AnyBentoContext;
  roomId: bigint;
  player: Address;
  tileId: string;
  patch: Partial<{
    leftAt: bigint;
    refundedAt: bigint;
    refundedAmount: bigint;
    prizeAmount: bigint;
    claimedAt: bigint;
    claimedTxHash: Hex;
    revealedAt: bigint;
    revealedSelectionHash: Hex;
    revealedTxHash: Hex;
    roundIndex: number;
  }>;
  seedOnMissing?: {
    roomId: string;
    player: Hex;
    tileId: string;
    chainId: number;
  };
}

async function patchPlacement(args: PatchPlacementArgs): Promise<void> {
  const id = placementKey({
    roomId: args.roomId,
    player: args.player,
    tileId: args.tileId,
  });
  const existing = await args.context.db.find(arcadePlacement, { id });
  if (existing) {
    await args.context.db.update(arcadePlacement, { id }).set(args.patch);
    return;
  }
  if (!args.seedOnMissing) return;
  await args.context.db.insert(arcadePlacement).values({
    id,
    roomId: args.seedOnMissing.roomId,
    player: args.seedOnMissing.player,
    tileId: args.seedOnMissing.tileId,
    chips: 0,
    commitment: null,
    revealedAt: args.patch.revealedAt ?? null,
    chainId: args.seedOnMissing.chainId,
    roundIndex: args.patch.roundIndex ?? null,
    joinedAt: null,
    joinedTxHash: null,
    leftAt: args.patch.leftAt ?? null,
    refundedAt: args.patch.refundedAt ?? null,
    refundedAmount: args.patch.refundedAmount ?? null,
    commitmentTxHash: null,
    revealedSelectionHash: args.patch.revealedSelectionHash ?? null,
    revealedTxHash: args.patch.revealedTxHash ?? null,
    prizeAmount: args.patch.prizeAmount ?? null,
    claimedAt: args.patch.claimedAt ?? null,
    claimedTxHash: args.patch.claimedTxHash ?? null,
    eventBlock: null,
    eventTxHash: null,
    eventLogIndex: null,
  });
}

interface InsertSettlementRowArgs {
  context: AnyBentoContext;
  roomId: bigint;
  stage: "submitted" | "challenged" | "resolved" | "finalized" | "rescued";
  resultsRoot: Hex | null;
  metadataURI: string | null;
  challengeAccepted?: boolean;
  blockTimestamp: bigint;
  txHash: Hex;
  logIndex: number;
}

async function insertSettlementRow(args: InsertSettlementRowArgs): Promise<void> {
  await args.context.db
    .insert(arcadeSettlement)
    .values({
      id: `${roomKey(args.roomId)}:${args.stage}:${args.logIndex}`,
      roomId: roomKey(args.roomId),
      chainId: args.context.chain.id,
      stage: args.stage,
      resultsRoot: args.resultsRoot ? lowerHex(args.resultsRoot) : null,
      metadataURI: args.metadataURI ?? null,
      challengeAccepted: args.challengeAccepted ?? null,
      blockTimestamp: args.blockTimestamp,
      txHash: lowerHex(args.txHash),
      logIndex: args.logIndex,
    })
    .onConflictDoNothing();
}

function computeRakeBps(args: {
  payoutTotal: bigint;
  protocolFee: bigint;
}): number | null {
  const denom = args.payoutTotal + args.protocolFee;
  if (denom <= 0n) return null;
  // rakeBps = protocolFee / (payoutTotal + protocolFee) * 10_000
  return Number((args.protocolFee * 10_000n) / denom);
}

function roomKey(roomId: bigint): string {
  return roomId.toString();
}

function roundKey(roomId: bigint, roundIndex: number | bigint): string {
  return `${roomKey(roomId)}:${Number(roundIndex)}`;
}

function placementKey(args: {
  roomId: bigint;
  player: Address;
  tileId: string;
}): string {
  return `${roomKey(args.roomId)}:${lowerHex(args.player)}:${args.tileId}`;
}

