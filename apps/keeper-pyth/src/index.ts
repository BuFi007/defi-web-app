import { SPOT_FX_ROUTES } from "@bufi/contracts";
import { createHermesClient } from "@bufi/market-data";
import { requireKeeperSigner, runKeeper } from "@bufi/keeper-runtime";

const hermes = createHermesClient();

// Stub keeper -- the real loop wires `FxOracle.getMidWithUpdatePyth` to
// push Pyth update payloads on-chain when an active market goes stale.
// Until that lands, fetch the latest payloads on each tick so we'd be
// ready to push, but stay silent in the logs. The runtime's wrapDedupe
// already collapses identical scan lines, but Process Compose's tail
// view keeps re-rendering them anyway; logging only on real activity
// is cleaner than fighting the viewer.
let bootLogged = false;

await runKeeper({
  name: "@bufi/keeper-pyth",
  async tick(ctx) {
    requireKeeperSigner(ctx);
    const feeds = Object.values(SPOT_FX_ROUTES).map((r) => r.pythFeedId);
    const latest = await hermes.latestPriceUpdates(feeds);
    if (!bootLogged) {
      ctx.log.info("pyth.ready", {
        feeds: feeds.length,
        updatePayloads: latest.updateData.length,
        note: "wire FxOracle.getMidWithUpdatePyth for stale active markets",
      });
      bootLogged = true;
    }
    // No per-tick log -- emit only when we actually push an update.
  },
});
