/**
 * FX Telaraña event handlers —
 * owned by feature/fx-telarana-lending-backend.
 *
 * Expected events (final names live in the Telaraña contract):
 *   - MarketRegistered(marketId, baseAsset, quoteAsset, oracle, collateralFactorBps)
 *   - PositionOpened(positionId, borrower, marketId, collateralAmount, borrowAmount)
 *   - PositionRepaid(positionId, repaidAmount)
 *   - PositionLiquidated(positionId, liquidator, seizedCollateral, healthFactorAtLiq)
 *   - RatesUpdated(marketId, borrowApyBps, supplyApyBps, utilizationBps)
 *
 * Health-factor reconciliation: store `healthFactorBps` from chain on every
 * relevant event. The liquidation scanner re-checks on each new block via
 * a contract `multicall` rather than trusting indexed HF in isolation.
 */

export {};
