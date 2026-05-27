import { indexer } from "envio";

const ROOM_STATUS_BY_ENUM: Record<number, string> = {
  0: "lobby",
  1: "locked",
  2: "settling",
  3: "settled",
  4: "finalized",
  5: "cancelled",
};

const ROOM_STATUS_RANK: Record<string, number> = {
  lobby: 1,
  locked: 2,
  settling: 3,
  settled: 4,
  finalized: 5,
  cancelled: 6,
};

// ─────────────────── FxBentoRoomFactory ──────────────────────────

indexer.onEvent(
  { contract: "FxBentoRoomFactory", event: "RoomCreated" },
  async ({ event, context }) => {
    const id = event.params.roomId.toString();
    context.ArcadeRoom.set({
      id,
      chainId: event.chainId,
      marketId: event.params.poolId.toLowerCase(),
      entryFeeUsdc: event.params.entryFee,
      chipsPerPlayer: 0,
      maxPlayers: 0,
      status: "lobby",
      startsAt: 0n,
      endsAt: 0n,
      prizePoolUsdc: 0n,
      rakeBps: 0,
      poolId: event.params.poolId.toLowerCase(),
      entryToken: event.params.entryToken.toLowerCase(),
      minPlayers: 0,
      rounds: 0,
      roundDuration: 0,
      lockBuffer: 0,
      gridConfigHash: "",
      payoutHash: "",
      isPrivate: false,
      lockedAt: 0n,
      settledAt: 0n,
      finalizedAt: 0n,
      cancelledAt: 0n,
      resultsRoot: "",
      payoutSchemaHash: "",
      payoutTotal: 0n,
      protocolFee: 0n,
      metadataURI: "",
      eventBlock: event.block.number,
      eventTxHash: event.transaction.hash.toLowerCase(),
      eventLogIndex: event.logIndex,
      updatedAt: event.block.timestamp,
    });
  },
);

indexer.onEvent(
  { contract: "FxBentoRoomFactory", event: "RoomStatusUpdated" },
  async ({ event, context }) => {
    const next = ROOM_STATUS_BY_ENUM[Number(event.params.status)];
    if (!next) return;
    await patchRoom(context, event.params.roomId.toString(), event.chainId, {
      status: next,
      updatedAt: event.block.timestamp,
      eventBlock: event.block.number,
      eventTxHash: event.transaction.hash.toLowerCase(),
      eventLogIndex: event.logIndex,
    });
  },
);

// ─────────────────── FxBentoRoomEscrow ───────────────────────────

indexer.onEvent(
  { contract: "FxBentoRoomEscrow", event: "RoomJoined" },
  async ({ event, context }) => {
    const id = placementKey(event.params.roomId.toString(), event.params.player, "_pending");
    context.ArcadePlacement.set({
      id,
      roomId: event.params.roomId.toString(),
      player: event.params.player.toLowerCase(),
      tileId: "_pending",
      chips: 0,
      commitment: "",
      revealedAt: 0n,
      chainId: event.chainId,
      roundIndex: 0,
      joinedAt: BigInt(event.block.timestamp),
      joinedTxHash: event.transaction.hash.toLowerCase(),
      leftAt: 0n,
      refundedAt: 0n,
      refundedAmount: 0n,
      commitmentTxHash: "",
      revealedSelectionHash: "",
      revealedTxHash: "",
      prizeAmount: 0n,
      claimedAt: 0n,
      claimedTxHash: "",
      eventBlock: event.block.number,
      eventTxHash: event.transaction.hash.toLowerCase(),
      eventLogIndex: event.logIndex,
    });
  },
);

indexer.onEvent(
  { contract: "FxBentoRoomEscrow", event: "RoomLeft" },
  async ({ event, context }) => {
    const id = placementKey(event.params.roomId.toString(), event.params.player, "_pending");
    const existing = await context.ArcadePlacement.get(id);
    if (existing) {
      context.ArcadePlacement.set({ ...existing, leftAt: BigInt(event.block.timestamp) });
    }
  },
);

indexer.onEvent(
  { contract: "FxBentoRoomEscrow", event: "RoomCancelled" },
  async ({ event, context }) => {
    await patchRoom(context, event.params.roomId.toString(), event.chainId, {
      status: "cancelled",
      cancelledAt: BigInt(event.block.timestamp),
      updatedAt: event.block.timestamp,
      eventBlock: event.block.number,
      eventTxHash: event.transaction.hash.toLowerCase(),
      eventLogIndex: event.logIndex,
    });
  },
);

