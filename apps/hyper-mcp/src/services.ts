import { createTradingMachineDbFromEnv } from "@bufi/db";
import {
  createFxTelaranaService,
  listMarkets as listLendingMarkets,
  quoteBorrow,
  type BorrowQuoteReader,
} from "@bufi/fx-telarana";
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

const localBorrowQuoteReader: BorrowQuoteReader = {
  async previewBorrow(req) {
    const markets = await listLendingMarkets();
    const market = markets.find(
      (m) => m.id.toLowerCase() === req.marketId.toLowerCase() && m.hubChainId === req.chainId,
    );
    if (!market) throw new Error(`market ${req.marketId} not found on chain ${req.chainId}`);
    const collateral = BigInt(Math.floor(parseFloat(req.collateralAmount) * 1e6));
    const borrowAmt = BigInt(Math.floor(parseFloat(req.borrowAmount) * 1e6));
    const state = market.state;
    const collateralPriceE36 = market.lltv > 0n ? (10n ** 36n) : 10n ** 36n;
    const result = quoteBorrow({
      market,
      collateral,
      borrowAmount: borrowAmt,
      existingBorrowShares: 0n,
      totalBorrowAssets: state?.totalBorrowAssets ?? 0n,
      totalBorrowShares: state?.totalBorrowShares ?? 0n,
      collateralPriceE36,
    });
    const totalSupply = state?.totalSupplyAssets ?? 0n;
    const totalBorrow = state?.totalBorrowAssets ?? 0n;
    const utilizationBps = totalSupply > 0n
      ? Number((totalBorrow * 10000n) / totalSupply)
      : 0;
    return {
      marketId: req.marketId,
      collateralAmount: req.collateralAmount,
      borrowAmount: req.borrowAmount,
      borrowApyBps: utilizationBps * 2,
      collateralFactorBps: Number(market.lltv / 10n ** 14n),
      healthFactorBps: Number(result.healthFactorE18 / 10n ** 14n),
      oracle: { source: "internal" as const, timestamp: Math.floor(Date.now() / 1000), maxStaleSeconds: 300 },
    };
  },
};

export const telaranaService = createFxTelaranaService({ quoteReader: localBorrowQuoteReader });

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
