import { FxFundingEngineAbi, loadContracts } from "@bufi/contracts";
import { createKeeperWalletClient, requireKeeperSigner, runKeeper } from "@bufi/keeper-runtime";
import { withSpan } from "@bufi/observability";
import { livePerpsMarketIds } from "@bufi/perps";

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
