import type { DomainEvent, PerpIntent } from "@bufi/shared-types";
import type { Hex } from "viem";

export const PERPS_REPLACEMENT_NEEDED_EVENT = "bufx.perps.replacement_needed";
export const PERPS_REPLACEMENT_MCP_TOOL = "bufx.intent.perp.replace";

export interface BuildPerpsReplacementNeededEventArgs {
  intent: PerpIntent;
  settlementTx: Hex;
  role: "maker" | "taker";
  counterpartyIntentId: string;
  fillSizeDelta: bigint;
  fillPriceE18: bigint;
  emittedAt: number;
}

export function buildPerpsReplacementNeededEvent(
  args: BuildPerpsReplacementNeededEventArgs,
): DomainEvent {
  const prepareApiPath = `/perps/intents/${args.intent.intentId}/replacement/prepare`;
  return {
    eventId: `perps-replacement-needed:${args.settlementTx}:${args.intent.intentId}`,
    type: PERPS_REPLACEMENT_NEEDED_EVENT,
    aggregateId: args.intent.intentId,
    actor: args.intent.trader.toLowerCase(),
    createdAt: args.emittedAt,
    payload: {
      intentId: args.intent.intentId,
      replacementOf: args.intent.replacementOf ?? null,
      chainId: args.intent.chainId,
      trader: args.intent.trader,
      marketId: args.intent.marketId,
      side: args.intent.side,
      status: args.intent.status,
      filledSizeDelta: args.intent.filledSizeDelta,
      remainingSizeDelta: args.intent.remainingSizeDelta,
      role: args.role,
      counterpartyIntentId: args.counterpartyIntentId,
      fillSizeDelta: args.fillSizeDelta.toString(),
      fillPriceE18: args.fillPriceE18.toString(),
      settlementTx: args.settlementTx,
      prepareApiPath,
      mcpToolName: PERPS_REPLACEMENT_MCP_TOOL,
    },
  };
}
