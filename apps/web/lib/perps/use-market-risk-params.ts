/**
 * Per-market risk parameter reader.
 *
 * Reads (in one multicall, per `useReadContracts`):
 *   1. `FxPerpClearinghouse.marketConfig(marketId)` → static struct:
 *        - baseToken, enabled
 *        - initialMarginBps, maintenanceMarginBps
 *        - tradingFeeBps, maxLeverageBps
 *        - maxOpenInterestUsd, maxSkewUsd
 *   2. `FxPerpClearinghouse.openInterestLong(marketId)`  (live OI)
 *   3. `FxPerpClearinghouse.openInterestShort(marketId)` (live OI)
 *
 * Surfaces a UI-friendly shape (`bps / 10000` already applied) plus the
 * raw values for downstream math. Configuration is `staleTime: Infinity`
 * (changes only via governance, which means a manual cache invalidation
 * is acceptable); OI is refreshed every 30 s — fast enough that a fresh
 * trade visibly ticks the capacity-remaining counter, slow enough that
 * the multicall isn't constantly burning RPC budget.
 *
 * Stop-condition (from the brief): if the deployed contract is older
 * than the ABI and `openInterestLong` reverts on every market, we set
 * `oiReadFailed = true` so the consumer can hide the OI capacity row
 * gracefully. Static `marketConfig` follows the same pattern under
 * `configReadFailed`.
 */

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address, Hex } from "viem";

import { FxPerpClearinghouseAbi } from "@bufi/contracts";

import { PERPS_CHAIN_BY_ID, type PerpsChainId } from "./chains";

export interface MarketRiskParams {
  /** Echoed back for convenience. */
  chainId: PerpsChainId;
  marketId: Hex;
  /** Whether the market is enabled in the clearinghouse config struct. */
  enabled: boolean;
  /** Underlying base token address. */
  baseToken: Address;
  /** initialMarginBps / 10000 → fractional initial margin (5% = 0.05). */
  imr: number;
  /** maintenanceMarginBps / 10000. */
  mmr: number;
  /** tradingFeeBps / 10000. */
  tradingFee: number;
  /** maxLeverageBps / 10000 → integer leverage cap (200000 bps = 20x). */
  maxLeverage: number;
  /** maxOpenInterestUsd as a decimal float. */
  maxOpenInterestUsd: number;
  /** maxSkewUsd as a decimal float. */
  maxSkewUsd: number;
  /** Live long-side OI, decimal-float USDC. */
  openInterestLongUsd: number;
  /** Live short-side OI, decimal-float USDC. */
  openInterestShortUsd: number;
  /** Remaining capacity for new positions = max OI - max(longOI, shortOI). */
  openInterestRemainingUsd: number;
  /** True when `maxLeverageBps` divided by 10000 yields an integer max-leverage X. */
  maxLeverageIsInteger: boolean;
}

export interface UseMarketRiskParamsResult {
  data: MarketRiskParams | null;
  isLoading: boolean;
  isError: boolean;
  /** True when ONLY the static config call failed. The static config is required for rendering. */
  configReadFailed: boolean;
  /** True when BOTH the OI calls failed. The OI block should hide gracefully. */
  oiReadFailed: boolean;
}

interface UseMarketRiskParamsOptions {
  chainId: PerpsChainId;
  marketId: Hex | undefined;
}

