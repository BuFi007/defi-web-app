import { FxFundingEngineAbi, loadContracts } from "@bufi/contracts";
import { createKeeperWalletClient, requireKeeperSigner, runKeeper } from "@bufi/keeper-runtime";
import { livePerpsMarketIds } from "@bufi/perps";

const ARC_CHAIN_ID = 5042002;

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
    const hashes: string[] = [];
    for (const marketId of marketIds) {
      const hash = await wallet.writeContract({
        chain: null,
        account: wallet.account!,
        address: fundingEngine,
        abi: FxFundingEngineAbi,
        functionName: "pokeFundingRate",
        args: [marketId as `0x${string}`],
      });
      hashes.push(hash);
    }
    ctx.log.info("perps_funding.scan", {
      markets: marketIds.length,
      txs: hashes,
    });
  },
});

function activeMarketIds(): string[] {
  return livePerpsMarketIds(ARC_CHAIN_ID);
}
