import type { PerpIntent } from "@bufi/shared-types";

export interface PerpsIndexedSettlement {
  id?: string;
  chainId: number;
  marketId: string;
  maker: string;
  taker: string;
  fillSizeE18: string | bigint;
  fillPriceE18: string | bigint;
  blockNumber?: string | bigint;
  blockTimestamp?: string | bigint;
  txHash?: string;
  logIndex?: number;
}

export interface PerpsIntentReconciliation {
  intentId: string;
  status:
    | "unfilled"
    | "matched"
    | "backend_ahead_of_indexer"
    | "indexer_ahead_of_backend"
    | "needs_review";
  backend: {
    status: PerpIntent["status"];
    filledSizeDelta: string;
    remainingSizeDelta: string;
    absFilledSizeE18: string;
  };
  indexed: {
    settlementCount: number;
    absFilledSizeE18: string;
    signedFillSizeDelta: string;
    settlements: PerpsIndexedSettlement[];
  };
  discrepancies: string[];
}

export function reconcilePerpsIntentWithSettlements(
  intent: PerpIntent,
  settlements: PerpsIndexedSettlement[],
): PerpsIntentReconciliation {
  const matchingSettlements = settlements.filter((settlement) =>
    settlementMatchesIntent(intent, settlement),
  );
  const backendAbsFilled = abs(BigInt(intent.filledSizeDelta));
  const indexedAbsFilled = matchingSettlements.reduce(
    (sum, settlement) => sum + BigInt(settlement.fillSizeE18),
    0n,
  );
  const signedIndexedFill =
    BigInt(intent.sizeDelta) < 0n ? -indexedAbsFilled : indexedAbsFilled;
  const discrepancies: string[] = [];

  let status: PerpsIntentReconciliation["status"];
  if (backendAbsFilled === 0n && indexedAbsFilled === 0n) {
    status = "unfilled";
  } else if (backendAbsFilled === indexedAbsFilled) {
    status = "matched";
  } else if (backendAbsFilled > indexedAbsFilled) {
    status = "backend_ahead_of_indexer";
    discrepancies.push(
      `backend filled ${backendAbsFilled.toString()} but indexer has ${indexedAbsFilled.toString()}`,
    );
  } else if (backendAbsFilled < indexedAbsFilled) {
    status = "indexer_ahead_of_backend";
    discrepancies.push(
      `indexer filled ${indexedAbsFilled.toString()} but backend has ${backendAbsFilled.toString()}`,
    );
  } else {
    status = "needs_review";
  }

  if (intent.status === "filled" && BigInt(intent.remainingSizeDelta) !== 0n) {
    status = "needs_review";
    discrepancies.push("intent is filled but remainingSizeDelta is nonzero");
  }
  if (intent.status === "partially_filled" && BigInt(intent.remainingSizeDelta) === 0n) {
    status = "needs_review";
    discrepancies.push("intent is partially_filled but remainingSizeDelta is zero");
  }

  return {
    intentId: intent.intentId,
    status,
    backend: {
      status: intent.status,
      filledSizeDelta: intent.filledSizeDelta,
      remainingSizeDelta: intent.remainingSizeDelta,
      absFilledSizeE18: backendAbsFilled.toString(),
    },
    indexed: {
      settlementCount: matchingSettlements.length,
      absFilledSizeE18: indexedAbsFilled.toString(),
      signedFillSizeDelta: signedIndexedFill.toString(),
      settlements: matchingSettlements,
    },
    discrepancies,
  };
}

function settlementMatchesIntent(
  intent: PerpIntent,
  settlement: PerpsIndexedSettlement,
): boolean {
  if (settlement.chainId !== intent.chainId) return false;
  if (settlement.marketId.toLowerCase() !== intent.marketId.toLowerCase()) return false;
  const trader = intent.trader.toLowerCase();
  return settlement.maker.toLowerCase() === trader || settlement.taker.toLowerCase() === trader;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
