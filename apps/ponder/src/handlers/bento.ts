/**
 * FX² Arcade / FX Bento event handlers.
 *
 * ─── STATUS ─────────────────────────────────────────────────────────────────
 * Awaiting config wiring. ponder.config.ts currently subscribes ONE Bento
 * placeholder (`BentoRoomFactoryFuji`) that is:
 *   1. Gated behind PONDER_BENTO_ADDRESS_FUJI (so it's a no-op without env)
 *   2. Declared with `abi: [] as const` (no events to register against)
 *   3. Pointed at avalancheFuji, while the live Bento stack actually runs
 *      on arcTestnet per packages/contracts/deployments/bento-arc-testnet.json
 *
 * The handler set below is intentionally left empty so this file is importable
 * by src/index.ts without crashing `ponder dev`. Wire the real handlers once
 * ponder.config.ts is updated to subscribe the live Bento contracts.
 *
 * ─── WIRING PLAN (apply when config opens up) ──────────────────────────────
 * Live addresses (arcTestnet, chainId 5042002):
 *   FXBentoRoomFactory        0x385bbd57d0dc2008e4446af7b12dcd158d56034d
 *   FXBentoRoomEscrow         0xab2f146507854334464c4b2326654775d9d947ed
 *   FXBentoCommitmentManager  0x6b2c047fa0deb963a9ede1db7d0e4df258880414
 *   FXBentoRoundManager       0xfb956d033b15276da21579afd5f5b6bf6320869e
 *   FXBentoSettlementManager  0x8f635571aaea4b1391534cd92932caa839e04bcd
 *   FXBentoHook               0xa6e3c9c2d6436feb24b165a8bcf6b454e96d50c0
 *   indexerStartBlock         42_625_070
 *
 * Mapping live ABI events → schema rows (final names match
 * packages/contracts/src/abis/FxBento*.ts exactly):
 *
 *   FXBentoRoomFactory:
 *     RoomCreated(roomId, poolId, entryToken, entryFee)
 *       → arcadeRoom upsert (status='lobby', marketId=poolId,
 *         entryFeeUsdc=entryFee). chipsPerPlayer/maxPlayers/startsAt/endsAt
 *         /rakeBps come from a contract read at the block — mirror the
 *         perps handler's `args.context.client.readContract(...)` pattern
 *         against `getRoom(roomId)`.
 *     RoomStatusUpdated(roomId, status)
 *       → arcadeRoom patch (status mapped from uint8 enum)
 *
 *   FXBentoRoomEscrow:
 *     RoomJoined(roomId, player)
 *       → arcadePlacement insert (composite PK roomId:player:tileId,
 *         tileId='_pending' until reveal)
 *     RoomLeft / Refunded
 *       → arcadePlacement delete (or refundedAt column if we add one)
 *     RoomLocked(roomId, escrowed)
 *       → arcadeRoom patch (status='locked', prizePoolUsdc=escrowed)
 *     RoomSettled(roomId, resultsRoot, payoutSchemaHash, payoutTotal,
 *                 protocolFee)
 *       → arcadeRoom patch (status='settled', rakeBps derived from
 *         protocolFee/payoutTotal). resultsRoot needs an additive column.
 *     PrizeClaimed / ProtocolFeeClaimed → optional payout-event table
 *
 *   FXBentoCommitmentManager:
 *     SelectionCommitted(roomId, roundIndex, player, commitment)
 *       → arcadePlacement upsert with commitment column
 *     SelectionRevealed(roomId, roundIndex, player, selectedTilesHash)
 *       → arcadePlacement upsert revealedAt + tileId derived from hash
 *
 *   FXBentoRoundManager:
 *     RoundStarted / AnchorRecorded / SettlementRecorded
 *       → would slot into a new arcadeRound table (currently the schema
 *         only models room + placements; rounds need an additive table).
 *
 *   FXBentoSettlementManager:
 *     ResultsSubmitted / ResultsChallenged / ChallengeResolved /
 *     ResultsFinalized → arcadeRoom patch (status='settling' / 'finalized'),
 *     plus an additive challenge table if we want to surface disputes.
 *
 * Money invariant to validate on RoomSettled: payoutTotal + protocolFee ==
 * sum(prizeClaimed) — sanity-check in the API layer once handlers run.
 */
export {};