export function useMarketRiskParams(
  options: UseMarketRiskParamsOptions,
): UseMarketRiskParamsResult {
  const chain = PERPS_CHAIN_BY_ID[options.chainId];
  const clearinghouse = chain?.clearinghouseAddress;

  const enabled = Boolean(
    chain?.enabled && clearinghouse && options.marketId,
  );

  const query = useReadContracts({
    contracts: options.marketId && clearinghouse
      ? [
          {
            address: clearinghouse,
            abi: FxPerpClearinghouseAbi,
            functionName: "marketConfig" as const,
            args: [options.marketId] as const,
            chainId: options.chainId,
          },
          {
            address: clearinghouse,
            abi: FxPerpClearinghouseAbi,
            functionName: "openInterestLong" as const,
            args: [options.marketId] as const,
            chainId: options.chainId,
          },
          {
            address: clearinghouse,
            abi: FxPerpClearinghouseAbi,
            functionName: "openInterestShort" as const,
            args: [options.marketId] as const,
            chainId: options.chainId,
          },
        ]
      : [],
    allowFailure: true,
    query: {
      enabled,
      // Static config + OI are refreshed together; 30s matches the brief.
      // The static slot is cached client-side via React Query's structural
      // sharing — repeated polls don't re-render if `marketConfig` is
      // unchanged.
      refetchInterval: 30_000,
      staleTime: 15_000,
    },
  });

  return useMemo<UseMarketRiskParamsResult>(() => {
    const data = query.data;
    const configEntry = data?.[0];
    const oiLongEntry = data?.[1];
    const oiShortEntry = data?.[2];

    const configReadFailed = configEntry?.status === "failure";
    const oiReadFailed =
      (oiLongEntry?.status ?? "failure") === "failure" &&
      (oiShortEntry?.status ?? "failure") === "failure";

    if (!data || configEntry?.status !== "success") {
      return {
        data: null,
        isLoading: query.isLoading,
        isError: query.isError,
        configReadFailed,
        oiReadFailed,
      };
    }

    const config = configEntry.result as {
      baseToken: Address;
      enabled: boolean;
      initialMarginBps: number;
      maintenanceMarginBps: number;
      tradingFeeBps: number;
      maxLeverageBps: number;
      maxOpenInterestUsd: bigint;
      maxSkewUsd: bigint;
    };

    const longRaw =
      oiLongEntry?.status === "success" ? (oiLongEntry.result as bigint) : 0n;
    const shortRaw =
      oiShortEntry?.status === "success" ? (oiShortEntry.result as bigint) : 0n;

    // maxOpenInterestUsd is recorded in 1e6 (USDC native) — same convention
    // as the manifest emits and the API echoes back. Convert to float.
    const toFloat = (raw: bigint, decimals = 6): number => {
      if (raw === 0n) return 0;
      // Avoid losing precision on multi-billion-USD caps: use BigInt
      // arithmetic for the divisor then cast.
      const denom = 10n ** BigInt(decimals);
      const whole = raw / denom;
      const frac = raw % denom;
      return Number(whole) + Number(frac) / Number(denom);
    };

    const maxOpenInterestUsd = toFloat(config.maxOpenInterestUsd);
    const maxSkewUsd = toFloat(config.maxSkewUsd);
    const openInterestLongUsd = toFloat(longRaw);
    const openInterestShortUsd = toFloat(shortRaw);
    // Capacity is bounded by the SIDE that's filling up faster, not the sum.
    const occupied = Math.max(openInterestLongUsd, openInterestShortUsd);
    const openInterestRemainingUsd = Math.max(0, maxOpenInterestUsd - occupied);

    const maxLeverageBps = config.maxLeverageBps ?? 0;
    const maxLeverageRaw = maxLeverageBps / 10_000;
    const maxLeverageIsInteger = Number.isInteger(maxLeverageRaw);
    const maxLeverage = Math.round(maxLeverageRaw);

    return {
      data: {
        chainId: options.chainId,
        marketId: options.marketId as Hex,
        enabled: config.enabled,
        baseToken: config.baseToken,
        imr: (config.initialMarginBps ?? 0) / 10_000,
        mmr: (config.maintenanceMarginBps ?? 0) / 10_000,
        tradingFee: (config.tradingFeeBps ?? 0) / 10_000,
        maxLeverage,
        maxLeverageIsInteger,
        maxOpenInterestUsd,
        maxSkewUsd,
        openInterestLongUsd,
        openInterestShortUsd,
        openInterestRemainingUsd,
      },
      isLoading: query.isLoading,
      isError: query.isError,
      configReadFailed: false,
      oiReadFailed,
    };
  }, [query.data, query.isLoading, query.isError, options.chainId, options.marketId]);
}
