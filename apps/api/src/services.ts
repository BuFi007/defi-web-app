import { createTradingMachineDbFromEnv } from "@bufi/db";
import { serverEnv } from "@bufi/env";
import { createInMemoryFxBentoService } from "@bufi/fx-bento";
import { createFxTelaranaService } from "@bufi/fx-telarana";
import { createHermesClient } from "@bufi/market-data";
import {
  createPerpsService,
  createViemPerpsNonceReader,
  createViemPerpsQuoteReader,
  livePerpsMarkets,
} from "@bufi/perps";
import { createCircleGatewayVerifier, mockVerifier } from "@bufi/x402";

import { createPonderPerpsSettlementReaderFromEnv } from "./ponder-client";

const env = serverEnv();

if (env.NODE_ENV === "production" && !env.X402_FACILITATOR_URL) {
  throw new Error("X402_FACILITATOR_URL is required in production");
}

export const tradingDb = createTradingMachineDbFromEnv(process.env);
export const hermes = createHermesClient();
export const bentoService = createInMemoryFxBentoService();
export const telaranaService = createFxTelaranaService();
const perpsMarkets = livePerpsMarkets();
export const perpsService = createPerpsService({
  markets: perpsMarkets,
  quoteReader: createViemPerpsQuoteReader({ markets: perpsMarkets }),
  nonceReader: createViemPerpsNonceReader(),
  intentStore: tradingDb.perpsIntents,
  maxOracleStaleSeconds: env.PYTH_MAX_STALE_SECONDS,
});

export const receiptStore = tradingDb.receipts;
export const perpsSettlementReader = createPonderPerpsSettlementReaderFromEnv(process.env);

export const paymentVerifier = env.X402_FACILITATOR_URL
  ? createCircleGatewayVerifier({ facilitatorUrl: env.X402_FACILITATOR_URL })
  : mockVerifier;

export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)));
}

export function errorStatus(error: unknown): 400 | 401 | 403 | 404 | 409 | 424 | 500 {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("not configured")) return 424;
  if (message.includes("Ponder GraphQL")) return 424;
  if (message.includes("unknown room") || message.includes("unknown workflow")) return 404;
  if (message.includes("not found")) return 404;
  if (message.includes("not enabled")) return 404;
  if (message.includes("wallet session required") || message.includes("wallet signature required")) return 401;
  if (message.includes("permission denied") || message.includes("must match session address")) return 403;
  if (message.includes("expired") || message.includes("invalid")) return 400;
  if (message.includes("nonce already used")) return 409;
  if (message.includes("partially_filled") || message.includes("residual quantity")) return 409;
  if (message.includes("replacement already exists")) return 409;
  if (message.includes("missing commitment")) return 409;
  return 500;
}
