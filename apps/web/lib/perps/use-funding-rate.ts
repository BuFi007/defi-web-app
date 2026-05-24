/**
 * Live funding-rate reader.
 *
 * Reads `FxFundingEngine.fundingState(marketId)` directly on-chain via
 * wagmi's `useReadContract`. The struct returns:
 *   - `currentVersion`           uint64 — bumped on each `FundingPoked`.
 *   - `lastUpdate`               uint256 — unix seconds of the last poke.
 *   - `currentRateE18PerSecond`  int256 — signed funding rate, 1e18 per sec.
 *   - `cumulativeFundingE18`     int256 — cumulative funding index, 1e18.
 *
 * Sign convention: positive → longs pay shorts. Negative → shorts pay
 * longs.
 *
 * Polling falls back to a 30-second cadence (matches the brief's
 * Ponder-fallback note). When the indexer wires up a `FundingPoked`
 * subscription we'll swap the poll for a live WS bump; for now the
 * 30-second poll is honest and cheap.
 *
 * Annualized conversion: `rateE18PerSecond / 1e18 * 86400 * 365`. We
 * also produce a "per 8h" estimate because that's the cadence
 * dimensional traders are used to from competing protocols.
 */

import { useMemo } from "react";
import { useReadContract } from "wagmi";
import type { Address, Hex } from "viem";

import { FxFundingEngineAbi } from "@bufi/contracts";

import { PERPS_CHAIN_BY_ID, type PerpsChainId } from "./chains";

export interface FundingRateSnapshot {
  /** Last poke timestamp, unix seconds. */
  lastUpdateSec: number;
  /** Seconds since the last poke. */
  ageSec: number;
  /** Signed funding rate as a decimal float, per second. */
  rate: number;
  /** Annualized (`rate * 86400 * 365`). */
  annualizedPct: number;
  /** Per-8h rate (`rate * 8 * 3600`). */
  per8hPct: number;
  /** Current cumulative funding index, decimal float. */
  cumulativeFunding: number;
  /** Whether longs are paying funding (rate > 0). */
  longsPay: boolean;
  /** Whether the rate is effectively zero (|rate| < 1e-12). */
  isBalanced: boolean;
  /** Current funding version (uint64, fits in Number for the index range we care about). */
  version: number;
}

export interface UseFundingRateResult {
  data: FundingRateSnapshot | null;
  isLoading: boolean;
  isError: boolean;
  /** True when the fundingEngine read consistently reverts. */
  readFailed: boolean;
}

interface UseFundingRateOptions {
  chainId: PerpsChainId;
  marketId: Hex | undefined;
  /** Optional override for the poll interval. Defaults to 30s. */
  refetchIntervalMs?: number;
}

/** Convert a signed 1e18 fixed-point bigint to a decimal float. */
function signedE18ToFloat(raw: bigint): number {
  const denom = 10n ** 18n;
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const whole = abs / denom;
  const frac = abs % denom;
  const value = Number(whole) + Number(frac) / Number(denom);
  return negative ? -value : value;
}

export function useFundingRate(options: UseFundingRateOptions): UseFundingRateResult {
  const chain = PERPS_CHAIN_BY_ID[options.chainId];
  const fundingEngine = chain?.fundingEngineAddress;
  const enabled = Boolean(chain?.enabled && fundingEngine && options.marketId);

  const query = useReadContract({
    address: (fundingEngine ?? "0x0000000000000000000000000000000000000000") as Address,
    abi: FxFundingEngineAbi,
    functionName: "fundingState",
    args: options.marketId ? [options.marketId] : undefined,
    chainId: options.chainId,
    query: {
      enabled,
      refetchInterval: options.refetchIntervalMs ?? 30_000,
      staleTime: 15_000,
    },
  });

  return useMemo<UseFundingRateResult>(() => {
    if (!query.data) {
      return {
        data: null,
        isLoading: query.isLoading,
        isError: query.isError,
        readFailed: query.isError,
      };
    }
    // viem returns the tuple as an array: [currentVersion, lastUpdate,
    // currentRateE18PerSecond, cumulativeFundingE18].
    const tuple = query.data as readonly [bigint, bigint, bigint, bigint];
    const version = Number(tuple[0]);
    const lastUpdateSec = Number(tuple[1]);
    const rate = signedE18ToFloat(tuple[2]);
    const cumulativeFunding = signedE18ToFloat(tuple[3]);
    const annualizedPct = rate * 86_400 * 365 * 100;
    const per8hPct = rate * 8 * 3600 * 100;
    const isBalanced = Math.abs(rate) < 1e-12;
    const now = Math.floor(Date.now() / 1000);
    const ageSec = Math.max(0, now - lastUpdateSec);

    return {
      data: {
        version,
        lastUpdateSec,
        ageSec,
        rate,
        annualizedPct,
        per8hPct,
        cumulativeFunding,
        longsPay: rate > 0,
        isBalanced,
      },
      isLoading: query.isLoading,
      isError: query.isError,
      readFailed: query.isError,
    };
  }, [query.data, query.isLoading, query.isError]);
}
