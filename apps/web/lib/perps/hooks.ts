/**
 * React Query + wagmi bindings around the live /perps/* routes.
 *
 * usePlaceOrder() is the load-bearing hook: it builds the EIP-712 typed data
 * using @bufi/perps (the same builder the API verifies against), asks the
 * connected wallet to sign it via wagmi's useSignTypedData, then posts the
 * signed intent + signature to /perps/intents through the wallet-session
 * header pattern already used by the replacement agent.
 *
 * Position / trade / market reads are React Query queries with conservative
 * staleTimes; the matcher keeper polls every ~8s, so a 5–10s refetch lines up
 * with on-chain settlement turnaround without hammering the API.
 */

"use client";

import { useCallback, useMemo, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Hex } from "viem";
import { UserRejectedRequestError } from "viem";
import { useAccount, useChainId, useSignTypedData } from "wagmi";

import {
  buildPerpsOrderTypedData,
  hashPerpsOrder,
  type PerpsOrderTypedDataInput,
} from "@bufi/perps";
import type { ChainId } from "@bufi/shared-types";
import { HUBS } from "@bufi/location/hubs";

import {
  fetchPerpsCandles,
  fetchPerpsFunding,
  fetchPerpsLiquidationCandidates,
  fetchPerpsMarkets,
  fetchPerpsOrderbook,
  fetchPerpsPositions,
  fetchPerpsQuote,
  fetchPerpsTrades,
  submitPerpsIntent,
  type PerpsCandlesResponseDto,
  type PerpsFundingDto,
  type PerpsIntentResponseDto,
  type PerpsMarketDto,
  type PerpsOrderbookDto,
  type PerpsPositionDto,
  type PerpsQuoteDto,
  type PerpsQuoteRequestBody,
  type PerpsTradeDto,
} from "./client";
import {
  buildWalletSessionTypedData,
  freshReplacementNonce,
  readCachedWalletSession,
  writeCachedWalletSession,
  type WalletSessionProof,
} from "./replacement-agent";
import {
  getPerpsReplacementDevWallet,
  type PerpsReplacementDevWallet,
} from "./dev-mock-wallet";

const DEFAULT_CHAIN_ID = 5042002 as const;
const POSITIONS_REFETCH_MS = 8_000;
const TRADES_REFETCH_MS = 10_000;
const ORDER_DEFAULT_TTL_SECONDS = 15 * 60;

export interface UsePlaceOrderInput {
  marketId: string;
  side: "long" | "short";
  /** Decimal USDC string (e.g. "100", "250.5"). */
  sizeUsdc: string;
  leverage: number;
  orderType: "limit" | "market";
  /** Required for limit orders. 1e18-scaled price string. */
  priceE18?: string;
  reduceOnly?: boolean;
  postOnly?: boolean;
  /** Override server chainId; defaults to wagmi-connected chain or Arc testnet. */
  chainId?: number;
  /** Override the nonce; otherwise freshReplacementNonce() generates one. */
  nonce?: string;
  /** Seconds the order may live in the matcher book before expiring. */
  ttlSeconds?: number;
}

export interface UsePlaceOrderResult {
  intent: PerpsIntentResponseDto;
  digest: Hex;
  nonce: string;
  deadline: number;
}

type PerpsHookChainId = number;

function effectiveChainId(devWallet: PerpsReplacementDevWallet | null, wagmiChainId?: number): PerpsHookChainId {
  return devWallet?.chainId ?? wagmiChainId ?? DEFAULT_CHAIN_ID;
}

function isUserRejection(error: unknown): boolean {
  if (error instanceof UserRejectedRequestError) return true;
  const anyErr = error as { code?: number; name?: string; message?: string } | null;
  if (!anyErr) return false;
  if (anyErr.code === 4001) return true;
  if (anyErr.name === "UserRejectedRequestError") return true;
  return typeof anyErr.message === "string" && /user rejected/i.test(anyErr.message);
}

export function useMarkets(chainIdOverride?: number): UseQueryResult<PerpsMarketDto[]> {
  const wagmiChainId = useChainId();
  const devWallet = useMemo(() => getPerpsReplacementDevWallet(), []);
  const chainId = chainIdOverride ?? effectiveChainId(devWallet, wagmiChainId);
  return useQuery({
    queryKey: ["perps", "markets", chainId],
    queryFn: ({ signal }) => fetchPerpsMarkets({ chainId, signal }),
    staleTime: 60_000,
  });
}

