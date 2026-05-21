import { FxFundingEngineAbi, loadContracts } from "@bufi/contracts";
import {
  createKeeperWalletClient,
  postPublish,
  requireKeeperSigner,
  runKeeper,
} from "@bufi/keeper-runtime";
import { mapFundingPokedToPublish } from "@bufi/keeper-runtime/publish-mappers";
import { withSpan } from "@bufi/observability";
import { livePerpsMarketIds } from "@bufi/perps";
import { decodeEventLog, type Hex } from "viem";

const ARC_CHAIN_ID = 5042002;

// Funding rates only need to refresh on the funding interval (Arc deployment
// uses 1h). The keeper ticks every 5s for liveness, so per-market throttle
// the actual on-chain poke to FUNDING_POKE_MIN_INTERVAL_MS. Override via env
// for staging/load tests.
const FUNDING_POKE_MIN_INTERVAL_MS = Number(
  process.env.FUNDING_POKE_MIN_INTERVAL_MS ?? 60 * 60 * 1000,
);

const lastPokeAt = new Map<string, number>();

await runKeeper({
  name: "@bufi/keeper-perps-funding",
  async tick(ctx) {
    requireKeeperSigner(ctx);
    const contracts = loadContracts()[ARC_CHAIN_ID];
    const fundingEngine = contracts.perps.fundingEngine;
    if (!fundingEngine) {
      ctx.log.warn("perps_funding.not_configured", {
        missing: "perps.fundingEngine",
      });
      return;
    }
    const wallet = createKeeperWalletClient(ctx, "arc");
    const marketIds = activeMarketIds();
    const now = Date.now();
    const poked: Array<{ marketId: string; tx: string }> = [];
    const throttled: string[] = [];
    const failed: Array<{ marketId: string; error: string }> = [];

    for (const marketId of marketIds) {
      const last = lastPokeAt.get(marketId) ?? 0;
      if (now - last < FUNDING_POKE_MIN_INTERVAL_MS) {
        throttled.push(marketId);
        continue;
      }
      try {
        const hash = await withSpan(
          "perps.funding.poke",
          () =>
            wallet.writeContract({
              chain: null,
              account: wallet.account!,
              address: fundingEngine,
              abi: FxFundingEngineAbi,
              functionName: "pokeFundingRate",
              args: [marketId as `0x${string}`],
            }),
          {
            "funding.market_id": marketId,
            "funding.chain_id": ARC_CHAIN_ID,
          },
          "keeper.perps-funding",
        );
        lastPokeAt.set(marketId, now);
        poked.push({ marketId, tx: hash });

        // Wait for the receipt + publish post-confirmation. Failures here
        // never block subsequent markets — we already set lastPokeAt so a
        // partial publish failure won't cause a retry storm on next tick.
        try {
          const receipt = await ctx.clients.arc.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") {
            ctx.log.warn("perps_funding.poke_reverted", {
              marketId,
              tx: hash,
            });
            continue;
          }
          const decoded = decodeFundingPokedFromReceipt({
            logs: receipt.logs,
            fundingEngine,
            marketId: marketId as Hex,
          });
          if (!decoded) {
            // No FundingPoked log on a successful tx is unexpected but
            // not fatal — skip publish, log so we can investigate.
            ctx.log.warn("perps_funding.no_event_in_receipt", {
              marketId,
              tx: hash,
            });
            continue;
          }
          void postPublish(
            mapFundingPokedToPublish(decoded.args, {
              txHash: hash,
              blockNumber: receipt.blockNumber,
              logIndex: decoded.logIndex,
            }),
          ).catch((err) => {
            ctx.log.warn("perps_funding.publish_failed", {
              error: (err as Error).message,
              tx: hash,
            });
          });
        } catch (publishErr) {
          // Receipt-wait or decode failures shouldn't take down the loop.
          ctx.log.warn("perps_funding.post_receipt_failed", {
            marketId,
            tx: hash,
            error: (publishErr as Error).message,
          });
        }
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        // Underpriced / already-known come from racing the same nonce
        // against an in-flight tx. Treat as a soft "still pending" and
        // record so we don't retry until the interval passes.
        if (/underpriced|already known|nonce too low/i.test(msg)) {
          lastPokeAt.set(marketId, now);
          throttled.push(marketId);
          continue;
        }
        failed.push({ marketId, error: msg });
      }
    }

    ctx.log.info("perps_funding.scan", {
      markets: marketIds.length,
      poked,
      throttled: throttled.length,
      failed,
      intervalMs: FUNDING_POKE_MIN_INTERVAL_MS,
    });
  },
});

function activeMarketIds(): string[] {
  return livePerpsMarketIds(ARC_CHAIN_ID);
}

// Walk a receipt's logs for the FundingPoked event matching `marketId`
// emitted by the fundingEngine contract. Decoded args are the raw bigint
// fields from the ABI; the mapper layer is responsible for stringifying.
//
// Returns the log index (within the receipt) of the matched event so the
// downstream Tinybird dedupe key `${txHash}-${logIndex}` is stable across
// retries.
function decodeFundingPokedFromReceipt(args: {
  logs: ReadonlyArray<{ address: `0x${string}`; topics: readonly `0x${string}`[]; data: `0x${string}` }>;
  fundingEngine: `0x${string}`;
  marketId: Hex;
}): {
  args: {
    marketId: `0x${string}`;
    version: bigint;
    rateE18PerSecond: bigint;
    cumulativeFundingE18: bigint;
  };
  logIndex: number;
} | null {
  const targetEngine = args.fundingEngine.toLowerCase();
  for (let i = 0; i < args.logs.length; i += 1) {
    const log = args.logs[i]!;
    if (log.address.toLowerCase() !== targetEngine) continue;
    try {
      const decoded = decodeEventLog({
        abi: FxFundingEngineAbi,
        eventName: "FundingPoked",
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      // decodeEventLog narrows args to the FundingPoked tuple when eventName matches.
      const decodedArgs = decoded.args as {
        marketId: `0x${string}`;
        version: bigint;
        rateE18PerSecond: bigint;
        cumulativeFundingE18: bigint;
      };
      if (decodedArgs.marketId.toLowerCase() !== args.marketId.toLowerCase()) continue;
      return { args: decodedArgs, logIndex: i };
    } catch {
      // Not a FundingPoked log; continue scanning.
    }
  }
  return null;
}
