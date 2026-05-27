import {
  DEFAULT_RPC_URLS,
  FxOracleAbi,
  FxOrderSettlementAbi,
  FxPerpClearinghouseAbi,
  getRpcUrl,
  loadContracts,
} from "@bufi/contracts";
import type { MarketRegistryEntry } from "@bufi/shared-types";
import {
  createPublicClient,
  http,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";

import type { PerpsQuoteRequest } from "./schemas";
import type { PerpsNonceReader, PerpsQuoteReader } from "./service";
import { parseUsdcToAtomic, signedSizeDelta } from "./typed-data";

export interface CreateViemPerpsQuoteReaderOptions {
  clientForChain?: (chainId: number) => PublicClient;
  markets: MarketRegistryEntry[];
  maxLeverage?: number;
  now?: () => number;
}

export function createViemPerpsQuoteReader(
  opts: CreateViemPerpsQuoteReaderOptions,
): PerpsQuoteReader {
  const clientForChain = opts.clientForChain ?? defaultClientForChain;
  const maxLeverage = opts.maxLeverage ?? 50;
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));

  return {
    async quoteFee(req) {
      const contracts = loadContracts()[req.chainId];
      const clearinghouse = contracts.perps.clearinghouse;
      if (!clearinghouse) {
        throw new Error(`perps clearinghouse is not configured for chain ${req.chainId}`);
      }
      const market = opts.markets.find(
        (m) => m.chainId === req.chainId && m.marketId.toLowerCase() === req.marketId.toLowerCase(),
      );
      if (!market) {
        throw new Error(`perps market metadata is not configured: ${req.marketId}`);
      }

      const client = clientForChain(req.chainId);
      const trader = (req.trader ?? zeroAddress) as Address;
      const sizeDelta = signedSizeDelta(req);
      const [fee, markPrice] = await client.readContract({
        address: clearinghouse,
        abi: FxPerpClearinghouseAbi,
        functionName: "quoteFee",
        args: [req.marketId as `0x${string}`, trader, sizeDelta],
      });

      const oracle = contracts.telarana.fxOracle;
      if (!oracle) {
        throw new Error(`FxOracle is not configured for chain ${req.chainId}`);
      }
      const [, publishedAt] = await client.readContract({
        address: oracle,
        abi: FxOracleAbi,
        functionName: "getMid",
        args: [market.baseAsset, market.quoteAsset],
      });
      const oracleTimestamp = Number(publishedAt);

      return {
        fee: fee.toString(),
        markPrice: markPrice.toString(),
        requiredMargin: requiredMarginFromNotional(req.sizeUsdc, req.leverage).toString(),
        maxLeverage,
        oracleTimestamp,
        oracleStaleSeconds: Math.max(0, now() - oracleTimestamp),
      };
    },
  };
}

export interface CreateViemPerpsNonceReaderOptions {
  clientForChain?: (chainId: number) => PublicClient;
}

export function createViemPerpsNonceReader(
  opts: CreateViemPerpsNonceReaderOptions = {},
): PerpsNonceReader {
  const clientForChain = opts.clientForChain ?? defaultClientForChain;
  return {
    async isNonceUsed(chainId, trader, nonce) {
      const orderSettlement = loadContracts()[chainId as 43113 | 5042002 | 919]?.perps.orderSettlement;
      if (!orderSettlement) return false;
      const wordPos = nonce >> 8n;
      const bitPos = nonce & 255n;
      const bitmap = await clientForChain(chainId).readContract({
        address: orderSettlement,
        abi: FxOrderSettlementAbi,
        functionName: "nonceBitmap",
        args: [trader as Address, wordPos],
      });
      return (bitmap & (1n << bitPos)) !== 0n;
    },
  };
}

export interface CreateHybridQuoteReaderOptions extends CreateViemPerpsQuoteReaderOptions {
  hermesBaseUrl?: string;
  maxOracleStaleSeconds?: number;
  pythFeedByMarket: Record<string, { baseFeedId: string; quoteFeedId: string }>;
}

export function createHybridPerpsQuoteReader(
  opts: CreateHybridQuoteReaderOptions,
): PerpsQuoteReader {
  const onchain = createViemPerpsQuoteReader(opts);
  const maxLeverage = opts.maxLeverage ?? 50;
  const maxOracleStaleSeconds =
    opts.maxOracleStaleSeconds ?? Number(process.env.PYTH_MAX_STALE_SECONDS ?? 30);
  const hermesUrl = opts.hermesBaseUrl ?? process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network";

  return {
    async quoteFee(req) {
      try {
        const quote = await onchain.quoteFee(req);
        if (quote.oracleStaleSeconds > maxOracleStaleSeconds) {
          throw new Error(
            `on-chain oracle stale: age=${quote.oracleStaleSeconds}s max=${maxOracleStaleSeconds}s`,
          );
        }
        return quote;
      } catch {
        // On-chain quoteFee failed (oracle stale / RedStone missing).
        // Fall back to Hermes API for a fresh mark price.
        const feedMap = opts.pythFeedByMarket[req.marketId.toLowerCase()];
        if (!feedMap) throw new Error(`No Pyth feed mapping for market ${req.marketId}`);

        const url = `${hermesUrl}/v2/updates/price/latest?ids[]=${feedMap.baseFeedId}&ids[]=${feedMap.quoteFeedId}&parsed=true`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Hermes request failed: ${res.status}`);
        const data = await res.json() as {
          parsed: Array<{ id: string; price: { price: string; expo: number; publish_time: number } }>;
        };

        const baseP = data.parsed.find((p) => p.id === feedMap.baseFeedId.replace("0x", ""));
        const quoteP = data.parsed.find((p) => p.id === feedMap.quoteFeedId.replace("0x", ""));
        if (!baseP || !quoteP) throw new Error("Hermes returned incomplete price data");

        const basePrice = Number(baseP.price.price) * 10 ** baseP.price.expo;
        const quotePrice = Number(quoteP.price.price) * 10 ** quoteP.price.expo;
        const mid = basePrice / quotePrice;
        const markPriceE18 = BigInt(Math.round(mid * 1e18));

        const oracleTimestamp = Math.min(baseP.price.publish_time, quoteP.price.publish_time);
        const feeEstimate = (parseUsdcToAtomic(req.sizeUsdc) * 5n) / 10000n;

        return {
          fee: feeEstimate.toString(),
          markPrice: markPriceE18.toString(),
          requiredMargin: requiredMarginFromNotional(req.sizeUsdc, req.leverage).toString(),
          maxLeverage,
          oracleTimestamp,
          oracleStaleSeconds: Math.max(0, Math.floor(Date.now() / 1000) - oracleTimestamp),
        };
      }
    },
  };
}

export function requiredMarginFromNotional(sizeUsdc: string, leverage: number): bigint {
  if (leverage <= 0) throw new Error("leverage must be positive");
  const notional = parseUsdcToAtomic(sizeUsdc);
  return (notional + BigInt(leverage) - 1n) / BigInt(leverage);
}

function defaultClientForChain(chainId: number): PublicClient {
  const rpcUrl = getRpcUrl(chainId as keyof typeof DEFAULT_RPC_URLS);
  if (!rpcUrl) throw new Error(`no RPC URL configured for chain ${chainId}`);
  return createPublicClient({ transport: http(rpcUrl) });
}
