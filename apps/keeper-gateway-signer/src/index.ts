import { CIRCLE_GATEWAY, CONTRACTS } from "@bufi/contracts";
import { requireKeeperSigner, runKeeper } from "@bufi/keeper-runtime";

// Stub keeper -- real loop wires LockedForRemote polling against the
// Fuji + Arc hooks, then relays Circle's /transfer attestation. Until
// that lands, log the config snapshot once at boot and stay silent.
let bootLogged = false;

await runKeeper({
  name: "@bufi/keeper-gateway-signer",
  async tick(ctx) {
    requireKeeperSigner(ctx);
    if (!bootLogged) {
      ctx.log.info("gateway_signer.ready", {
        circleApi: ctx.env.GATEWAY_API_BASE ?? CIRCLE_GATEWAY.testnetApiBaseUrl,
        fujiHook: CONTRACTS[43113].telarana.fxGatewayHook,
        arcHook: CONTRACTS[5042002].telarana.fxGatewayHook,
        note: "wire LockedForRemote polling and Circle /transfer attestation relay here",
      });
      bootLogged = true;
    }
  },
});