indexer.onEvent(
  { contract: "FxBentoRoomEscrow", event: "RoomLocked" },
  async ({ event, context }) => {
    await patchRoom(context, event.params.roomId.toString(), event.chainId, {
      status: "locked",
      prizePoolUsdc: event.params.escrowed,
      lockedAt: BigInt(event.block.timestamp),
      updatedAt: event.block.timestamp,
      eventBlock: event.block.number,
      eventTxHash: event.transaction.hash.toLowerCase(),
      eventLogIndex: event.logIndex,
    });
  },
);

indexer.onEvent(
  { contract: "FxBentoRoomEscrow", event: "RoomSettled" },
  async ({ event, context }) => {
    const denom = event.params.payoutTotal + event.params.protocolFee;
    const rakeBps = denom > 0n ? Number((event.params.protocolFee * 10_000n) / denom) : 0;
    await patchRoom(context, event.params.roomId.toString(), event.chainId, {
      status: "settled",
      resultsRoot: event.params.resultsRoot.toLowerCase(),
      payoutSchemaHash: event.params.payoutSchemaHash.toLowerCase(),
      payoutTotal: event.params.payoutTotal,
      protocolFee: event.params.protocolFee,
      rakeBps,
      settledAt: BigInt(event.block.timestamp),
      updatedAt: event.block.timestamp,
      eventBlock: event.block.number,
      eventTxHash: event.transaction.hash.toLowerCase(),
      eventLogIndex: event.logIndex,
    });
  },
);

indexer.onEvent(
  { contract: "FxBentoRoomEscrow", event: "Refunded" },
  async ({ event, context }) => {
    const id = placementKey(event.params.roomId.toString(), event.params.player, "_pending");
    const existing = await context.ArcadePlacement.get(id);
    if (existing) {
      context.ArcadePlacement.set({
        ...existing,
        refundedAt: BigInt(event.block.timestamp),
        refundedAmount: event.params.amount,
      });
    }
  },
);

indexer.onEvent(
  { contract: "FxBentoRoomEscrow", event: "PrizeClaimed" },
  async ({ event, context }) => {
    const id = placementKey(event.params.roomId.toString(), event.params.player, "_pending");
    const existing = await context.ArcadePlacement.get(id);
    if (existing) {
      context.ArcadePlacement.set({
        ...existing,
        prizeAmount: event.params.amount,
        claimedAt: BigInt(event.block.timestamp),
        claimedTxHash: event.transaction.hash.toLowerCase(),
      });
    }
  },
);

// ─────────────────── FxBentoCommitmentManager ────────────────────

indexer.onEvent(
  { contract: "FxBentoCommitmentManager", event: "SelectionCommitted" },
  async ({ event, context }) => {
    const id = placementKey(event.params.roomId.toString(), event.params.player, "_pending");
    const existing = await context.ArcadePlacement.get(id);
    if (existing) {
      context.ArcadePlacement.set({
        ...existing,
        commitment: event.params.commitment.toLowerCase(),
        commitmentTxHash: event.transaction.hash.toLowerCase(),
        roundIndex: Number(event.params.roundIndex),
      });
    } else {
      context.ArcadePlacement.set({
        id,
        roomId: event.params.roomId.toString(),
        player: event.params.player.toLowerCase(),
        tileId: "_pending",
        chips: 0,
        commitment: event.params.commitment.toLowerCase(),
        revealedAt: 0n,
        chainId: event.chainId,
        roundIndex: Number(event.params.roundIndex),
        joinedAt: 0n,
        joinedTxHash: "",
        leftAt: 0n,
        refundedAt: 0n,
        refundedAmount: 0n,
        commitmentTxHash: event.transaction.hash.toLowerCase(),
        revealedSelectionHash: "",
        revealedTxHash: "",
        prizeAmount: 0n,
        claimedAt: 0n,
        claimedTxHash: "",
        eventBlock: event.block.number,
        eventTxHash: event.transaction.hash.toLowerCase(),
        eventLogIndex: event.logIndex,
      });
    }
  },
);

