import {
  SPOT_FX_ROUTES,
  PYTH_FEED_IDS,
  FxOracleAbi,
  loadContracts,
} from "@bufi/contracts";
import { livePerpsMarkets } from "@bufi/perps";
import { createHermesClient } from "@bufi/market-data";
import {
  createKeeperWalletClient,
  requireKeeperSigner,
  runKeeper,
} from "@bufi/keeper-runtime";
import type { Address, Hex } from "viem";

const ARC_CHAIN_ID = 5042002;
const hermes = createHermesClient();

const USDC_ARC = "0x3600000000000000000000000000000000000000" as Address;

const PERP_TOKENS: { symbol: string; base: Address }[] =
  livePerpsMarkets(ARC_CHAIN_ID).map((m) => ({
    symbol: m.symbol,
    base: m.baseAsset as Address,
  }));

let bootLogged = false;

await runKeeper({
  name: "@bufi/keeper-pyth",
  async tick(ctx) {
    requireKeeperSigner(ctx);

    const contracts = loadContracts()[ARC_CHAIN_ID];
    const oracle = contracts.telarana.fxOracle;
    if (!oracle) {
      ctx.log.warn("pyth.no_oracle", { chainId: ARC_CHAIN_ID });
      return;
    }

    const spotFeeds = Object.values(SPOT_FX_ROUTES).map((r) => r.pythFeedId);
    const perpOnlyFeeds = [PYTH_FEED_IDS.audUsd];
    const allFeeds = [...new Set([...spotFeeds, ...perpOnlyFeeds])];

    const latest = await hermes.latestPriceUpdates(allFeeds);

    if (!bootLogged) {
      ctx.log.info("pyth.ready", {
        feeds: allFeeds.length,
        perpTokens: PERP_TOKENS.length,
        updatePayloads: latest.updateData.length,
      });
      bootLogged = true;
    }

    if (!latest.updateData.length) return;

    const wallet = createKeeperWalletClient(ctx, "arc");
    let pushed = 0;

    for (const token of PERP_TOKENS) {
      try {
        await ctx.clients.arc.readContract({
          address: oracle,
          abi: FxOracleAbi,
          functionName: "getMid",
          args: [token.base, USDC_ARC],
        });
      } catch {
        // Oracle stale or feed unknown — push Pyth update
        try {
          // Pyth update fees are tiny (~1 wei per feed); send 0.001 USDC
          // (1e15 atomic) — excess is refunded by the oracle contract.
          const hash = await wallet.writeContract({
            chain: null,
            account: wallet.account!,
            address: oracle,
            abi: FxOracleAbi,
            functionName: "getMidWithUpdatePyth",
            args: [token.base, USDC_ARC, latest.updateData as Hex[]],
            value: 1_000_000_000_000_000n,
          });

          pushed++;
          ctx.log.info("pyth.pushed", {
            symbol: token.symbol,
            tx: hash,
          });
        } catch (e) {
          ctx.log.warn("pyth.push_failed", {
            symbol: token.symbol,
            error: (e as Error).message.slice(0, 80),
          });
        }
      }
    }

    if (pushed > 0) {
      ctx.log.info("pyth.tick", { pushed, total: PERP_TOKENS.length });
    }
  },
});
