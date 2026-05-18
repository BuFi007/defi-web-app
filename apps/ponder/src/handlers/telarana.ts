/**
 * FX Telaraña event handlers.
 *
 * Ponder.config.ts (lines 74-96) currently subscribes to FOUR Telaraña
 * contracts. The handler set below maps each subscribed event onto the
 * Telaraña schema rows in ponder.schema.ts.
 *
 * Subscribed contracts → handled events:
 *   • TelaranaGatewayHubHookArc (the Arc-side cross-chain market):
 *       GatewayHubRouteConfigured     → telaranaMarket upsert
 *       GatewayHubTransferRequested   → telaranaLoan insert (status='open')
 *       GatewayAtomicFxSwapRequested  → telaranaLoan insert (status='open')
 *       GatewayAtomicFxSwapSettled    → telaranaLoan update (status='repaid')
 *       GatewayHubLiquidityReceived   → telaranaLoan update (status='repaid')
 *   • FxSpotExecutorArc:
 *       SpotFxExecuted                → telaranaLoan update (status='repaid')
 *   • FxOracleArc:
 *       ConfigUpdated                 → telaranaOracleConfig upsert
 *   • FxHubMessageReceiverFuji (CCTP receipts on the Fuji spoke):
 *       DepositExecuted               → telaranaDeposit upsert (status='executed')
 *       DepositStranded               → telaranaDeposit upsert (status='stranded')
 *       DepositSwept                  → telaranaDeposit upsert (status='swept')
 *
 * Naming note: FxMarketRegistry's PositionOpened/Repaid/Liquidated do NOT
 * exist on the deployed ABI — its only events are MarketRegistered,
 * PoolLiveSet, plus AccessControl boilerplate. Telaraña expresses the loan
 * lifecycle through Morpho (the under-the-hood market) and the gateway-hook
 * cross-chain requests, so we use the gateway events as the canonical
 * "loan" lifecycle signal until BorrowEvent indexing on Morpho is added.
 *
 * Health-factor reconciliation: per-position HF is re-read from chain by
 * the liquidation scanner. We store `healthFactorBps = 0` on insert and
 * bump it via the `updatedAt` cursor — that's the cheap reconciliation
 * the original stub called for, without an extra RPC fan-out per event.
 */
import { ponder } from "ponder:registry";
import type { Context } from "ponder:registry";
import {
  telaranaDeposit,
  telaranaLoan,
  telaranaMarket,
  telaranaOracleConfig,
} from "ponder:schema";
import type { Address, Hex } from "viem";

type LoanEventName =
  | "TelaranaGatewayHubHookArc:GatewayHubTransferRequested"
  | "TelaranaGatewayHubHookArc:GatewayAtomicFxSwapRequested"
  | "TelaranaGatewayHubHookArc:GatewayAtomicFxSwapSettled"
  | "TelaranaGatewayHubHookArc:GatewayHubLiquidityReceived"
  | "FxSpotExecutorArc:SpotFxExecuted";

type DepositEventName =
  | "FxHubMessageReceiverFuji:DepositExecuted"
  | "FxHubMessageReceiverFuji:DepositStranded"
  | "FxHubMessageReceiverFuji:DepositSwept";

type LoanContext = Context<LoanEventName>;
type DepositContext = Context<DepositEventName>;

// ───────────────────────── TelaranaGatewayHubHook ──────────────────────────

ponder.on("TelaranaGatewayHubHookArc:GatewayHubRouteConfigured", async ({ event, context }) => {
  const marketIdValue = marketId(event.args.routeId);
  const row = {
    marketId: marketIdValue,
    chainId: context.chain.id,
    routeId: lowerHex(event.args.routeId),
    sourceDomain: Number(event.args.sourceDomain),
    destinationDomain: Number(event.args.destinationDomain),
    sourceUsdc: lowerHex(event.args.sourceUsdc),
    destinationUsdc: lowerHex(event.args.destinationUsdc),
    sourceGatewayWallet: lowerHex(event.args.sourceGatewayWallet),
    destinationGatewayMinter: lowerHex(event.args.destinationGatewayMinter),
    signerMode: Number(event.args.signerMode),
    enabled: event.args.enabled,
    metadataRef: lowerHexOrNull(event.args.metadataRef),
    registeredAt: event.block.timestamp,
    updatedAt: event.block.timestamp,
  };

  await context.db
    .insert(telaranaMarket)
    .values(row)
    .onConflictDoUpdate({
      chainId: row.chainId,
      sourceDomain: row.sourceDomain,
      destinationDomain: row.destinationDomain,
      sourceUsdc: row.sourceUsdc,
      destinationUsdc: row.destinationUsdc,
      sourceGatewayWallet: row.sourceGatewayWallet,
      destinationGatewayMinter: row.destinationGatewayMinter,
      signerMode: row.signerMode,
      enabled: row.enabled,
      metadataRef: row.metadataRef,
      updatedAt: row.updatedAt,
    });
});

