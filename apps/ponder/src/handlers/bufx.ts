/**
 * BUFX + Telarana event handler ownership map.
 *
 * Registered live contracts in ponder.config.ts:
 * - BuFxVenueRequestRouter{Fuji,Arc}: BuFxRequestAccepted, BuFxRequestFeeQuoted,
 *   BuFxRfqAccepted, BuFxPerpLiquidityAccepted.
 * - BuFxTelaranaRequestRouter{Fuji,Arc}: TelaranaRequestSubmitted,
 *   TelaranaGatewayMintContextPrepared, TelaranaRequestCancelled.
 * - TelaranaGatewayHubHookArc: GatewayAtomicFxSwapRequested.
 * - FxSpotExecutorArc: SpotFxExecuted.
 *
 * Keep this file importable before `ponder codegen` has run. The concrete
 * ponder.on(...) registrations should be added after the generated
 * `ponder:registry` module exists in the deploy target.
 */

export {};
