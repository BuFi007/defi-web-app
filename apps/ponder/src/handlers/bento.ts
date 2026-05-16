/**
 * FX² Arcade / FX Bento event handlers —
 * owned by feature/fx-bento-backend.
 *
 * Expected events (final names live in the Bento contract):
 *   - RoomCreated(roomId, creator, marketId, entryFee, chips, maxPlayers, startsAt, endsAt, rakeBps)
 *   - PlayerJoined(roomId, player, paidUsdc)
 *   - Committed(roomId, player, commitmentHash)
 *   - Revealed(roomId, player, tileId, chips)
 *   - RoomStarted(roomId, oracleSnapshotPrice, oracleTimestamp)
 *   - RoomSettled(roomId, totalPrizePool, rakeUsdc)
 *   - PrizeClaimed(roomId, winner, prizeUsdc)
 *   - Refunded(roomId, player, usdc)
 *
 * Each handler updates the matching row in arcadeRoom / arcadePlacement.
 * Money invariants are validated here too:
 *   sum(prizes) + rake == totalPrizePool
 */

export {};
