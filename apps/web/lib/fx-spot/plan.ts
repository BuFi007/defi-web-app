"use client";

import {
  FX_SWAP_TOKENS,
  isFxSwapPairSupported,
} from "@bufi/fx-telarana";
import type { Address } from "viem";
import { formatUnits } from "viem";

export type FxSpotSide = "long" | "short";

type FxSpotRouteKind = "fx-usd" | "usd-fx";

export interface FxSpotRoute {
  marketSymbol: string;
  baseSymbol: string;
  fxSymbol: "EURC" | "AUDF" | "MXNB" | "QCAD";
  fxToken: Address;
  kind: FxSpotRouteKind;
}

export interface BuildFxSpotSwapPlanInput {
  marketSymbol: string;
  side: FxSpotSide;
  size: number;
  price: number;
  slippageBps?: number;
}

export interface FxSpotSwapPlan {
  marketSymbol: string;
  side: FxSpotSide;
  baseSymbol: string;
  sellToken: Address;
  buyToken: Address;
  sellSymbol: "USDC" | FxSpotRoute["fxSymbol"];
  buySymbol: "USDC" | FxSpotRoute["fxSymbol"];
  sellAmount: bigint;
  expectedBuyAmount: bigint;
  minBuyAmount: bigint;
  slippageBps: number;
  price: number;
}

const USDC = FX_SWAP_TOKENS.USDC as Address;
const DEFAULT_SLIPPAGE_BPS = 100;
const BPS_DENOMINATOR = 10_000n;

const FX_SPOT_ROUTES: Readonly<Record<string, FxSpotRoute>> = {
  "EUR/USD": {
    marketSymbol: "EUR/USD",
    baseSymbol: "EUR",
    fxSymbol: "EURC",
    fxToken: FX_SWAP_TOKENS.EURC as Address,
    kind: "fx-usd",
  },
  "AUD/USD": {
    marketSymbol: "AUD/USD",
    baseSymbol: "AUD",
    fxSymbol: "AUDF",
    fxToken: FX_SWAP_TOKENS.AUDF as Address,
    kind: "fx-usd",
  },
  "USD/MXN": {
    marketSymbol: "USD/MXN",
    baseSymbol: "USD",
    fxSymbol: "MXNB",
    fxToken: FX_SWAP_TOKENS.MXNB as Address,
    kind: "usd-fx",
  },
  "USD/CAD": {
    marketSymbol: "USD/CAD",
    baseSymbol: "USD",
    fxSymbol: "QCAD",
    fxToken: FX_SWAP_TOKENS.QCAD as Address,
    kind: "usd-fx",
  },
};

export function resolveFxSpotRoute(marketSymbol: string): FxSpotRoute | null {
  return FX_SPOT_ROUTES[marketSymbol.toUpperCase()] ?? null;
}

export function fxSpotUnavailableReason(marketSymbol: string, price: number): string | null {
  if (!resolveFxSpotRoute(marketSymbol)) {
    return `No Arc FxRouter pool is configured for ${marketSymbol}.`;
  }
  if (!Number.isFinite(price) || price <= 0) {
    return "Live FX price is still loading.";
  }
  return null;
}

export function buildFxSpotSwapPlan(input: BuildFxSpotSwapPlanInput): FxSpotSwapPlan {
  const route = resolveFxSpotRoute(input.marketSymbol);
  if (!route) throw new Error(`No Arc FxRouter pool is configured for ${input.marketSymbol}.`);
  if (!Number.isFinite(input.size) || input.size <= 0) {
    throw new Error("Size must be greater than zero.");
  }
  if (!Number.isFinite(input.price) || input.price <= 0) {
    throw new Error("Live FX price is still loading.");
  }

  const slippageBps = Math.max(0, Math.min(input.slippageBps ?? DEFAULT_SLIPPAGE_BPS, 5_000));
  const baseAmount = toAtomic6(input.size);
  const quoteAmount = toAtomic6(input.size * input.price);
  if (baseAmount <= 0n || quoteAmount <= 0n) {
    throw new Error("Size is below the token precision supported by this venue.");
  }

  const plan = (() => {
    if (route.kind === "fx-usd") {
      if (input.side === "long") {
        return {
          sellToken: USDC,
          buyToken: route.fxToken,
          sellSymbol: "USDC" as const,
          buySymbol: route.fxSymbol,
          sellAmount: quoteAmount,
          expectedBuyAmount: baseAmount,
        };
      }
      return {
        sellToken: route.fxToken,
        buyToken: USDC,
        sellSymbol: route.fxSymbol,
        buySymbol: "USDC" as const,
        sellAmount: baseAmount,
        expectedBuyAmount: quoteAmount,
      };
    }

    if (input.side === "long") {
      return {
        sellToken: route.fxToken,
        buyToken: USDC,
        sellSymbol: route.fxSymbol,
        buySymbol: "USDC" as const,
        sellAmount: quoteAmount,
        expectedBuyAmount: baseAmount,
      };
    }
    return {
      sellToken: USDC,
      buyToken: route.fxToken,
      sellSymbol: "USDC" as const,
      buySymbol: route.fxSymbol,
      sellAmount: baseAmount,
      expectedBuyAmount: quoteAmount,
    };
  })();

  if (!isFxSwapPairSupported(plan.sellToken, plan.buyToken)) {
    throw new Error(`FxRouter does not allow ${plan.sellSymbol} -> ${plan.buySymbol}.`);
  }

  return {
    marketSymbol: route.marketSymbol,
    side: input.side,
    baseSymbol: route.baseSymbol,
    ...plan,
    minBuyAmount: applySlippage(plan.expectedBuyAmount, slippageBps),
    slippageBps,
    price: input.price,
  };
}

export function formatFxSpotAmount(value: bigint): string {
  const raw = formatUnits(value, 6);
  return raw.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
}

function toAtomic6(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.floor(value * 1_000_000 + 1e-9));
}

function applySlippage(value: bigint, slippageBps: number): bigint {
  return (value * (BPS_DENOMINATOR - BigInt(slippageBps))) / BPS_DENOMINATOR;
}
