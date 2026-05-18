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

import {
  fetchPerpsFunding,
  fetchPerpsLiquidationCandidates,
  fetchPerpsMarkets,
  fetchPerpsPositions,
  fetchPerpsQuote,
  fetchPerpsTrades,
  submitPerpsIntent,
  type PerpsFundingDto,
  type PerpsIntentResponseDto,
  type PerpsMarketDto,
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

export function usePositions(addressOverride?: `0x${string}`): UseQueryResult<PerpsPositionDto[]> {
  const { address } = useAccount();
  const wagmiChainId = useChainId();
  const devWallet = useMemo(() => getPerpsReplacementDevWallet(), []);
  const signSession = useSessionSigner();
  const target =
    addressOverride ??
    (devWallet?.address as `0x${string}` | undefined) ??
    (address as `0x${string}` | undefined);
  const chainId = effectiveChainId(devWallet, wagmiChainId);

  return useQuery({
    queryKey: ["perps", "positions", chainId, target?.toLowerCase()],
    enabled: Boolean(target),
    queryFn: async ({ signal }) => {
      if (!target) return [];
      const proof = await signSession(target, chainId);
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
