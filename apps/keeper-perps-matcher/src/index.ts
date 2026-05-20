import { FxOrderSettlementAbi, loadContracts } from "@bufi/contracts";
import { createTradingMachineDbFromEnv } from "@bufi/db";
import {
  createKeeperWalletClient,
  requireKeeperSigner,
  runKeeper,
  type KeeperContext,
} from "@bufi/keeper-runtime";
import {
  PERPS_REPLACEMENT_NEEDED_EVENT,
  buildPerpsReplacementNeededEvent,
  matchPriceTimePriority,
  type PriceTimeMatch,
} from "@bufi/perps";
import {
  PERPS_INTENT_INSERTED_CHANNEL,
  subscribeChannel,
  type PerpsIntentInsertedMessage,
} from "@bufi/realtime";
import type { PerpIntent } from "@bufi/shared-types";
import { createLogger } from "@bufinance/logger";
import { keccak256, toHex, type Hex, type PublicClient, type WalletClient } from "viem";

const ARC_CHAIN_ID = 5042002;
const db = createTradingMachineDbFromEnv();
const SETTLEMENT_MODE = process.env.PERPS_MATCHER_SETTLEMENT_MODE ?? "live";
if (SETTLEMENT_MODE === "mock" && process.env.NODE_ENV === "production") {
  throw new Error("PERPS_MATCHER_SETTLEMENT_MODE=mock is not allowed in production");
}

// ---------- mutex + notify-coalesce ----------
//
// The match pass runs from two paths:
//   1. keeper-runtime's poll tick (every KEEPER_POLL_MS, default 30s)
//   2. a Redis subscribe callback on perps:intent:inserted (sub-second)
//
// Both touch the same SQLite store + send the same settleMatch tx, so we
// serialize them through `running` + coalesce overlapping notifies via
// `pendingRerun`. The pass itself is idempotent at the DB layer
// (matchPriceTimePriority skips already-filled intents because their
// status flips off "pending" inside recordFill), but serializing avoids
// two passes racing to settle the same maker/taker pair.

let running = false;
let pendingRerun = false;
let nudgeCtx: KeeperContext | null = null;

const subscribeLog = createLogger({ prefix: "@bufi/keeper-perps-matcher.notify" });

async function runMatchPass(ctx: KeeperContext, trigger: "poll" | "notify"): Promise<void> {
  if (running) {
    // A pass is already in flight. Mark a re-run so the in-flight pass
    // schedules another iteration on completion. Without this a notify
    // arriving mid-pass would be silently dropped.
    pendingRerun = true;
    return;
  }
  running = true;
  try {
    for (;;) {
      pendingRerun = false;
      await matchPassOnce(ctx, trigger);
      if (!pendingRerun) return;
      // Another notify came in while we were settling — loop once more
      // (without releasing the mutex) so the freshly-inserted intent
      // gets considered without waiting for the next poll tick.
    }
  } finally {
    running = false;
  }
}

async function matchPassOnce(ctx: KeeperContext, trigger: "poll" | "notify"): Promise<void> {
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
      const hash = await settleMatch({
        publicClient: ctx.clients.arc,
        wallet,
        orderSettlement,
        match,
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
      trigger,
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
}

// ---------- subscribe bootstrap ----------
//
// Wave H1: subscribe to perps:intent:inserted so a freshly-persisted
// intent triggers an early match pass (~100ms vs the 30s poll fallback).
//
// When REDIS_URL is unset the subscribe lands on the in-process
// EventEmitter — which only crosses process boundaries inside a single
// Bun process. Matcher + apps/api running in SEPARATE processes (the
// canonical layout) won't see each other through the emitter; the poll
// fallback is the only path in that case. Documented in
// docs/runbook/MATCHER_REDIS_NOTIFY.md.
//
// On subscribe failure (e.g. Redis client error during boot) we log and
// retry every 5s. We never crash the keeper — the poll fallback keeps
// the matcher functional even if the broker is permanently dead.

function attachIntentInsertedSubscribe(ctx: KeeperContext): void {
  nudgeCtx = ctx;
  const attach = (): void => {
    try {
      subscribeChannel(PERPS_INTENT_INSERTED_CHANNEL, (raw) => {
        const msg = raw as PerpsIntentInsertedMessage;
        if (msg?.chainId !== ARC_CHAIN_ID) {
          // Multi-chain rollout puts other matchers on this channel; we
          // only care about Arc. Drop without logging — it's noise.
          return;
        }
        // Fire-and-forget; runMatchPass internally serializes against
        // in-flight passes via the `running` mutex.
        const localCtx = nudgeCtx;
        if (!localCtx) return;
        void runMatchPass(localCtx, "notify").catch((err) => {
          subscribeLog.warn(
            { intentId: msg.intentId, err: (err as Error).message },
            "perps_matcher.notify_pass_failed",
          );
        });
      });
      subscribeLog.info(
        { channel: PERPS_INTENT_INSERTED_CHANNEL },
        "perps_matcher.subscribe_ready",
      );
    } catch (err) {
      // Subscribe call should never throw synchronously (PR #56's surface
      // never raises on the configure path) but belt-and-suspenders: if
      // it does, retry after a backoff so a transient client init failure
      // doesn't permanently silence the notify path.
      subscribeLog.warn(
        { err: (err as Error).message },
        "perps_matcher.subscribe_attach_failed_retrying",
      );
      setTimeout(attach, 5_000);
    }
  };
  attach();
}

// ---------- keeper boot ----------

let subscribeAttached = false;

await runKeeper({
  name: "@bufi/keeper-perps-matcher",
  async tick(ctx) {
    if (!subscribeAttached) {
      // Defer subscribe attachment to the first tick so we have a live
      // KeeperContext (logger, clients, env) to hand the notify path.
      // Idempotent — attachIntentInsertedSubscribe only registers once.
      attachIntentInsertedSubscribe(ctx);
      subscribeAttached = true;
    }
    await runMatchPass(ctx, "poll");
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
