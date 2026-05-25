import { SPOT_FX_ROUTES, PYTH_FEED_IDS } from "@bufi/contracts";
import { createHermesClient } from "@bufi/market-data";
import { requireKeeperSigner, runKeeper } from "@bufi/keeper-runtime";

const hermes = createHermesClient();
let bootLogged = false;

await runKeeper({
  name: "@bufi/keeper-pyth",
  async tick(ctx) {
    requireKeeperSigner(ctx);
    const spotFeeds = Object.values(SPOT_FX_ROUTES).map((r) => r.pythFeedId);
    const perpOnlyFeeds = [PYTH_FEED_IDS.audUsd];
    const feeds = [...new Set([...spotFeeds, ...perpOnlyFeeds])];
    const latest = await hermes.latestPriceUpdates(feeds);
    if (!bootLogged) {
      ctx.log.info("pyth.ready", {
        feeds: feeds.length,
        updatePayloads: latest.updateData.length,
        note: "Arc Pyth is a v1 receiver — prices pushed by Arc relayer, not this keeper. Hermes data fetched for readiness monitoring only.",
      });
      bootLogged = true;
    }
  },
});
