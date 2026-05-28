import { indexer } from "envio";

// ─────────────────── TelaranaGatewayHubHook ──────────────────────

indexer.onEvent(
  { contract: "TelaranaGatewayHubHook", event: "GatewayHubRouteConfigured" },
  async ({ event, context }) => {
    const routeId = event.params.routeId.toLowerCase();
    context.TelaranaMarket.set({
      id: `${event.chainId}_${routeId}`,
      chainId: event.chainId,
      routeId,
      sourceDomain: Number(event.params.sourceDomain),
      destinationDomain: Number(event.params.destinationDomain),
      sourceUsdc: event.params.sourceUsdc.toLowerCase(),
      destinationUsdc: event.params.destinationUsdc.toLowerCase(),
      sourceGatewayWallet: event.params.sourceGatewayWallet.toLowerCase(),
      destinationGatewayMinter: event.params.destinationGatewayMinter.toLowerCase(),
      signerMode: Number(event.params.signerMode),
      enabled: event.params.enabled,
      metadataRef: event.params.metadataRef ?? "",
      registeredAt: event.block.timestamp,
      updatedAt: event.block.timestamp,
    });
  },
);

indexer.onEvent(
  { contract: "TelaranaGatewayHubHook", event: "GatewayHubTransferRequested" },
  async ({ event, context }) => {
    openLoan(context, {
      requestId: event.params.requestId,
      chainId: event.chainId,
      borrower: event.params.sourceSigner,
      marketId: event.params.routeId,
      collateralAmount: event.params.amount,
      borrowAmount: event.params.amount,
      blockTimestamp: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "TelaranaGatewayHubHook", event: "GatewayAtomicFxSwapRequested" },
  async ({ event, context }) => {
    openLoan(context, {
      requestId: event.params.requestId,
      chainId: event.chainId,
      borrower: event.params.recipient,
      marketId: event.params.routeId,
      collateralAmount: event.params.amountIn,
      borrowAmount: event.params.minAmountOut,
      blockTimestamp: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "TelaranaGatewayHubHook", event: "GatewayAtomicFxSwapSettled" },
  async ({ event, context }) => {
    await closeLoan(context, event.params.requestId, "repaid", event.chainId, event.block.timestamp, event.transaction.hash);
  },
);

indexer.onEvent(
  { contract: "TelaranaGatewayHubHook", event: "GatewayHubLiquidityReceived" },
  async ({ event, context }) => {
    await closeLoan(context, event.params.requestId, "repaid", event.chainId, event.block.timestamp, event.transaction.hash);
  },
);

// ─────────────────── FxOracle ────────────────────────────────────

indexer.onEvent(
  { contract: "FxOracle", event: "ConfigUpdated" },
  async ({ event, context }) => {
    context.TelaranaOracleConfig.set({
      id: `${event.chainId}`,
      chainId: event.chainId,
      maxAge: event.params.maxOracleAge,
      maxDeviationBps: event.params.maxDeviationBps,
      maxConfidenceBps: event.params.maxConfidenceBps,
      updatedAt: event.block.timestamp,
      updatedTxHash: event.transaction.hash.toLowerCase(),
    });
  },
);

// ─────────────────── FxHubMessageReceiver (Fuji) ─────────────────

indexer.onEvent(
  { contract: "FxHubMessageReceiver", event: "DepositExecuted" },
  async ({ event, context }) => {
    upsertDeposit(context, event.chainId, event.params.messageNonce, event.params.beneficiary, event.params.amount, "executed", "", event.block.timestamp, event.transaction.hash);
  },
);

indexer.onEvent(
  { contract: "FxHubMessageReceiver", event: "DepositStranded" },
  async ({ event, context }) => {
    upsertDeposit(context, event.chainId, event.params.messageNonce, event.params.beneficiary, event.params.amount, "stranded", event.params.reason ?? "", event.block.timestamp, event.transaction.hash);
  },
);

indexer.onEvent(
  { contract: "FxHubMessageReceiver", event: "DepositSwept" },
  async ({ event, context }) => {
    upsertDeposit(context, event.chainId, event.params.messageNonce, event.params.beneficiary, event.params.amount, "swept", "", event.block.timestamp, event.transaction.hash);
  },
);

// ─────────────────── helpers ─────────────────────────────────────

function openLoan(
  context: any,
  args: {
    requestId: string;
    chainId: number;
    borrower: string;
    marketId: string;
    collateralAmount: bigint;
    borrowAmount: bigint;
    blockTimestamp: number;
    txHash: string;
  },
) {
  const id = `${args.chainId}_${args.requestId.toLowerCase()}`;
  context.TelaranaLoan.set({
    id,
    chainId: args.chainId,
    borrower: args.borrower.toLowerCase(),
    marketId: args.marketId.toLowerCase(),
    collateralAmount: args.collateralAmount,
    borrowAmount: args.borrowAmount,
    healthFactorBps: 0,
    status: "open",
    openedAt: args.blockTimestamp,
    openedTxHash: args.txHash.toLowerCase(),
    repaidAt: 0,
    repaidTxHash: "",
    liquidatedAt: 0,
    liquidatedTxHash: "",
    updatedAt: args.blockTimestamp,
  });
}

async function closeLoan(
  context: any,
  requestId: string,
  status: "repaid" | "liquidated",
  chainId: number,
  blockTimestamp: number,
  txHash: string,
) {
  const id = `${chainId}_${requestId.toLowerCase()}`;
  const existing = await context.TelaranaLoan.get(id);

  if (existing) {
    context.TelaranaLoan.set({
      ...existing,
      status,
      updatedAt: blockTimestamp,
      repaidAt: status === "repaid" ? blockTimestamp : existing.repaidAt,
      repaidTxHash: status === "repaid" ? txHash.toLowerCase() : existing.repaidTxHash,
      liquidatedAt: status === "liquidated" ? blockTimestamp : existing.liquidatedAt,
      liquidatedTxHash: status === "liquidated" ? txHash.toLowerCase() : existing.liquidatedTxHash,
    });
  } else {
    context.TelaranaLoan.set({
      id,
      chainId,
      borrower: "",
      marketId: requestId.toLowerCase(),
      collateralAmount: 0n,
      borrowAmount: 0n,
      healthFactorBps: 0,
      status,
      openedAt: blockTimestamp,
      openedTxHash: txHash.toLowerCase(),
      repaidAt: status === "repaid" ? blockTimestamp : 0,
      repaidTxHash: status === "repaid" ? txHash.toLowerCase() : "",
      liquidatedAt: status === "liquidated" ? blockTimestamp : 0,
      liquidatedTxHash: status === "liquidated" ? txHash.toLowerCase() : "",
      updatedAt: blockTimestamp,
    });
  }
}

function upsertDeposit(
  context: any,
  chainId: number,
  messageNonce: string,
  beneficiary: string,
  amount: bigint,
  status: "executed" | "stranded" | "swept",
  reason: string,
  blockTimestamp: number,
  txHash: string,
) {
  const id = `${chainId}_${messageNonce.toLowerCase()}`;
  context.TelaranaDeposit.set({
    id,
    chainId,
    beneficiary: beneficiary.toLowerCase(),
    amount,
    status,
    reason: reason.toLowerCase(),
    executedAt: status === "executed" ? blockTimestamp : 0,
    strandedAt: status === "stranded" ? blockTimestamp : 0,
    sweptAt: status === "swept" ? blockTimestamp : 0,
    updatedTxHash: txHash.toLowerCase(),
  });
}