/**
 * Decorated market list — the UI-shaped view of what's actually
 * registered on-chain. Combines `useMarkets()` (the canonical list from
 * `/perps/markets`, which reads `listPools()` from the FxMarketRegistry)
 * with a per-symbol decoration map for flags / max leverage / type.
 *
 * Symbols returned by the API but missing from MARKET_DECORATIONS get a
 * fallback decoration (em-dash flags, leverage 10) so the row still
 * renders without crashing — but the resulting UI is honest about
 * incomplete metadata rather than fabricated.
 *
 * Returns `null` while loading or on error so the caller can render an
 * explicit empty / "couldn't reach the markets API" state instead of
 * silently falling back to fake data.
 */
export interface MarketListEntry {
  /** API marketId (bytes32). Use this when calling /perps/quote, etc. */
  marketId: string;
  /**
   * UI symbol the rest of the app keys off (charts, live-price hooks,
   * ALL_MARKETS lookup). For Arc hub on-chain symbols like "EURC/USDC"
   * this is the normalized form, e.g. "EUR/USD".
   */
  sym: string;
  /** Raw API symbol from the registry DTO, kept verbatim for order routing. */
  apiSymbol: string;
  /** Same value as `sym` — explicit alias used by the MarketPicker. */
  uiSymbol: string;
  base: string;
  quote: string;
  /** Display emoji / flag for the base leg. "—" when no decoration exists. */
  flagA: string;
  /** Display emoji / flag for the quote leg. "—" when no decoration exists. */
  flagB: string;
  /** Max leverage from the decoration map. Defaults to 10 for unknown symbols. */
  leverage: number;
  /** "forex" if sym matches XXX/YYY, "perp" if sym ends in -PERP. */
  type: "forex" | "perp" | "other";
  chainId: number;
  /** Whether the registry / matcher considers this market live. */
  enabled: boolean;
}

/**
 * Some hubs register markets under their on-chain stable-pair symbols
 * (e.g. Arc lists "EURC/USDC") while the UI + chart pipeline keys off
 * the underlying FX pair ("EUR/USD"). Map the known stable-pair forms
 * to their canonical UI symbol so the chart / live-price hooks can find
 * them via `pythBenchmarksSymbol()` and `ALL_MARKETS`.
 */
function apiSymbolToUiSymbol(s: string): string {
  const map: Record<string, string> = {
    "EURC/USDC": "EUR/USD",
    "tJPYC/USDC": "USD/JPY",
    "tMXNB/USDC": "USD/MXN",
    "tCHFC/USDC": "USD/CHF",
  };
  return map[s] ?? s;
}
interface MarketDecoration {
  flagA: string;
  flagB: string;
  base: string;
  quote: string;
  leverage: number;
  type: "forex" | "perp" | "other";
}

