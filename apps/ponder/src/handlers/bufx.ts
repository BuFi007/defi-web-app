/**
 * BUFX (Bufinance) request-router event handlers.
 *
 * ponder.config.ts subscribes to FOUR BUFX router contracts:
 *   • BuFxVenueRequestRouterFuji   (avalancheFuji)
 *   • BuFxVenueRequestRouterArc    (arcTestnet)
 *   • BuFxTelaranaRequestRouterFuji (avalancheFuji)
 *   • BuFxTelaranaRequestRouterArc  (arcTestnet)
 *
 * Lifecycle wired here (sourced from the live ABIs under
 * packages/contracts/src/abis/BuFx*Router.ts):
 *
 * Venue router (the on-venue / Arc-side intent layer):
 *   BuFxRequestAccepted          → bufxRequest upsert, status='accepted'
 *                                  (canonical spot+RFQ+perp request type)
 *   BuFxRfqAccepted              → bufxRequest upsert, status='rfq_accepted'
 *                                  (RFQ-specific request type)
 *   BuFxPerpLiquidityAccepted    → bufxRequest upsert, status='perp_accepted'
 *                                  (perp liquidity injection)
 *   BuFxRequestFeeQuoted         → bufxRequest patch (no status change — fee
 *                                  quote is emitted alongside Accepted; we
 *                                  refresh the row's amount/timestamps so a
 *                                  late-indexed Accepted doesn't overwrite)
 *
 * Telarana router (the cross-chain hub spoke):
 *   TelaranaRequestSubmitted          → bufxRequest upsert, status='submitted'
 *                                       (Fuji-side intent before CCTP attest)
 *   TelaranaGatewayMintContextPrepared
 *                                     → telaranaGatewayContext upsert
 *                                       (full hub-side payload), plus
 *                                       bufxRequest patch to 'gateway_prepared'
 *   TelaranaRequestCancelled          → bufxRequest update, status='cancelled',
 *                                       cancelledAt set
 *
 * Status string convention matches the Telaraña handler ('open'/'repaid'),
 * lowercase snake-case. Idempotency: requestId is the PK; every handler
 * uses onConflictDoUpdate with a status-precedence guard so out-of-order
 * delivery (e.g. Accepted indexed before Submitted on a re-org) doesn't
 * regress the row.
 *
 * Events we deliberately DON'T index (low-signal admin/governance):
 *   TraderNonceUsed, FeeConfigUpdated, RfqMakerUpdated,
 *   PerpRiskParamsUpdated, AuthorizedSubmitterUpdated, OwnerTransferred,
 *   TelaranaRouteConfigured (covered by TelaranaGatewayHubHook).
 */
import { ponder } from "ponder:registry";
import type { Context } from "ponder:registry";
import { bufxRequest, telaranaGatewayContext } from "ponder:schema";
import type { Address, Hex } from "viem";

import { lowerHex, lowerHexOrNull } from "@bufi/shared-types/hex";

type AnyVenueEventName =
  | "BuFxVenueRequestRouterFuji:BuFxRequestAccepted"
  | "BuFxVenueRequestRouterArc:BuFxRequestAccepted"
  | "BuFxVenueRequestRouterFuji:BuFxRfqAccepted"
  | "BuFxVenueRequestRouterArc:BuFxRfqAccepted"
  | "BuFxVenueRequestRouterFuji:BuFxPerpLiquidityAccepted"
  | "BuFxVenueRequestRouterArc:BuFxPerpLiquidityAccepted"
  | "BuFxVenueRequestRouterFuji:BuFxRequestFeeQuoted"
  | "BuFxVenueRequestRouterArc:BuFxRequestFeeQuoted";

type AnyTelaranaEventName =
  | "BuFxTelaranaRequestRouterFuji:TelaranaRequestSubmitted"
  | "BuFxTelaranaRequestRouterArc:TelaranaRequestSubmitted"
  | "BuFxTelaranaRequestRouterFuji:TelaranaGatewayMintContextPrepared"
  | "BuFxTelaranaRequestRouterArc:TelaranaGatewayMintContextPrepared"
  | "BuFxTelaranaRequestRouterFuji:TelaranaRequestCancelled"
  | "BuFxTelaranaRequestRouterArc:TelaranaRequestCancelled";

type AnyBufxContext = Context<AnyVenueEventName | AnyTelaranaEventName>;

// ───────────────────────── Venue router (Fuji + Arc) ─────────────────────────

