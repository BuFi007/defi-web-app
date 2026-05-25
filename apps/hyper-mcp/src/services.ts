import { createTradingMachineDbFromEnv } from "@bufi/db";
import { createFxTelaranaService } from "@bufi/fx-telarana";
import { createHermesClient } from "@bufi/market-data";
import {
  createPerpsService,
  createViemPerpsNonceReader,
  createViemPerpsQuoteReader,
  livePerpsMarkets,
} from "@bufi/perps";
import { createCircleGatewayVerifier, mockVerifier } from "@bufi/x402";

const perpsMarkets = livePerpsMarkets();

export const tradingDb = createTradingMachineDbFromEnv(process.env);
export const hermes = createHermesClient();
export const telaranaService = createFxTelaranaService();

export const perpsService = createPerpsService({
  markets: perpsMarkets,
  quoteReader: createViemPerpsQuoteReader({ markets: perpsMarkets }),
  nonceReader: createViemPerpsNonceReader(),
  intentStore: tradingDb.perpsIntents,
  maxOracleStaleSeconds: Number(process.env.PYTH_MAX_STALE_SECONDS ?? 120),
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
