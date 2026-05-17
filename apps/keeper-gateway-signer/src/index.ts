import { CIRCLE_GATEWAY, CONTRACTS } from "@bufi/contracts";
import { requireKeeperSigner, runKeeper } from "@bufi/keeper-runtime";

await runKeeper({
  name: "@bufi/keeper-gateway-signer",
  async tick(ctx) {
    requireKeeperSigner(ctx);
    ctx.log.info("gateway_signer.scan", {
      circleApi: ctx.env.GATEWAY_API_BASE ?? CIRCLE_GATEWAY.testnetApiBaseUrl,
      fujiHook: CONTRACTS[43113].telarana.fxGatewayHook,
      arcHook: CONTRACTS[5042002].telarana.fxGatewayHook,
      note: "wire LockedForRemote polling and Circle /transfer attestation relay here",
    });
  },
});
