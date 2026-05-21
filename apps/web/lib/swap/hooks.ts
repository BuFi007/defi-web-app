/**
 * React Query + wagmi bindings for the /swap widget.
 *
 *   useSpotQuote(args)   → POSTs /spot/quote on every (pair, amountIn,
 *                          trader) change, debounced upstream by the
 *                          component layer. Returns { quoteId, router,
 *                          digest, typedData, calldata, ttlSec,
 *                          expiresAt } verbatim from the API.
 *
 *   useSubmitFill()      → Mutation that (1) signs the K3-issued
 *                          typedData with wagmi's useSignTypedData,
 *                          (2) POSTs to /spot/fills with the wallet
 *                          session header, (3) returns the API
 *                          `{ fillId, quoteId, status, reason }` body.
 *
 * The on-chain `PoolManager.unlock` + `swap` call is deliberately NOT
 * fired from here — Wave-K1/K2 don't yet have the FxSwapHook deployed
 * + wired through `BuFxVenueRequestRouter.requestSpotWithSignature`. The
 * /spot/fills endpoint persists the accepted intent server-side and
 * (in a follow-up PR) dispatches it through the venue router. The
 * widget surfaces this honestly via the response's `fillId` field.
 */
"use client";

import { useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { UserRejectedRequestError, type Hex } from "viem";
import { useSignTypedData } from "wagmi";

import {
  walletSessionHeaders,
  type WalletSessionProof,
} from "@bufi/wallet/session";

import { api, apiBaseUrl } from "@/lib/api-client";
import type { SpotPair, SpotPairSymbol } from "./pairs";

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirror the API's `QuoteRequest` / `QuoteResponse` / `FillResponse`
// shapes from apps/api/src/routes/spot.ts. We re-declare them here so the
// widget can hold a quote in component state without importing the
// `@hono/zod-openapi` schemas across the bundler boundary.
// ─────────────────────────────────────────────────────────────────────────────

export interface SpotQuoteArgs {
  pair: SpotPair;
  trader: `0x${string}`;
  amountIn: string; // decimal-amount string in input-token base units (e.g. "100000000" for 100 USDC)
  minAmountOut: string;
  /** Unix seconds quote+fill must be redeemed by. */
  deadline: number;
  /** Caller-chosen nonce. Freshly generated per quote request. */
  nonce: string;
}

export interface SpotQuoteResponse {
  quoteId: string;
  router: `0x${string}`;
  digest: `0x${string}`;
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  };
  calldata: `0x${string}`;
  ttlSec: number;
  expiresAt: number;
}

export interface SpotFillResponse {
  fillId: string;
  quoteId: string;
  status: "accepted" | "rejected";
  reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crypto-strong-ish nonce. Same shape as
 * `freshReplacementNonce` in @/lib/perps/replacement-agent (decimal
 * string) so the API's `/^\d+$/` regex accepts it unchanged.
 */
export function freshSpotNonce(): string {
  const r = new Uint32Array(1);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(r);
  } else {
    r[0] = Math.floor(Math.random() * 2 ** 32);
  }
  return (BigInt(Date.now()) * 1_000_000n + BigInt(r[0]! % 1_000_000)).toString();
}

