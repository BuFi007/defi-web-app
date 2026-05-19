import type { ChainList } from "@/lib/types";

/**
 * The chainId union wagmi accepts at the call-site — must mirror the
 * chains actually registered with the wagmi/Dynamic provider at runtime.
 *
 * `ChainList` is the *app-wide* superset of every chain the UI knows about
 * (testnets + future chains the wagmi config hasn't been wired for yet).
 * `WagmiChainId` is the *runtime* subset that wagmi's hooks will accept.
 *
 * Keep in sync when chains are added/removed from the wagmi config.
 */
export type WagmiChainId =
  | 1
  | 43113
  | 5042002
  | 43114
  | 11155111
  | 421614
  | undefined;

const WAGMI_SUPPORTED_CHAIN_IDS: ReadonlyArray<NonNullable<WagmiChainId>> = [
  1, // Ethereum mainnet (read-only, auth shape parity — MM default chain)
  43113, // Avalanche Fuji (hub)
  5042002, // Arc Testnet (hub)
  43114, // Avalanche mainnet (read-only, auth shape parity)
  11155111, // Ethereum Sepolia (spoke)
  421614, // Arbitrum Sepolia (spoke)
];

/**
 * Narrow a `ChainList` value down to wagmi's accepted union.
 *
 * If the current chain isn't in the wagmi config, returns `undefined` —
 * wagmi's hooks accept `undefined` and skip the call, which is the
 * correct runtime behavior for a chain that hasn't been wired up.
 *
 * Use this at every wagmi call site that takes our `ChainList`:
 *
 * ```ts
 * const { data } = useReadContract({
 *   chainId: toWagmiChainId(chainId),
 *   // ...
 * });
 * ```
 */
export function toWagmiChainId(chainId: ChainList): WagmiChainId {
  if (chainId == null) return undefined;
  return WAGMI_SUPPORTED_CHAIN_IDS.includes(
    chainId as NonNullable<WagmiChainId>,
  )
    ? (chainId as NonNullable<WagmiChainId>)
    : undefined;
}
