/**
 * Barrel for the read-side query helpers.
 *
 * Each query is a plain async function — drop-in compatible with
 * `@tanstack/react-query`'s `queryFn`.
 *
 * @example
 * ```ts
 * import { useQuery } from "@tanstack/react-query";
 * import { getMarkets, type BufiMarket } from "@bufi/sdk/queries";
 *
 * const { data } = useQuery({
 *   queryKey: ["bufi", "markets", 5042002],
 *   queryFn: ({ signal }) => getMarkets(bufi, { chainId: 5042002, signal }),
 * });
 * ```
 */

export * from "./markets";
export * from "./positions";
export * from "./analytics";
