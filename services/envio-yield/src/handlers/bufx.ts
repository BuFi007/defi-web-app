import { indexer } from "envio";

const STATUS_RANK: Record<string, number> = {
  submitted: 1,
  fee_quoted: 2,
  accepted: 3,
  rfq_accepted: 3,
  perp_accepted: 3,
  gateway_prepared: 4,
  cancelled: 5,
};

// ─────────────────── Venue router ────────────────────────────────

indexer.onEvent(
  { contract: "BuFxVenueRequestRouter", event: "BuFxRequestAccepted" },
  async ({ event, context }) => {
    await upsertRequest(context, {
      requestId: event.params.requestId,
      chainId: event.chainId,
      requestType: event.params.requestType,
      marketId: event.params.marketId,
      trader: event.params.trader,
      referrer: event.params.referrer,
      campaignId: event.params.campaignId,
      amount: event.params.amount,
      status: "accepted",
      acceptedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "BuFxVenueRequestRouter", event: "BuFxRfqAccepted" },
  async ({ event, context }) => {
    await upsertRequest(context, {
      requestId: event.params.requestId,
      chainId: event.chainId,
      marketId: event.params.marketId,
      trader: event.params.trader,
      amount: event.params.amountIn,
      status: "rfq_accepted",
      acceptedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "BuFxVenueRequestRouter", event: "BuFxPerpLiquidityAccepted" },
  async ({ event, context }) => {
    await upsertRequest(context, {
      requestId: event.params.requestId,
      chainId: event.chainId,
      marketId: event.params.marketId,
      trader: event.params.trader,
      amount: event.params.notionalUsd,
      status: "perp_accepted",
      acceptedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "BuFxVenueRequestRouter", event: "BuFxRequestFeeQuoted" },
  async ({ event, context }) => {
    await upsertRequest(context, {
      requestId: event.params.requestId,
      chainId: event.chainId,
      requestType: event.params.requestType,
      marketId: event.params.marketId,
      trader: event.params.trader,
      referrer: event.params.referrer,
      amount: event.params.amount,
      status: "fee_quoted",
      acceptedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  },
);

// ─────────────────── Telarana router ─────────────────────────────

indexer.onEvent(
  { contract: "BuFxTelaranaRequestRouter", event: "TelaranaRequestSubmitted" },
  async ({ event, context }) => {
    await upsertRequest(context, {
      requestId: event.params.requestId,
      chainId: event.chainId,
      marketId: event.params.marketId,
      trader: event.params.trader,
      referrer: event.params.referrer,
      campaignId: event.params.campaignId,
      amount: event.params.amount,
      status: "submitted",
      acceptedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "BuFxTelaranaRequestRouter", event: "TelaranaGatewayMintContextPrepared" },
  async ({ event, context }) => {
    context.TelaranaGatewayContext.set({
      id: event.params.requestId.toLowerCase(),
      chainId: event.chainId,
      routeId: event.params.routeId.toLowerCase(),
      telaranaGatewayHook: event.params.telaranaGatewayHook.toLowerCase(),
      gatewayAction: Number(event.params.gatewayAction),
      sourceDepositor: event.params.sourceDepositor.toLowerCase(),
      sourceSigner: event.params.sourceSigner.toLowerCase(),
      recipient: event.params.recipient.toLowerCase(),
      tokenOut: event.params.tokenOut.toLowerCase(),
      amount: event.params.amount,
      minAmountOut: event.params.minAmountOut,
      spotRouteId: event.params.spotRouteId.toLowerCase(),
      metadataRef: event.params.metadataRef ?? "",
    });

    await upsertRequest(context, {
      requestId: event.params.requestId,
      chainId: event.chainId,
      trader: event.params.sourceSigner,
      amount: event.params.amount,
      status: "gateway_prepared",
      acceptedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "BuFxTelaranaRequestRouter", event: "TelaranaRequestCancelled" },
  async ({ event, context }) => {
    const id = event.params.requestId.toLowerCase();
    const existing = await context.BufxRequest.get(id);

    if (existing) {
      context.BufxRequest.set({
        ...existing,
        status: "cancelled",
        cancelledAt: event.block.timestamp,
        txHash: event.transaction.hash.toLowerCase(),
      });
    } else {
      context.BufxRequest.set({
        id,
        chainId: event.chainId,
        requestType: "",
        marketId: "",
        trader: event.params.trader.toLowerCase(),
        referrer: "",
        campaignId: "",
        amount: 0n,
        status: "cancelled",
        acceptedAt: event.block.timestamp,
        cancelledAt: event.block.timestamp,
        txHash: event.transaction.hash.toLowerCase(),
      });
    }
  },
);

// ─────────────────── helper ──────────────────────────────────────

interface UpsertArgs {
  requestId: string;
  chainId: number;
  requestType?: string;
  marketId?: string;
  trader?: string;
  referrer?: string;
  campaignId?: string;
  amount?: bigint;
  status: string;
  acceptedAt: number;
  txHash: string;
}

async function upsertRequest(context: any, args: UpsertArgs) {
  const id = args.requestId.toLowerCase();
  const existing = await context.BufxRequest.get(id);

  const nextStatus =
    existing && (STATUS_RANK[existing.status] ?? 0) >= (STATUS_RANK[args.status] ?? 0)
      ? existing.status
      : args.status;

  context.BufxRequest.set({
    id,
    chainId: args.chainId,
    requestType: args.requestType?.toLowerCase() ?? existing?.requestType ?? "",
    marketId: args.marketId?.toLowerCase() ?? existing?.marketId ?? "",
    trader: args.trader?.toLowerCase() ?? existing?.trader ?? "",
    referrer: args.referrer?.toLowerCase() ?? existing?.referrer ?? "",
    campaignId: args.campaignId?.toLowerCase() ?? existing?.campaignId ?? "",
    amount: args.amount ?? existing?.amount ?? 0n,
    status: nextStatus,
    acceptedAt: existing?.acceptedAt ?? args.acceptedAt,
    cancelledAt: existing?.cancelledAt ?? 0,
    txHash: args.txHash.toLowerCase(),
  });
}