export function isUserRejection(error: unknown): boolean {
  if (error instanceof UserRejectedRequestError) return true;
  const e = error as { code?: number; name?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === 4001) return true;
  if (e.name === "UserRejectedRequestError") return true;
  return typeof e.message === "string" && /user rejected|user denied/i.test(e.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// useSpotQuote
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Streams a fresh quote from /spot/quote whenever the input args change.
 * The component layer debounces input changes (300ms) by gating
 * `enabled` on a stable key, then auto-refreshes 5s before `expiresAt`.
 *
 * Returns the raw API response so the CTA can pass `typedData` straight
 * into `signTypedDataAsync`.
 */
export function useSpotQuote(args: SpotQuoteArgs | null): UseQueryResult<SpotQuoteResponse> {
  // The hc<AppType> client carries OpenAPI-derived response types. We
  // do a narrow runtime cast at the boundary because the K3 schema uses
  // `.passthrough()` on `typedData` — the values are correct, but the
  // type is `unknown` on the inferred surface.
  return useQuery({
    queryKey: [
      "spot",
      "quote",
      args?.pair.symbol,
      args?.trader?.toLowerCase(),
      args?.amountIn,
      args?.minAmountOut,
      args?.deadline,
      args?.nonce,
    ],
    enabled: Boolean(
      args &&
        args.trader &&
        args.amountIn &&
        args.amountIn !== "0" &&
        args.minAmountOut &&
        args.deadline,
    ),
    queryFn: async ({ signal }) => {
      if (!args) throw new Error("quote args missing");
      // The hc client carries the request shape from the OpenAPI route.
      // `api.spot.quote.$post` returns a typed `Response` where `.json()`
      // is one of the documented response unions. We narrow it via
      // `res.ok` so 4xx surfaces as a thrown error instead of silently
      // returning an error body.
      const res = await api.spot.quote.$post(
        {
          json: {
            sourceChainId: args.pair.sourceChainId,
            destinationChainId: args.pair.destinationChainId,
            symbol: args.pair.symbol,
            trader: args.trader,
            amountIn: args.amountIn,
            minAmountOut: args.minAmountOut,
            deadline: args.deadline,
            nonce: args.nonce,
          },
        },
        { init: { signal } },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `spot.quote failed: HTTP ${res.status}`);
      }
      return (await res.json()) as SpotQuoteResponse;
    },
    // Quotes are short-lived; the component overlays a TTL-driven
    // refresh so React Query's own staleTime is just a backstop.
    staleTime: 4_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// useSubmitFill — sign + POST /spot/fills
// ─────────────────────────────────────────────────────────────────────────────

export interface SubmitFillArgs {
  quote: SpotQuoteResponse;
  trader: `0x${string}`;
  /** Wallet session proof so the API can attribute the fill to the right
   *  address. Comes from useSessionSigner() / readCachedWalletSession()
   *  upstream — fresh sign happens at the widget level. */
  session: WalletSessionProof;
}

export interface SubmitFillResult {
  signature: Hex;
  /** API response. `status === "rejected"` is NOT thrown — the widget
   *  renders the `reason` so the user can see "signature did not
   *  recover trader" etc. */
  fill: SpotFillResponse;
}

export function useSubmitFill() {
  const { signTypedDataAsync } = useSignTypedData();
  return useMutation<SubmitFillResult, Error, SubmitFillArgs>({
    mutationKey: ["spot", "submit-fill"],
    mutationFn: async ({ quote, trader, session }) => {
      // 1. Sign the K3-issued typedData. We deliberately do NOT rebuild
      //    the typedData here — the API will verify against the exact
      //    bytes it handed out, and any drift between client + server
      //    schemas would surface as "signature did not recover trader".
      let signature: Hex;
      try {
        // The hc client narrows `typedData` to `unknown` because the K3
        // schema is `.passthrough()` (the API verifies against the exact
        // bytes it handed out so it doesn't re-declare the shape). At
        // runtime these are valid EIP-712 fields. wagmi's
        // `useSignTypedData` is hyper-strict generically — we erase the
        // arg type at this single boundary so a one-line schema-shape
        // tightening upstream doesn't require touching the widget.
        const args = {
          domain: quote.typedData.domain,
          types: quote.typedData.types,
          primaryType: quote.typedData.primaryType,
          message: quote.typedData.message,
        } as unknown as Parameters<typeof signTypedDataAsync>[0];
        signature = (await signTypedDataAsync(args)) as Hex;
      } catch (error) {
        if (isUserRejection(error)) {
          throw new Error("Swap cancelled in wallet");
        }
        throw error;
      }

      // 2. POST /spot/fills with the wallet-session header. The hc
      //    client doesn't expose the header-injection surface needed
      //    for the session proof, so we use the URL it would have
      //    derived and call fetch directly. This matches the pattern
      //    already used by `submitPerpsIntent` in lib/perps/client.ts.
      const url = `${apiBaseUrl().replace(/\/$/, "")}/spot/fills`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...walletSessionHeaders(session),
        },
        body: JSON.stringify({
          quoteId: quote.quoteId,
          signature,
          trader,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<SpotFillResponse> & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `spot.fills failed: HTTP ${res.status}`);
      }
      // Cast the partial back up — the response schema guarantees these
      // fields when the API returns 200, but TypeScript's `Partial` was
      // applied for the error path.
      return { signature, fill: body as SpotFillResponse };
    },
  });
}

// Re-export for the widget's debounce key.
export type { SpotPairSymbol };
