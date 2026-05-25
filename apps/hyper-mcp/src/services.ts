import { createTradingMachineDbFromEnv } from "@bufi/db";
import { createFxTelaranaService } from "@bufi/fx-telarana";
import { createHermesClient } from "@bufi/market-data";
import { ARC_PERP_MARKETS, PYTH_FEED_IDS } from "@bufi/contracts";
import {
  createPerpsService,
  createViemPerpsNonceReader,
  createHybridPerpsQuoteReader,
  livePerpsMarkets,
} from "@bufi/perps";
import { createCircleGatewayVerifier, mockVerifier } from "@bufi/x402";

const perpsMarkets = livePerpsMarkets();

const pythFeedByMarket: Record<string, { baseFeedId: string; quoteFeedId: string }> = {};
for (const m of Object.values(ARC_PERP_MARKETS)) {
  pythFeedByMarket[m.marketId.toLowerCase()] = {
    baseFeedId: m.pythFeedId,
    quoteFeedId: PYTH_FEED_IDS.usdUsdc,
  };
}

export const tradingDb = createTradingMachineDbFromEnv(process.env);
export const hermes = createHermesClient();
export const telaranaService = createFxTelaranaService();

export const perpsService = createPerpsService({
  markets: perpsMarkets,
  quoteReader: createHybridPerpsQuoteReader({
    markets: perpsMarkets,
    pythFeedByMarket,
  }),
  nonceReader: createViemPerpsNonceReader(),
  intentStore: tradingDb.perpsIntents,
  maxOracleStaleSeconds: Number(process.env.PYTH_MAX_STALE_SECONDS ?? 300),
});

export const receiptStore = tradingDb.receipts;

export const paymentVerifier = process.env.X402_FACILITATOR_URL
  ? createCircleGatewayVerifier({ facilitatorUrl: process.env.X402_FACILITATOR_URL })
  : mockVerifier;

export const sellerAddress =
  process.env.X402_RECEIVER_ADDRESS ?? "0x000000000000000000000000000000000000dEaD";

export function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
}