ponder.on("TelaranaGatewayHubHookArc:GatewayHubTransferRequested", async ({ event, context }) => {
  await openLoanRow({
    context,
    requestId: event.args.requestId,
    borrower: event.args.sourceSigner,
    marketRouteId: event.args.routeId,
    collateralAmount: event.args.amount,
    borrowAmount: event.args.amount,
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

ponder.on("TelaranaGatewayHubHookArc:GatewayAtomicFxSwapRequested", async ({ event, context }) => {
  await openLoanRow({
    context,
    requestId: event.args.requestId,
    // SwapRequested has no `sourceSigner`; the recipient is the borrower
    // when this hook is invoked through the cross-chain intent path.
    borrower: event.args.recipient,
    marketRouteId: event.args.routeId,
    collateralAmount: event.args.amountIn,
    borrowAmount: event.args.minAmountOut,
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

ponder.on("TelaranaGatewayHubHookArc:GatewayAtomicFxSwapSettled", async ({ event, context }) => {
  await closeLoanRow({
    context,
    requestId: event.args.requestId,
    status: "repaid",
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

ponder.on("TelaranaGatewayHubHookArc:GatewayHubLiquidityReceived", async ({ event, context }) => {
  await closeLoanRow({
    context,
    requestId: event.args.requestId,
    status: "repaid",
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

// ───────────────────────────── FxSpotExecutor ──────────────────────────────

ponder.on("FxSpotExecutorArc:SpotFxExecuted", async ({ event, context }) => {
  // Mirrors GatewayAtomicFxSwapSettled — the spot executor and the gateway
  // hook both emit on the same requestId, so we keep them idempotent by
  // updating the same row.
  await closeLoanRow({
    context,
    requestId: event.args.requestId,
    status: "repaid",
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

// ──────────────────────────────── FxOracle ─────────────────────────────────

ponder.on("FxOracleArc:ConfigUpdated", async ({ event, context }) => {
  const row = {
    chainId: context.chain.id,
    maxAge: event.args.maxOracleAge,
    maxDeviationBps: event.args.maxDeviationBps,
    maxConfidenceBps: event.args.maxConfidenceBps,
    updatedAt: event.block.timestamp,
    updatedTxHash: lowerHex(event.transaction.hash),
  };

  await context.db
    .insert(telaranaOracleConfig)
    .values(row)
    .onConflictDoUpdate({
      maxAge: row.maxAge,
      maxDeviationBps: row.maxDeviationBps,
      maxConfidenceBps: row.maxConfidenceBps,
      updatedAt: row.updatedAt,
      updatedTxHash: row.updatedTxHash,
    });
});

// ──────────────────────── FxHubMessageReceiver (Fuji) ──────────────────────

ponder.on("FxHubMessageReceiverFuji:DepositExecuted", async ({ event, context }) => {
  await upsertDeposit({
    context,
    messageNonce: event.args.messageNonce,
    beneficiary: event.args.beneficiary,
    amount: event.args.amount,
    status: "executed",
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

ponder.on("FxHubMessageReceiverFuji:DepositStranded", async ({ event, context }) => {
  await upsertDeposit({
    context,
    messageNonce: event.args.messageNonce,
    beneficiary: event.args.beneficiary,
    amount: event.args.amount,
    status: "stranded",
    reason: event.args.reason,
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

ponder.on("FxHubMessageReceiverFuji:DepositSwept", async ({ event, context }) => {
  await upsertDeposit({
    context,
    messageNonce: event.args.messageNonce,
    beneficiary: event.args.beneficiary,
    amount: event.args.amount,
    status: "swept",
    blockTimestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

// ────────────────────────────── helpers ────────────────────────────────────

interface OpenLoanArgs {
  context: LoanContext;
  requestId: Hex;
  borrower: Address;
  marketRouteId: Hex;
  collateralAmount: bigint;
  borrowAmount: bigint;
  blockTimestamp: bigint;
  txHash: Hex;
}

async function openLoanRow(args: OpenLoanArgs): Promise<void> {
  const row = {
    positionId: positionIdFromRequest(args.requestId),
    chainId: args.context.chain.id,
    borrower: lowerHex(args.borrower),
    marketId: marketId(args.marketRouteId),
    collateralAmount: args.collateralAmount,
    borrowAmount: args.borrowAmount,
    healthFactorBps: 0, // reconciled by the liquidation scanner
    status: "open" as const,
    openedAt: args.blockTimestamp,
    openedTxHash: lowerHex(args.txHash),
    repaidAt: null,
    repaidTxHash: null,
    liquidatedAt: null,
    liquidatedTxHash: null,
    updatedAt: args.blockTimestamp,
  };

  await args.context.db
    .insert(telaranaLoan)
    .values(row)
    .onConflictDoNothing();
}

interface CloseLoanArgs {
  context: LoanContext;
  requestId: Hex;
  status: "repaid" | "liquidated";
  blockTimestamp: bigint;
  txHash: Hex;
}

async function closeLoanRow(args: CloseLoanArgs): Promise<void> {
  const id = positionIdFromRequest(args.requestId);
  const isRepaid = args.status === "repaid";
  const patch = {
    status: args.status,
    updatedAt: args.blockTimestamp,
    repaidAt: isRepaid ? args.blockTimestamp : null,
    repaidTxHash: isRepaid ? lowerHex(args.txHash) : null,
    liquidatedAt: !isRepaid ? args.blockTimestamp : null,
    liquidatedTxHash: !isRepaid ? lowerHex(args.txHash) : null,
  };

  // If the open event wasn't indexed (e.g. partial backfill), insert a
  // best-effort closing row so the position still appears in queries.
  await args.context.db
    .insert(telaranaLoan)
    .values({
      positionId: id,
      chainId: args.context.chain.id,
      borrower: "0x0000000000000000000000000000000000000000" as Hex,
      marketId: id,
      collateralAmount: 0n,
      borrowAmount: 0n,
      healthFactorBps: 0,
      status: args.status,
      openedAt: args.blockTimestamp,
      openedTxHash: lowerHex(args.txHash),
      repaidAt: patch.repaidAt,
      repaidTxHash: patch.repaidTxHash,
      liquidatedAt: patch.liquidatedAt,
      liquidatedTxHash: patch.liquidatedTxHash,
      updatedAt: args.blockTimestamp,
    })
    .onConflictDoUpdate(patch);
}

interface UpsertDepositArgs {
  context: DepositContext;
  messageNonce: Hex;
  beneficiary: Address;
  amount: bigint;
  status: "executed" | "stranded" | "swept";
  reason?: Hex;
  blockTimestamp: bigint;
  txHash: Hex;
}

async function upsertDeposit(args: UpsertDepositArgs): Promise<void> {
  const base = {
    messageNonce: lowerHex(args.messageNonce),
    chainId: args.context.chain.id,
    beneficiary: lowerHex(args.beneficiary),
    amount: args.amount,
    status: args.status,
    reason: args.reason ? lowerHex(args.reason) : null,
    executedAt: args.status === "executed" ? args.blockTimestamp : null,
    strandedAt: args.status === "stranded" ? args.blockTimestamp : null,
    sweptAt: args.status === "swept" ? args.blockTimestamp : null,
    updatedTxHash: lowerHex(args.txHash),
  };

  await args.context.db
    .insert(telaranaDeposit)
    .values(base)
    .onConflictDoUpdate({
      status: args.status,
      amount: args.amount,
      reason: base.reason,
      updatedTxHash: base.updatedTxHash,
      executedAt: args.status === "executed" ? args.blockTimestamp : undefined,
      strandedAt: args.status === "stranded" ? args.blockTimestamp : undefined,
      sweptAt: args.status === "swept" ? args.blockTimestamp : undefined,
    });
}

function positionIdFromRequest(requestId: Hex): string {
  return lowerHex(requestId);
}

function marketId(routeId: Hex): string {
  return lowerHex(routeId);
}

function lowerHex<T extends Hex>(value: T): T {
  return value.toLowerCase() as T;
}

function lowerHexOrNull(value: Hex | undefined | null): Hex | null {
  if (!value) return null;
  // bytes32(0) is a sentinel for "no metadata".
  if (/^0x0+$/i.test(value)) return null;
  return value.toLowerCase() as Hex;
}
