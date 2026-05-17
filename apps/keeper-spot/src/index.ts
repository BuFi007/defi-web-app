import { CONTRACTS, SPOT_FX_ROUTES } from "@bufi/contracts";
import { requireKeeperSigner, runKeeper } from "@bufi/keeper-runtime";

await runKeeper({
  name: "@bufi/keeper-spot",
  async tick(ctx) {
    requireKeeperSigner(ctx);
    ctx.log.info("spot.scan", {
      tgh: CONTRACTS[5042002].telarana.telaranaGatewayHubHook,
      executor: CONTRACTS[5042002].telarana.fxSpotExecutor,
      routes: Object.values(SPOT_FX_ROUTES).map((r) => r.routeId),
      note: "wire GatewayAtomicFxSwapRequested -> receiveGatewayMint -> executeSpotFx",
    });
  },
});