// UI-only decoration. Field values are NOT chain-derived — they exist to
// render the symbol pill (flag emoji + leverage cap label). Adding a new
// symbol here unlocks pretty rendering; absence is graceful.
const MARKET_DECORATIONS: Readonly<Record<string, MarketDecoration>> = {
  "EUR/USD": { flagA: "🇪🇺", flagB: "🇺🇸", base: "EUR", quote: "USD", leverage: 100, type: "forex" },
  "EURC/USDC": { flagA: "🇪🇺", flagB: "🇺🇸", base: "EURC", quote: "USDC", leverage: 100, type: "forex" },
  "USDC/EURC": { flagA: "🇺🇸", flagB: "🇪🇺", base: "USDC", quote: "EURC", leverage: 100, type: "forex" },
  "MXNB/USDC": { flagA: "🇲🇽", flagB: "🇺🇸", base: "MXNB", quote: "USDC", leverage: 50, type: "forex" },
  "USDC/MXNB": { flagA: "🇺🇸", flagB: "🇲🇽", base: "USDC", quote: "MXNB", leverage: 50, type: "forex" },
  "USD/MXN": { flagA: "🇺🇸", flagB: "🇲🇽", base: "USD", quote: "MXN", leverage: 50, type: "forex" },
  "GBP/USD": { flagA: "🇬🇧", flagB: "🇺🇸", base: "GBP", quote: "USD", leverage: 100, type: "forex" },
  "USD/JPY": { flagA: "🇺🇸", flagB: "🇯🇵", base: "USD", quote: "JPY", leverage: 100, type: "forex" },
  "AUD/USD": { flagA: "🇦🇺", flagB: "🇺🇸", base: "AUD", quote: "USD", leverage: 50, type: "forex" },
  "USD/CHF": { flagA: "🇺🇸", flagB: "🇨🇭", base: "USD", quote: "CHF", leverage: 100, type: "forex" },
  "NZD/USD": { flagA: "🇳🇿", flagB: "🇺🇸", base: "NZD", quote: "USD", leverage: 50, type: "forex" },
  "USD/CAD": { flagA: "🇺🇸", flagB: "🇨🇦", base: "USD", quote: "CAD", leverage: 100, type: "forex" },
  "BTC-PERP": { flagA: "₿", flagB: "$", base: "BTC", quote: "USD", leverage: 100, type: "perp" },
  "ETH-PERP": { flagA: "Ξ", flagB: "$", base: "ETH", quote: "USD", leverage: 50, type: "perp" },
  "SOL-PERP": { flagA: "◎", flagB: "$", base: "SOL", quote: "USD", leverage: 50, type: "perp" },
};

function decorate(sym: string): MarketDecoration {
  const existing = MARKET_DECORATIONS[sym];
  if (existing) return existing;
  // Derive base/quote from the symbol pattern. Missing decoration → bland
  // fallback so we never throw mid-render.
  const fxMatch = sym.match(/^([A-Z]{3,4})\/([A-Z]{3,4})$/);
  if (fxMatch) {
    return {
      flagA: "—",
      flagB: "—",
      base: fxMatch[1]!,
      quote: fxMatch[2]!,
      leverage: 10,
      type: "forex",
    };
  }
  const perpMatch = sym.match(/^([A-Z]{2,5})-PERP$/);
  if (perpMatch) {
    return {
      flagA: "—",
      flagB: "$",
      base: perpMatch[1]!,
      quote: "USD",
      leverage: 10,
      type: "perp",
    };
  }
  return {
    flagA: "—",
    flagB: "—",
    base: sym,
    quote: "",
    leverage: 10,
    type: "other",
  };
}

