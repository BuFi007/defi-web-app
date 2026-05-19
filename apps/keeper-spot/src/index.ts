import { CONTRACTS, SPOT_FX_ROUTES } from "@bufi/contracts";
import { requireKeeperSigner, runKeeper } from "@bufi/keeper-runtime";

// Stub keeper -- real loop subscribes to
// `GatewayAtomicFxSwapRequested`, calls `receiveGatewayMint`, then
// `executeSpotFx` on the executor. Until that lands, boot-log the
// route table once and stay silent.
let bootLogged = false;

await runKeeper({
  name: "@bufi/keeper-spot",
  async tick(ctx) {
    requireKeeperSigner(ctx);
    if (!bootLogged) {
      ctx.log.info("spot.ready", {
        tgh: CONTRACTS[5042002].telarana.telaranaGatewayHubHook,
        executor: CONTRACTS[5042002].telarana.fxSpotExecutor,
        routes: Object.values(SPOT_FX_ROUTES).map((r) => r.routeId),
        note: "wire GatewayAtomicFxSwapRequested -> receiveGatewayMint -> executeSpotFx",
      });
      bootLogged = true;
    }
  },
});
