/**
 * `useUnifiedUsdcBalance` — React Query hook around Circle Gateway's
 * unified balance API.
 *
 * Talks to the apps/api `/gateway/balance/:address` proxy (NEVER directly
 * to Circle), so the Gateway API key never reaches the browser. The
 * proxy reshapes Circle's domain-keyed response into a chainId-keyed
 * map, which the wallet popover renders verbatim.
 *
 * The hook is designed to fail GRACEFULLY:
 *
 *   - If no API base URL is configured (missing `NEXT_PUBLIC_API_URL` /
 *     `NEXT_PUBLIC_BUFI_API_URL` AND no `NEXT_PUBLIC_CIRCLE_GATEWAY_API_URL`
 *     override), the query stays disabled and returns the empty shape
 *     with `disabled: true`. The popover collapses the Gateway line in
 *     that case — no error toast, no flicker.
 *
 *   - If the wallet isn't connected, same thing.
 *
 *   - If the proxy itself 5xx's (e.g. the server-side key is missing
 *     and Circle starts requiring it later), the query surfaces `error`
 *     and the popover renders an "unavailable" footer note instead of
 *     blocking the per-token list.
 *
 * Returned shape:
 *
 *   {
 *     total:     "12.345670",          // decimal string, 6 dp
 *     perHub:    { "43113": "5.0", … } // chainId → decimal string
 *     isLoading: boolean,
 *     error:     Error | null,
 *     disabled:  boolean,              // true when env-vars are absent
 *     env:       "testnet" | "mainnet"
 *   }
 */

"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { resilientJsonFetch } from "@/lib/api-client";

export interface UnifiedUsdcBalanceOpts {
  /** EVM address whose Gateway deposits we want the unified balance for.
   *  When undefined the hook stays in `disabled: true` mode. */
  walletAddress?: `0x${string}`;
  /** Defaults to `"testnet"` — we only render testnet hubs in apps/web today. */
  env?: "testnet" | "mainnet";
  /** Override the React Query staleTime. Defaults to 30s — Gateway
   *  balances change on deposit/burn, both of which the user initiates,
   *  so we don't need sub-second freshness. */
  staleTimeMs?: number;
}

export interface UnifiedUsdcBalance {
  /** Decimal USDC string, "0" when no data. Always present so the
   *  popover can render unconditionally. */
  total: string;
  /** chainId → decimal USDC string. Empty object when disabled. */
  perHub: Record<string, string>;
  /** True while the query is in-flight. False when disabled. */
  isLoading: boolean;
  /** Last query error, or null. Null when disabled. */
  error: Error | null;
  /** True when no API base URL is configured OR no wallet is connected.
   *  Callers use this to suppress the Gateway UI without rendering an
   *  empty/error state. */
  disabled: boolean;
  /** Environment we asked the proxy about. Echoed from the response. */
  env: "testnet" | "mainnet";
}

interface ProxyResponse {
  token: "USDC";
  total: string;
  perDomain: Record<string, string>;
  perChain: Record<string, string>;
  env: "testnet" | "mainnet";
}

const DEFAULT_STALE_MS = 30_000;
const DISABLED_RESULT: Omit<UnifiedUsdcBalance, "env"> = {
  total: "0",
  perHub: {},
  isLoading: false,
  error: null,
  disabled: true,
};

/**
 * Returns the apps/api base URL the proxy lives under, or `null` when
 * the env isn't configured. Mirrors `apiBaseUrl()` in api-client.ts but
 * returns null (instead of localhost fallback) so the hook can decide
 * to disable cleanly.
 *
 * `NEXT_PUBLIC_CIRCLE_GATEWAY_API_URL` is an explicit override — point
 * it at a different proxy or a Circle test fixture. When set, it wins
 * over the standard api base.
 */
function resolveProxyBaseUrl(): string | null {
  const override = process.env.NEXT_PUBLIC_CIRCLE_GATEWAY_API_URL;
  if (override) return override.replace(/\/$/, "");
  const apiBase =
    process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_BUFI_API_URL;
  if (!apiBase) return null;
  return apiBase.replace(/\/$/, "");
}

export function useUnifiedUsdcBalance(
  opts: UnifiedUsdcBalanceOpts,
): UseQueryResult<ProxyResponse> & { value: UnifiedUsdcBalance } {
  const { walletAddress, env = "testnet", staleTimeMs = DEFAULT_STALE_MS } = opts;
  const proxyBase = resolveProxyBaseUrl();

  const enabled = Boolean(proxyBase && walletAddress);

  const query = useQuery<ProxyResponse>({
    queryKey: ["circle-gateway", "unified-balance", env, walletAddress ?? null],
    enabled,
    staleTime: staleTimeMs,
    queryFn: async ({ signal }) => {
      // `enabled` already guards these — narrow for TypeScript.
      if (!proxyBase || !walletAddress) {
        throw new Error("disabled");
      }
      const url = `${proxyBase}/gateway/balance/${walletAddress}?env=${env}`;
      const res = await resilientJsonFetch(url, { signal });
      if (!res.ok) {
        let detail = "";
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) detail = `: ${body.error}`;
        } catch {
          // ignore body parse failures
        }
        throw new Error(`gateway proxy ${res.status}${detail}`);
      }
      return (await res.json()) as ProxyResponse;
    },
  });

  const value: UnifiedUsdcBalance = enabled
    ? {
        total: query.data?.total ?? "0",
        perHub: query.data?.perChain ?? {},
        isLoading: query.isLoading || query.isFetching,
        error: query.error instanceof Error ? query.error : null,
        disabled: false,
        env,
      }
    : { ...DISABLED_RESULT, env };

  return Object.assign(query, { value });
}