export function useMarketList(chainIdOverride?: number): {
  markets: MarketListEntry[] | null;
  isLoading: boolean;
  isError: boolean;
} {
  const query = useMarkets(chainIdOverride);
  const wagmiChainId = useChainId();
  const devWallet = useMemo(() => getPerpsReplacementDevWallet(), []);
  const chainId = chainIdOverride ?? effectiveChainId(devWallet, wagmiChainId);

  const markets = useMemo<MarketListEntry[] | null>(() => {
    if (!query.data) return null;
    return query.data.map((dto) => {
      const uiSymbol = apiSymbolToUiSymbol(dto.symbol);
      // Decorate from the UI symbol so charts/flags align with the
      // canonical FX pair, not the on-chain stable-pair form.
      const dec = decorate(uiSymbol);
      return {
        marketId: dto.marketId,
        sym: uiSymbol,
        apiSymbol: dto.symbol,
        uiSymbol,
        base: dec.base,
        quote: dec.quote,
        flagA: dec.flagA,
        flagB: dec.flagB,
        leverage: dec.leverage,
        type: dec.type,
        chainId: dto.chainId ?? chainId,
        enabled: dto.enabled,
      };
    });
  }, [query.data, chainId]);

  return {
    markets,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/**
 * Hubs-aware market list. Fans out one `/perps/markets` query per known
 * hub chainId (Arc testnet + Fuji today) and concatenates the results,
 * keeping the same shape as `useMarketList()`.
 *
 * Why this exists: perp markets are split across hubs — Arc registers
 * FX (EURC/USDC, tJPYC/USDC, …) while Fuji is the EVM hub for crypto
 * perps. A single-chain picker only sees half of the catalogue
 * depending on which network wagmi is currently on, which silently
 * hides selectable markets and confuses the chart's "no data" state.
 *
 * `markets` is null while any underlying query is loading. `isError`
 * is true if EVERY hub query errored — partial errors degrade
 * gracefully so the picker still shows the live half.
 */
export function useMultiHubMarketList(): {
  markets: MarketListEntry[] | null;
  isLoading: boolean;
  isError: boolean;
} {
  // Each hub uses the same single-chain hook; the override forces the
  // queryKey + fetch URL onto that hub regardless of wagmi's chain.
  // HUB_CHAIN_IDS comes from @bufi/location/hubs so adding a third hub
  // doesn't require touching this file.
  const arc = useMarketList(HUBS.arc.chainId);
  const fuji = useMarketList(HUBS.fuji.chainId);

  const markets = useMemo<MarketListEntry[] | null>(() => {
    if (arc.markets == null && fuji.markets == null) return null;
    const merged: MarketListEntry[] = [];
    if (arc.markets) merged.push(...arc.markets);
    if (fuji.markets) merged.push(...fuji.markets);
    return merged;
  }, [arc.markets, fuji.markets]);

  return {
    markets,
    isLoading: arc.isLoading || fuji.isLoading,
    isError: arc.isError && fuji.isError,
  };
}

/**
 * 24h stats (last / change% / high / low / volume) live at
 * `@/lib/perps/use-market-stats` — it predates this file and is already
 * consumed by panels.tsx. Import that hook directly.
 */

/**
 * Historical OHLCV from Pyth Benchmarks. The 15m / 200-candle default
 * matches the chart card's window. Pass `tf` like "1m" / "5m" / "1h" /
 * "1d" to switch frame.
 */
export function useMarketCandles(args: {
  sym: string | undefined;
  tf?: string;
  limit?: number;
}): UseQueryResult<PerpsCandlesResponseDto> {
  return useQuery({
    queryKey: ["perps", "candles", args.sym, args.tf, args.limit],
    enabled: Boolean(args.sym),
    queryFn: ({ signal }) =>
      fetchPerpsCandles({
        sym: args.sym!,
        tf: args.tf,
        limit: args.limit,
        signal,
      }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

/**
 * Pending-intents view (bids + asks bucketed by 1e14 price step). 5s
 * refetch matches the matcher's poll cadence — a fresh order placed on
 * the trade panel shows up in the book within one tick.
 */
export function useOrderbook(args: {
  marketId: string | undefined;
  depth?: number;
}): UseQueryResult<PerpsOrderbookDto> {
  return useQuery({
    queryKey: ["perps", "orderbook", args.marketId, args.depth],
    enabled: Boolean(args.marketId),
    queryFn: ({ signal }) =>
      fetchPerpsOrderbook({
        marketId: args.marketId!,
        depth: args.depth,
        signal,
      }),
    staleTime: 4_000,
    refetchInterval: 5_000,
  });
}

export function usePositions(addressOverride?: `0x${string}`): UseQueryResult<PerpsPositionDto[]> {
  const { address } = useAccount();
  const wagmiChainId = useChainId();
  const devWallet = useMemo(() => getPerpsReplacementDevWallet(), []);
  const target =
    addressOverride ??
    (devWallet?.address as `0x${string}` | undefined) ??
    (address as `0x${string}` | undefined);
  const chainId = effectiveChainId(devWallet, wagmiChainId);

  // CACHE-ONLY session read — NEVER prompt the wallet from here. The
  // previous implementation called `signSession()` from the queryFn,
  // which auto-popped a MetaMask EIP-712 signature on every connect
  // AND on every `refetchInterval` tick. Users hit a forever-loop of
  // sign prompts: reject once → wagmi emits `eth_accounts: []` → MM
  // disconnects → next render re-enables → prompt fires again. Fix:
  // read the cached proof if a previous explicit user action (place
  // order, perps-replacement agent CTA) already signed; otherwise
  // return [] and wait for that explicit sign.
  return useQuery({
    queryKey: ["perps", "positions", chainId, target?.toLowerCase()],
    enabled: Boolean(target),
    queryFn: async ({ signal }) => {
      if (!target) return [];
      const proof = readCachedWalletSession(target, chainId);
      if (!proof) return [];
      return fetchPerpsPositions({ address: target, proof, signal });
    },
    refetchInterval: POSITIONS_REFETCH_MS,
    staleTime: POSITIONS_REFETCH_MS / 2,
  });
}

export function useTrades(addressOverride?: `0x${string}`): UseQueryResult<PerpsTradeDto[]> {
  const { address } = useAccount();
  const devWallet = useMemo(() => getPerpsReplacementDevWallet(), []);
  const target =
    addressOverride ??
    (devWallet?.address as `0x${string}` | undefined) ??
    (address as `0x${string}` | undefined);
  return useQuery({
    queryKey: ["perps", "trades", target?.toLowerCase()],
    enabled: Boolean(target),
    queryFn: ({ signal }) => {
      if (!target) return Promise.resolve([] as PerpsTradeDto[]);
      return fetchPerpsTrades({ address: target, signal });
    },
    refetchInterval: TRADES_REFETCH_MS,
    staleTime: TRADES_REFETCH_MS / 2,
  });
}

export function useQuote(request: PerpsQuoteRequestBody | null): UseQueryResult<PerpsQuoteDto> {
  return useQuery({
    queryKey: [
      "perps",
      "quote",
      request?.chainId,
      request?.marketId,
      request?.side,
      request?.sizeUsdc,
      request?.leverage,
    ],
    enabled: Boolean(request) && Number(request?.sizeUsdc) > 0,
    queryFn: ({ signal }) => {
      if (!request) throw new Error("quote request is null");
      return fetchPerpsQuote({ request, signal });
    },
    staleTime: 4_000,
  });
}

export function useFunding(marketId?: string, chainIdOverride?: number): UseQueryResult<PerpsFundingDto[]> {
  const wagmiChainId = useChainId();
  const devWallet = useMemo(() => getPerpsReplacementDevWallet(), []);
  const chainId = chainIdOverride ?? effectiveChainId(devWallet, wagmiChainId);
  return useQuery({
    queryKey: ["perps", "funding", chainId, marketId],
    queryFn: ({ signal }) => fetchPerpsFunding({ chainId, marketId, signal }),
    staleTime: 30_000,
  });
}

export function useLiquidationCandidates(chainIdOverride?: number): UseQueryResult<unknown[]> {
  const wagmiChainId = useChainId();
  const devWallet = useMemo(() => getPerpsReplacementDevWallet(), []);
  const chainId = chainIdOverride ?? effectiveChainId(devWallet, wagmiChainId);
  return useQuery({
    queryKey: ["perps", "liquidations", chainId],
    queryFn: ({ signal }) => fetchPerpsLiquidationCandidates({ chainId, signal }),
    staleTime: 15_000,
  });
}

export function usePlaceOrder(): UseMutationResult<UsePlaceOrderResult, Error, UsePlaceOrderInput> {
  const wagmiChainId = useChainId();
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const devWallet = useMemo(() => getPerpsReplacementDevWallet(), []);
  const signSession = useSessionSigner();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["perps", "place-order"],
    mutationFn: async (input: UsePlaceOrderInput): Promise<UsePlaceOrderResult> => {
      const trader = ((devWallet?.address as `0x${string}` | undefined) ??
        (address as `0x${string}` | undefined)) ?? null;
      if (!trader) throw new Error("connect a wallet to place an order");
      const chainId = (input.chainId ?? effectiveChainId(devWallet, wagmiChainId)) as ChainId;
      const nonce = input.nonce ?? freshReplacementNonce();
      const deadline = Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? ORDER_DEFAULT_TTL_SECONDS);
      const priceE18 = input.orderType === "market" ? "0" : input.priceE18 ?? "0";
      if (input.orderType === "limit" && priceE18 === "0") {
        throw new Error("limit orders require a non-zero priceE18");
      }
      const reduceOnly = input.reduceOnly ?? false;
      const postOnly = input.postOnly ?? false;

      // Same builder + verifier the API uses; if this matches the server-side
      // typed data we're guaranteed the signature recovers to `trader`.
      const orderInput: PerpsOrderTypedDataInput = {
        chainId,
        trader,
        marketId: input.marketId,
        side: input.side,
        orderType: input.orderType,
        sizeUsdc: input.sizeUsdc,
        leverage: input.leverage,
        priceE18,
        reduceOnly,
        postOnly,
        nonce,
        deadline,
      };
      const typedData = buildPerpsOrderTypedData(orderInput);
      const digest = hashPerpsOrder(orderInput);

      let signature: Hex;
      try {
        signature = devWallet
          ? await devWallet.signTypedData({
              domain: {
                name: typedData.domain.name ?? "TelaranaFxOrderSettlement",
                version: typedData.domain.version ?? "1",
                chainId: Number(typedData.domain.chainId ?? chainId),
                verifyingContract:
                  (typedData.domain.verifyingContract as `0x${string}` | undefined) ??
                  ("0x0000000000000000000000000000000000000000" as `0x${string}`),
              },
              types: typedData.types as unknown as Record<
                string,
                Array<{ name: string; type: string }>
              >,
              primaryType: typedData.primaryType,
              // dev-mock-wallet rehydrates bigints internally; pass strings.
              message: {
                trader: typedData.message.trader,
                marketId: typedData.message.marketId,
                sizeDeltaE18: typedData.message.sizeDeltaE18.toString(),
                priceE18: typedData.message.priceE18.toString(),
                orderType: typedData.message.orderType,
                flags: typedData.message.flags,
                nonce: typedData.message.nonce.toString(),
                deadline: typedData.message.deadline.toString(),
              },
            })
          : ((await signTypedDataAsync({
              domain: typedData.domain,
              types: typedData.types,
              primaryType: typedData.primaryType,
              message: typedData.message,
            })) as Hex);
      } catch (error) {
        if (isUserRejection(error)) {
          throw new Error("Order cancelled in wallet");
        }
        throw error;
      }

      const proof = await signSession(trader, chainId);
      if (!proof) throw new Error("wallet session required");

      const intent = await submitPerpsIntent({
        request: {
          chainId,
          marketId: input.marketId,
          trader,
          side: input.side,
          sizeUsdc: input.sizeUsdc,
          leverage: input.leverage,
          deadline,
          nonce,
          orderType: input.orderType,
          priceE18,
          reduceOnly,
          postOnly,
          signature,
        },
        proof,
      });

      return { intent, digest, nonce, deadline };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["perps", "positions"] });
      void queryClient.invalidateQueries({ queryKey: ["perps", "trades"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Returns a function that signs (or reuses a cached) wallet-session EIP-712
 * payload. Mirrors the agent flow in perps-replacement-agent so we don't end
 * up with two divergent session caches.
 */
function useSessionSigner(): (
  address: `0x${string}`,
  chainId: number,
) => Promise<WalletSessionProof | null> {
  const { signTypedDataAsync } = useSignTypedData();
  const devWallet = useMemo(() => getPerpsReplacementDevWallet(), []);
  // Stable ref so callers can drop it into a useCallback dep list without
  // re-creating queries every render.
  const ref = useRef<
    ((address: `0x${string}`, chainId: number) => Promise<WalletSessionProof | null>) | null
  >(null);

  ref.current = useCallback(
    async (address: `0x${string}`, chainId: number) => {
      const cached = readCachedWalletSession(address, chainId);
      if (cached) return cached;
      const session = buildWalletSessionTypedData({ address, chainId });
      let signature: Hex;
      try {
        signature = devWallet
          ? ((await devWallet.signSessionTypedData(session.typedData)) as Hex)
          : ((await signTypedDataAsync({
              domain: session.typedData.domain,
              types: session.typedData.types,
              primaryType: session.typedData.primaryType,
              message: session.typedData.message,
            })) as Hex);
      } catch (error) {
        if (isUserRejection(error)) return null;
        throw error;
      }
      const proof: WalletSessionProof = {
        address,
        chainId,
        message: session.message,
        signature,
        iat: session.iat,
        exp: session.exp,
        typedData: session.typedData,
      };
      writeCachedWalletSession(proof);
      return proof;
    },
    [devWallet, signTypedDataAsync],
  );

  return useCallback(
    (address, chainId) => ref.current!(address, chainId),
    [],
  );
}
