import { PYTH_FEED_IDS, type SpotFxSymbol } from "@bufi/contracts";
import type { Hex } from "viem";
import { z } from "zod";

export {
  getCandles,
  makeMockCandles,
  timeframeToSeconds,
  type Candle,
  type CandleSource,
  type GetCandlesOptions,
} from "./candles";

export {
  subscribeMarketTicks,
  buildWsUrl,
  type SubscribeOptions,
  type Tick,
  type ObDelta,
  type ObLevel,
  type MarketsWsEvent,
} from "./ws";

export {
  streamPythPrice,
  type PythStreamTick,
  type StreamPythPriceOptions,
  type UnsubscribePythStream,
} from "./pyth-stream";

export {
  createPythHermesStream,
  decodePythPrice,
  HERMES_DEFAULT_WS_URL,
  type PythHermesStream,
  type PythHermesStreamOptions,
  type PythHermesTick,
  type PythTickListener,
} from "./hermes-ws-client";

export {
  PYTH_FX_FEEDS,
  pythFeedForFxSymbol,
  isFxFeedInverted,
  type PythFxSymbol,
} from "./pyth-feeds";

export {
  fetchBenchmarksHistory,
  pythBenchmarksSymbol,
  tfToBenchmarksResolution,
  tfToSeconds,
  compute24hStats,
  BENCHMARKS_DEFAULT_BASE_URL,
  type FetchBenchmarksHistoryOptions,
} from "./benchmarks";

export const HERMES_DEFAULT_BASE_URL = "https://hermes.pyth.network";

const pythParsedPrice = z.object({
  id: z.string(),
  price: z.object({
    price: z.string(),
    conf: z.string(),
    expo: z.number(),
    publish_time: z.number(),
  }),
});

const latestPriceResponse = z.object({
  parsed: z.array(pythParsedPrice).default([]),
  binary: z
    .object({
      encoding: z.string().optional(),
      data: z.array(z.string()).optional(),
    })
    .optional(),
});

export type PythParsedPrice = z.infer<typeof pythParsedPrice>;

export interface HermesClient {
  latestPriceUpdates(feedIds: readonly Hex[]): Promise<LatestPriceUpdates>;
}

export interface LatestPriceUpdates {
  prices: PythParsedPrice[];
  updateData: Hex[];
  receivedAtUnixSeconds: number;
}

export function createHermesClient(opts: { baseUrl?: string; fetch?: typeof fetch } = {}): HermesClient {
  const baseUrl = opts.baseUrl ?? process.env.PYTH_HERMES_URL ?? HERMES_DEFAULT_BASE_URL;
  const fetchImpl = opts.fetch ?? fetch;
  return {
    async latestPriceUpdates(feedIds) {
      const url = buildLatestPriceUpdatesUrl(baseUrl, feedIds);
      const res = await fetchImpl(url);
      if (!res.ok) {
        throw new Error(`Pyth Hermes latest price request failed: ${res.status} ${await res.text()}`);
      }
      const parsed = latestPriceResponse.parse(await res.json());
      return {
        prices: parsed.parsed,
        updateData: (parsed.binary?.data ?? []).map((data) =>
          data.startsWith("0x") ? (data as Hex) : (`0x${data}` as Hex),
        ),
        receivedAtUnixSeconds: Math.floor(Date.now() / 1000),
      };
    },
  };
}

export function buildLatestPriceUpdatesUrl(baseUrl: string, feedIds: readonly Hex[]): string {
  const url = new URL("/v2/updates/price/latest", baseUrl);
  url.searchParams.set("encoding", "hex");
  for (const id of feedIds) url.searchParams.append("ids[]", strip0x(id));
  return url.toString();
}

export function pythFeedForSpotSymbol(symbol: SpotFxSymbol): Hex {
  switch (symbol) {
    case "EURC":
      return PYTH_FEED_IDS.eurUsd;
    case "JPYC":
      return PYTH_FEED_IDS.jpyUsd;
    case "MXNB":
      return PYTH_FEED_IDS.mxnUsd;
    case "CHFC":
      return PYTH_FEED_IDS.chfUsd;
  }
}

export function oracleAgeSeconds(price: PythParsedPrice, nowUnixSeconds = Math.floor(Date.now() / 1000)): number {
  return Math.max(0, nowUnixSeconds - price.price.publish_time);
}

export function assertFresh(price: PythParsedPrice, maxStaleSeconds: number): void {
  const age = oracleAgeSeconds(price);
  if (age > maxStaleSeconds) {
    throw new Error(`oracle stale: age=${age}s max=${maxStaleSeconds}s feed=${price.id}`);
  }
}

export function decimalPriceString(price: PythParsedPrice): string {
  const raw = BigInt(price.price.price);
  const expo = price.price.expo;
  if (expo >= 0) return (raw * 10n ** BigInt(expo)).toString();
  const scale = 10n ** BigInt(Math.abs(expo));
  const whole = raw / scale;
  const frac = (raw % scale).toString().padStart(Math.abs(expo), "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

function strip0x(hex: Hex): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}
