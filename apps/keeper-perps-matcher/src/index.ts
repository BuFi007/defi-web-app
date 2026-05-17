import { FxOrderSettlementAbi, loadContracts } from "@bufi/contracts";
import { createTradingMachineDbFromEnv } from "@bufi/db";
import { createKeeperWalletClient, requireKeeperSigner, runKeeper } from "@bufi/keeper-runtime";
import {
  PERPS_REPLACEMENT_NEEDED_EVENT,
  buildPerpsReplacementNeededEvent,
  matchPriceTimePriority,
  type PriceTimeMatch,
} from "@bufi/perps";
import type { PerpIntent } from "@bufi/shared-types";
import type { Hex } from "viem";

const ARC_CHAIN_ID = 5042002;
const db = createTradingMachineDbFromEnv();

await runKeeper({
  name: "@bufi/keeper-perps-matcher",
  async tick(ctx) {
    requireKeeperSigner(ctx);
    const orderSettlement = loadContracts()[ARC_CHAIN_ID].perps.orderSettlement;
    if (!orderSettlement) {
      ctx.log.warn("perps_matcher.not_configured", {
        missing: "perps.orderSettlement",
      });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const pending = (await db.perpsIntents.list({ status: "pending" }))
      .filter((intent) => intent.chainId === ARC_CHAIN_ID);
    const expired = pending.filter((intent) => intent.deadline <= now);
    const ready = pending.filter((intent) => intent.deadline > now);

    for (const intent of expired) {
      await db.perpsIntents.updateStatus(intent.intentId, "expired");
    }

    const wallet = createKeeperWalletClient(ctx, "arc");
    const matches = matchPriceTimePriority(ready);
    const settled: Array<{ maker: string; taker: string; tx: string }> = [];
    const failed: Array<{ maker: string; taker: string; error: string }> = [];
    const replacementNeeded: string[] = [];

    for (const match of matches) {
      try {
        const hash = await wallet.writeContract({
          chain: null,
          account: wallet.account!,
          address: orderSettlement,
          abi: FxOrderSettlementAbi,
          functionName: "settleMatch",
          args: [
            intentToSignedOrder(match.maker),
            match.maker.signature,
            intentToSignedOrder(match.taker),
            match.taker.signature,
            match.fillSizeE18,
            match.fillPriceE18,
          ],
        });
        const maker = await db.perpsIntents.recordFill(match.maker.intentId, match.makerFillSizeDelta);
        const taker = await db.perpsIntents.recordFill(match.taker.intentId, match.takerFillSizeDelta);
        const emitted = await emitReplacementNeededEvents({
          match,
          maker,
          taker,
          tx: hash,
        });
        for (const event of emitted) {
          replacementNeeded.push(event.intentId);
          ctx.log.info(PERPS_REPLACEMENT_NEEDED_EVENT, {
            eventId: event.eventId,
            ...event.payload,
          });
        }
        settled.push({ maker: match.maker.intentId, taker: match.taker.intentId, tx: hash });
      } catch (e) {
        failed.push({
          maker: match.maker.intentId,
          taker: match.taker.intentId,
          error: (e as Error).message,
        });
      }
    }

    ctx.log.info("perps_matcher.scan", {
      pending: pending.length,
      expired: expired.length,
      ready: ready.length,
      matches: matches.length,
      partials: matches.filter((match) => isPartial(match)).length,
      replacementNeeded,
      settled,
      failed,
    });
  },
});

function intentToSignedOrder(intent: PerpIntent) {
  return {
    trader: intent.trader,
    marketId: intent.marketId as Hex,
    sizeDeltaE18: BigInt(intent.sizeDelta),
    priceE18: BigInt(intent.priceE18),
    orderType: intent.orderType === "market" ? 0 : 1,
    flags: intent.flags,
    nonce: intent.nonce,
    deadline: BigInt(intent.deadline),
  };
}

function isPartial(match: PriceTimeMatch): boolean {
  return match.makerRemainingSizeDelta !== 0n || match.takerRemainingSizeDelta !== 0n;
}

async function emitReplacementNeededEvents(args: {
  match: PriceTimeMatch;
  maker: PerpIntent;
  taker: PerpIntent;
  tx: Hex;
}): Promise<Array<{ intentId: string; eventId: string; payload: Record<string, unknown> }>> {
  const emittedAt = Math.floor(Date.now() / 1000);
  const maybeEvents = [
    args.maker.status === "partially_filled"
      ? buildPerpsReplacementNeededEvent({
          intent: args.maker,
          settlementTx: args.tx,
          role: "maker",
          counterpartyIntentId: args.taker.intentId,
          fillSizeDelta: args.match.makerFillSizeDelta,
          fillPriceE18: args.match.fillPriceE18,
          emittedAt,
        })
      : null,
    args.taker.status === "partially_filled"
      ? buildPerpsReplacementNeededEvent({
          intent: args.taker,
          settlementTx: args.tx,
          role: "taker",
          counterpartyIntentId: args.maker.intentId,
          fillSizeDelta: args.match.takerFillSizeDelta,
          fillPriceE18: args.match.fillPriceE18,
          emittedAt,
        })
      : null,
  ];

  const emitted: Array<{ intentId: string; eventId: string; payload: Record<string, unknown> }> = [];
  for (const event of maybeEvents) {
    if (!event) continue;
    await db.events.put(event);
    emitted.push({ intentId: event.aggregateId, eventId: event.eventId, payload: event.payload });
  }
  return emitted;
}
