import { FxOrderSettlementAbi, loadContracts } from "@bufi/contracts";
import { createTradingMachineDbFromEnv } from "@bufi/db";
import { createKeeperWalletClient, requireKeeperSigner, runKeeper } from "@bufi/keeper-runtime";
import { withSpan } from "@bufi/observability";
import {
  PERPS_REPLACEMENT_NEEDED_EVENT,
  buildPerpsReplacementNeededEvent,
  matchPriceTimePriority,
  type PriceTimeMatch,
} from "@bufi/perps";
import type { PerpIntent } from "@bufi/shared-types";
import { keccak256, toHex, type Hex, type PublicClient, type WalletClient } from "viem";

const ARC_CHAIN_ID = 5042002;
const db = createTradingMachineDbFromEnv();
const SETTLEMENT_MODE = process.env.PERPS_MATCHER_SETTLEMENT_MODE ?? "live";
if (SETTLEMENT_MODE === "mock" && process.env.NODE_ENV === "production") {
  throw new Error("PERPS_MATCHER_SETTLEMENT_MODE=mock is not allowed in production");
}

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
    const matches = await withSpan(
      "perps.matcher.match-loop",
      () => matchPriceTimePriority(ready),
      { "matcher.intents_pending": ready.length },
      "keeper.perps-matcher",
    );
    const settled: Array<{ maker: string; taker: string; tx: string }> = [];
    const failed: Array<{ maker: string; taker: string; error: string }> = [];
    const replacementNeeded: string[] = [];

    for (const match of matches) {
      try {
        const hash = await withSpan(
          "perps.matcher.settle-match",
          () =>
            settleMatch({
              publicClient: ctx.clients.arc,
              wallet,
              orderSettlement,
              match,
            }),
          {
            "matcher.maker_intent_id": match.maker.intentId,
            "matcher.taker_intent_id": match.taker.intentId,
            "matcher.market_id": match.maker.marketId,
            "matcher.settlement_mode": SETTLEMENT_MODE,
          },
          "keeper.perps-matcher",
        );
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

    // Only log when there's signal — pending/expired/matched/settled/
    // failed activity. Skip the dead-quiet ticks (`pending: 0, ready:
    // 0, matches: 0, ...`) that otherwise dominate dev:complete.
    if (
      pending.length > 0 ||
      expired.length > 0 ||
      matches.length > 0 ||
      replacementNeeded.length > 0 ||
      settled.length > 0 ||
      failed.length > 0
    ) {
      ctx.log.info("perps_matcher.scan", {
        pending: pending.length,
        expired: expired.length,
        ready: ready.length,
        matches: matches.length,
        partials: matches.filter((match) => isPartial(match)).length,
        replacementNeeded,
        settled,
        failed,
        settlementMode: SETTLEMENT_MODE,
      });
    }
  },
});

async function settleMatch(args: {
  publicClient: PublicClient;
  wallet: WalletClient;
  orderSettlement: Hex;
  match: PriceTimeMatch;
}): Promise<Hex> {
  if (SETTLEMENT_MODE === "mock") {
    return keccak256(
      toHex(
        [
          "mock-settleMatch",
          args.match.maker.intentId,
          args.match.taker.intentId,
          args.match.fillSizeE18.toString(),
          args.match.fillPriceE18.toString(),
        ].join(":"),
      ),
    );
  }
  if (SETTLEMENT_MODE !== "live") {
    throw new Error(`unknown PERPS_MATCHER_SETTLEMENT_MODE: ${SETTLEMENT_MODE}`);
  }

  const hash = await args.wallet.writeContract({
    chain: null,
    account: args.wallet.account!,
    address: args.orderSettlement,
    abi: FxOrderSettlementAbi,
    functionName: "settleMatch",
    args: [
      intentToSignedOrder(args.match.maker),
      args.match.maker.signature,
      intentToSignedOrder(args.match.taker),
      args.match.taker.signature,
      args.match.fillSizeE18,
      args.match.fillPriceE18,
    ],
  });
  const receipt = await args.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`settleMatch reverted: ${hash}`);
  }
  return hash;
}

function intentToSignedOrder(intent: PerpIntent) {
  return {
    trader: intent.trader,
    marketId: intent.marketId as Hex,
    sizeDeltaE18: BigInt(intent.sizeDelta),
    priceE18: BigInt(intent.priceE18),
    // PerpIntent doesn't carry maxFee yet — the ABI requires it on
    // SignedOrder, so we ship zero (uncapped). Real maxFee lands when
    // the order schema picks up the field; until then traders accept
    // whatever fee the matcher computes server-side.
    maxFee: 0n,
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