indexer.onEvent(
  { contract: "FxBentoCommitmentManager", event: "SelectionRevealed" },
  async ({ event, context }) => {
    const id = placementKey(event.params.roomId.toString(), event.params.player, "_pending");
    const existing = await context.ArcadePlacement.get(id);
    if (existing) {
      context.ArcadePlacement.set({
        ...existing,
        revealedAt: BigInt(event.block.timestamp),
        revealedSelectionHash: event.params.selectedTilesHash.toLowerCase(),
        revealedTxHash: event.transaction.hash.toLowerCase(),
        roundIndex: Number(event.params.roundIndex),
      });
    }
  },
);

// ─────────────────── FxBentoRoundManager ─────────────────────────

indexer.onEvent(
  { contract: "FxBentoRoundManager", event: "RoundStarted" },
  async ({ event, context }) => {
    const id = roundKey(event.params.roomId.toString(), Number(event.params.roundIndex));
    context.ArcadeRound.set({
      id,
      roomId: event.params.roomId.toString(),
      chainId: event.chainId,
      roundIndex: Number(event.params.roundIndex),
      startTime: BigInt(event.params.startTime),
      lockTime: BigInt(event.params.lockTime),
      endTime: BigInt(event.params.endTime),
      anchorSnapshotId: event.params.anchorSnapshotId,
      anchorPrice: "",
      settlementSnapshotId: 0n,
      settlementPrice: "",
      status: "started",
      eventBlock: event.block.number,
      eventTxHash: event.transaction.hash.toLowerCase(),
      eventLogIndex: event.logIndex,
      updatedAt: event.block.timestamp,
    });
  },
);

indexer.onEvent(
  { contract: "FxBentoRoundManager", event: "AnchorRecorded" },
  async ({ event, context }) => {
    const id = roundKey(event.params.roomId.toString(), Number(event.params.roundIndex));
    const existing = await context.ArcadeRound.get(id);
    const base = existing ?? emptyRound(id, event.params.roomId.toString(), event.chainId, Number(event.params.roundIndex));
    context.ArcadeRound.set({
      ...base,
      anchorPrice: event.params.price.toString(),
      anchorSnapshotId: event.params.snapshotId,
      status: "anchor_recorded",
      updatedAt: event.block.timestamp,
      eventBlock: event.block.number,
      eventTxHash: event.transaction.hash.toLowerCase(),
      eventLogIndex: event.logIndex,
    });
  },
);

indexer.onEvent(
  { contract: "FxBentoRoundManager", event: "SettlementRecorded" },
  async ({ event, context }) => {
    const id = roundKey(event.params.roomId.toString(), Number(event.params.roundIndex));
    const existing = await context.ArcadeRound.get(id);
    const base = existing ?? emptyRound(id, event.params.roomId.toString(), event.chainId, Number(event.params.roundIndex));
    context.ArcadeRound.set({
      ...base,
      settlementPrice: event.params.price.toString(),
      settlementSnapshotId: event.params.snapshotId,
      status: "settled",
      updatedAt: event.block.timestamp,
      eventBlock: event.block.number,
      eventTxHash: event.transaction.hash.toLowerCase(),
      eventLogIndex: event.logIndex,
    });
  },
);

// ─────────────────── FxBentoSettlementManager ────────────────────

indexer.onEvent(
  { contract: "FxBentoSettlementManager", event: "ResultsSubmitted" },
  async ({ event, context }) => {
    insertSettlement(context, event.params.roomId.toString(), event.chainId, "submitted", event.block.timestamp, event.transaction.hash, event.logIndex, {
      resultsRoot: event.params.resultsRoot.toLowerCase(),
      metadataURI: event.params.metadataURI,
    });
    await patchRoom(context, event.params.roomId.toString(), event.chainId, {
      status: "settling",
      resultsRoot: event.params.resultsRoot.toLowerCase(),
      metadataURI: event.params.metadataURI,
      updatedAt: event.block.timestamp,
      eventBlock: event.block.number,
      eventTxHash: event.transaction.hash.toLowerCase(),
      eventLogIndex: event.logIndex,
    });
  },
);

indexer.onEvent(
  { contract: "FxBentoSettlementManager", event: "ResultsChallenged" },
  async ({ event, context }) => {
    insertSettlement(context, event.params.roomId.toString(), event.chainId, "challenged", event.block.timestamp, event.transaction.hash, event.logIndex, {});
  },
);

