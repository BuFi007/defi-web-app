import { SPOT_FX_ROUTES } from "@bufi/contracts";
import { createHermesClient } from "@bufi/market-data";
import { requireKeeperSigner, runKeeper } from "@bufi/keeper-runtime";

const hermes = createHermesClient();

await runKeeper({
  name: "@bufi/keeper-pyth",
  async tick(ctx) {
    requireKeeperSigner(ctx);
    const feeds = Object.values(SPOT_FX_ROUTES).map((r) => r.pythFeedId);
    const latest = await hermes.latestPriceUpdates(feeds);
    ctx.log.info("pyth.refresh_ready", {
      feeds: feeds.length,
      updatePayloads: latest.updateData.length,
      note: "wire FxOracle.getMidWithUpdatePyth for stale active markets",
    });
  },
});