for (const contractName of [
  "BuFxVenueRequestRouterFuji",
  "BuFxVenueRequestRouterArc",
] as const) {
  ponder.on(`${contractName}:BuFxRequestAccepted`, async ({ event, context }) => {
    await upsertBufxRequest({
      context,
      requestId: event.args.requestId,
      requestType: event.args.requestType,
      marketId: event.args.marketId,
      trader: event.args.trader,
      referrer: event.args.referrer,
      campaignId: event.args.campaignId,
      amount: event.args.amount,
      status: "accepted",
      acceptedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  });

  ponder.on(`${contractName}:BuFxRfqAccepted`, async ({ event, context }) => {
    await upsertBufxRequest({
      context,
      requestId: event.args.requestId,
      marketId: event.args.marketId,
      trader: event.args.trader,
      amount: event.args.amountIn,
      status: "rfq_accepted",
      acceptedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  });

  ponder.on(`${contractName}:BuFxPerpLiquidityAccepted`, async ({ event, context }) => {
    await upsertBufxRequest({
      context,
      requestId: event.args.requestId,
      marketId: event.args.marketId,
      trader: event.args.trader,
      amount: event.args.notionalUsd,
      status: "perp_accepted",
      acceptedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  });

  ponder.on(`${contractName}:BuFxRequestFeeQuoted`, async ({ event, context }) => {
    // Fee-quote rows refresh trader/referrer/amount but do NOT regress status
    // (Accepted can land before or after Quoted on the same tx — we keep
    // whichever produced the more advanced status via the precedence guard).
    await upsertBufxRequest({
      context,
      requestId: event.args.requestId,
      requestType: event.args.requestType,
      marketId: event.args.marketId,
      trader: event.args.trader,
      referrer: event.args.referrer,
      amount: event.args.amount,
      status: "fee_quoted",
      acceptedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  });
}

// ──────────────────────── Telarana router (Fuji + Arc) ───────────────────────

for (const contractName of [
  "BuFxTelaranaRequestRouterFuji",
  "BuFxTelaranaRequestRouterArc",
] as const) {
  ponder.on(`${contractName}:TelaranaRequestSubmitted`, async ({ event, context }) => {
    await upsertBufxRequest({
      context,
      requestId: event.args.requestId,
      marketId: event.args.marketId,
      trader: event.args.trader,
      referrer: event.args.referrer,
      campaignId: event.args.campaignId,
      amount: event.args.amount,
      status: "submitted",
      acceptedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  });

  ponder.on(
    `${contractName}:TelaranaGatewayMintContextPrepared`,
    async ({ event, context }) => {
      await upsertGatewayContext({
        context,
        requestId: event.args.requestId,
        routeId: event.args.routeId,
        telaranaGatewayHook: event.args.telaranaGatewayHook,
        gatewayAction: event.args.gatewayAction,
        sourceDepositor: event.args.sourceDepositor,
        sourceSigner: event.args.sourceSigner,
        recipient: event.args.recipient,
        tokenOut: event.args.tokenOut,
        amount: event.args.amount,
        minAmountOut: event.args.minAmountOut,
        spotRouteId: event.args.spotRouteId,
        metadataRef: event.args.metadataRef,
      });

      // The hub-prepared context is the latest known status before the
      // CCTP attestation lands — propagate it onto the bufxRequest row too
      // (best-effort; trader/marketId may have been set by an earlier
      // TelaranaRequestSubmitted on the source chain).
      await upsertBufxRequest({
        context,
        requestId: event.args.requestId,
        trader: event.args.sourceSigner,
        amount: event.args.amount,
        status: "gateway_prepared",
        acceptedAt: event.block.timestamp,
        txHash: event.transaction.hash,
      });
    },
  );

  ponder.on(`${contractName}:TelaranaRequestCancelled`, async ({ event, context }) => {
    await cancelBufxRequest({
      context,
      requestId: event.args.requestId,
      trader: event.args.trader,
      cancelledAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  });
}

// ───────────────────────────────── helpers ───────────────────────────────────

interface UpsertBufxRequestArgs {
  context: AnyBufxContext;
  requestId: Hex;
  requestType?: Hex;
  marketId?: Hex;
  trader?: Address;
  referrer?: Address;
  campaignId?: Hex;
  amount?: bigint;
  status: BufxStatus;
  acceptedAt: bigint;
  txHash: Hex;
}

type BufxStatus =
  | "submitted"
  | "fee_quoted"
  | "accepted"
  | "rfq_accepted"
  | "perp_accepted"
  | "gateway_prepared"
  | "cancelled";

const STATUS_RANK: Record<BufxStatus, number> = {
  submitted: 1,
  fee_quoted: 2,
  accepted: 3,
  rfq_accepted: 3,
  perp_accepted: 3,
  gateway_prepared: 4,
  cancelled: 5,
};

async function upsertBufxRequest(args: UpsertBufxRequestArgs): Promise<void> {
  const id = lowerHex(args.requestId);
  const existing = await args.context.db.find(bufxRequest, { requestId: id });

  // Status precedence: don't regress from a more-advanced lifecycle stage.
  // Cancellation always wins (handled by cancelBufxRequest path).
  const nextStatus =
    existing && STATUS_RANK[existing.status as BufxStatus] >= STATUS_RANK[args.status]
      ? (existing.status as BufxStatus)
      : args.status;

  const row = {
    requestId: id,
    chainId: args.context.chain.id,
    requestType: args.requestType ? lowerHex(args.requestType) : (existing?.requestType ?? null),
    marketId: args.marketId ? lowerHex(args.marketId) : (existing?.marketId ?? null),
    trader: args.trader ? lowerHex(args.trader) : (existing?.trader ?? null),
    referrer: args.referrer ? lowerHexOrNull(args.referrer, { treatZeroAsNull: true }) : (existing?.referrer ?? null),
    campaignId: args.campaignId
      ? lowerHexOrNull(args.campaignId, { treatZeroAsNull: true })
      : (existing?.campaignId ?? null),
    amount: args.amount ?? existing?.amount ?? null,
    status: nextStatus,
    acceptedAt: existing?.acceptedAt ?? args.acceptedAt,
    cancelledAt: existing?.cancelledAt ?? null,
    txHash: lowerHex(args.txHash),
  };

  if (existing) {
    await args.context.db
      .update(bufxRequest, { requestId: id })
      .set({
        requestType: row.requestType,
        marketId: row.marketId,
        trader: row.trader,
        referrer: row.referrer,
        campaignId: row.campaignId,
        amount: row.amount,
        status: row.status,
        txHash: row.txHash,
      });
  } else {
    await args.context.db.insert(bufxRequest).values(row);
  }
}

interface CancelBufxRequestArgs {
  context: AnyBufxContext;
  requestId: Hex;
  trader: Address;
  cancelledAt: bigint;
  txHash: Hex;
}

async function cancelBufxRequest(args: CancelBufxRequestArgs): Promise<void> {
  const id = lowerHex(args.requestId);
  const existing = await args.context.db.find(bufxRequest, { requestId: id });

  if (existing) {
    await args.context.db
      .update(bufxRequest, { requestId: id })
      .set({
        status: "cancelled",
        cancelledAt: args.cancelledAt,
        txHash: lowerHex(args.txHash),
      });
    return;
  }

  // Cancel arrived before any other event (partial backfill). Insert a
  // minimal cancelled row so the lifecycle is still represented.
  await args.context.db.insert(bufxRequest).values({
    requestId: id,
    chainId: args.context.chain.id,
    requestType: null,
    marketId: null,
    trader: lowerHex(args.trader),
    referrer: null,
    campaignId: null,
    amount: null,
    status: "cancelled",
    acceptedAt: args.cancelledAt,
    cancelledAt: args.cancelledAt,
    txHash: lowerHex(args.txHash),
  });
}

interface UpsertGatewayContextArgs {
  context: AnyBufxContext;
  requestId: Hex;
  routeId: Hex;
  telaranaGatewayHook: Address;
  gatewayAction: number;
  sourceDepositor: Address;
  sourceSigner: Address;
  recipient: Address;
  tokenOut: Address;
  amount: bigint;
  minAmountOut: bigint;
  spotRouteId: Hex;
  metadataRef: Hex;
}

async function upsertGatewayContext(args: UpsertGatewayContextArgs): Promise<void> {
  const row = {
    requestId: lowerHex(args.requestId),
    chainId: args.context.chain.id,
    routeId: lowerHex(args.routeId),
    telaranaGatewayHook: lowerHex(args.telaranaGatewayHook),
    gatewayAction: Number(args.gatewayAction),
    sourceDepositor: lowerHex(args.sourceDepositor),
    sourceSigner: lowerHex(args.sourceSigner),
    recipient: lowerHex(args.recipient),
    tokenOut: lowerHex(args.tokenOut),
    amount: args.amount,
    minAmountOut: args.minAmountOut,
    spotRouteId: lowerHex(args.spotRouteId),
    metadataRef: lowerHexOrNull(args.metadataRef, { treatZeroAsNull: true }),
  };

  await args.context.db
    .insert(telaranaGatewayContext)
    .values(row)
    .onConflictDoUpdate({
      routeId: row.routeId,
      telaranaGatewayHook: row.telaranaGatewayHook,
      gatewayAction: row.gatewayAction,
      sourceDepositor: row.sourceDepositor,
      sourceSigner: row.sourceSigner,
      recipient: row.recipient,
      tokenOut: row.tokenOut,
      amount: row.amount,
      minAmountOut: row.minAmountOut,
      spotRouteId: row.spotRouteId,
      metadataRef: row.metadataRef,
    });
}