indexer.onEvent(
  { contract: "FxBentoSettlementManager", event: "ChallengeResolved" },
  async ({ event, context }) => {
    insertSettlement(context, event.params.roomId.toString(), event.chainId, "resolved", event.block.timestamp, event.transaction.hash, event.logIndex, {
      challengeAccepted: event.params.accepted,
    });
  },
);

indexer.onEvent(
  { contract: "FxBentoSettlementManager", event: "ResultsFinalized" },
  async ({ event, context }) => {
    insertSettlement(context, event.params.roomId.toString(), event.chainId, "finalized", event.block.timestamp, event.transaction.hash, event.logIndex, {
      resultsRoot: event.params.resultsRoot.toLowerCase(),
    });
    await patchRoom(context, event.params.roomId.toString(), event.chainId, {
      status: "finalized",
      resultsRoot: event.params.resultsRoot.toLowerCase(),
      finalizedAt: BigInt(event.block.timestamp),
      updatedAt: event.block.timestamp,
      eventBlock: event.block.number,
      eventTxHash: event.transaction.hash.toLowerCase(),
      eventLogIndex: event.logIndex,
    });
  },
);

indexer.onEvent(
  { contract: "FxBentoSettlementManager", event: "SettlementRescued" },
  async ({ event, context }) => {
    insertSettlement(context, event.params.roomId.toString(), event.chainId, "rescued", event.block.timestamp, event.transaction.hash, event.logIndex, {});
  },
);

// ─────────────────── helpers ─────────────────────────────────────

async function patchRoom(context: any, roomId: string, chainId: number, patch: Record<string, any>) {
  const existing = await context.ArcadeRoom.get(roomId);
  if (existing) {
    const nextStatus = patch.status && (ROOM_STATUS_RANK[patch.status] ?? 0) >= (ROOM_STATUS_RANK[existing.status] ?? 0)
      ? patch.status : existing.status;
    context.ArcadeRoom.set({ ...existing, ...patch, status: nextStatus });
  } else {
    context.ArcadeRoom.set({
      id: roomId,
      chainId,
      marketId: roomId,
      entryFeeUsdc: 0n,
      chipsPerPlayer: 0,
      maxPlayers: 0,
      status: patch.status ?? "lobby",
      startsAt: 0n,
      endsAt: 0n,
      prizePoolUsdc: 0n,
      rakeBps: 0,
      poolId: "",
      entryToken: "",
      minPlayers: 0,
      rounds: 0,
      roundDuration: 0,
      lockBuffer: 0,
      gridConfigHash: "",
      payoutHash: "",
      isPrivate: false,
      lockedAt: 0n,
      settledAt: 0n,
      finalizedAt: 0n,
      cancelledAt: 0n,
      resultsRoot: "",
      payoutSchemaHash: "",
      payoutTotal: 0n,
      protocolFee: 0n,
      metadataURI: "",
      eventBlock: 0,
      eventTxHash: "",
      eventLogIndex: 0,
      updatedAt: 0,
      ...patch,
    });
  }
}

function insertSettlement(
  context: any,
  roomId: string,
  chainId: number,
  stage: string,
  blockTimestamp: number,
  txHash: string,
  logIndex: number,
  extra: { resultsRoot?: string; metadataURI?: string; challengeAccepted?: boolean },
) {
  context.ArcadeSettlement.set({
    id: `${roomId}:${stage}:${logIndex}`,
    roomId,
    chainId,
    stage,
    resultsRoot: extra.resultsRoot ?? "",
    metadataURI: extra.metadataURI ?? "",
    challengeAccepted: extra.challengeAccepted ?? false,
    blockTimestamp,
    txHash: txHash.toLowerCase(),
    logIndex,
  });
}

function emptyRound(id: string, roomId: string, chainId: number, roundIndex: number) {
  return {
    id,
    roomId,
    chainId,
    roundIndex,
    startTime: 0n,
    lockTime: 0n,
    endTime: 0n,
    anchorSnapshotId: 0n,
    anchorPrice: "",
    settlementSnapshotId: 0n,
    settlementPrice: "",
    status: "started",
    eventBlock: 0,
    eventTxHash: "",
    eventLogIndex: 0,
    updatedAt: 0,
  };
}

function placementKey(roomId: string, player: string, tileId: string): string {
  return `${roomId}:${player.toLowerCase()}:${tileId}`;
}

function roundKey(roomId: string, roundIndex: number): string {
  return `${roomId}:${roundIndex}`;
}
