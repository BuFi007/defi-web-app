/**
 * v4 hook + periphery router deployment manifest for the FX Telaraña /
 * BUFI / BUFX stack. Sibling to `deployments.ts` (stablecoin ERC-20s) and
 * `hubs.ts` (hub chain metadata) — kept env-free, no viem import, no
 * runtime config, so this module is safe to import from any layer
 * (browser bundle, server, deploy scripts).
 *
 * The canonical source of truth lives in `@bufi/contracts/bento`
 * (`getBentoV4Periphery(chainId)`). This module re-surfaces the same
 * addresses keyed by chainId for callers that already depend on
 * `@bufi/location` but don't want to pull in the larger contracts
 * package. Keep both files in sync: if a hook address changes here,
 * change it in `packages/contracts/src/bento.ts` AND
 * `packages/contracts/deployments/telarana-arc-testnet.json`.
 *
 * Wave M1 deploys (2026-05-21) — Arc Testnet (5042002):
 *   FxSwapHook              0xC6F894f30d0D28972C876B4af58C02A4E88A0aC8
 *   TelaranaGatewayHubHook  0xe895CB461AFF6E98167a7FA0Db252ba906714088
 *
 * Source: fx-telarana@feat/wave-m1-deploy-arc-hooks
 *         deployments/arc-testnet.json
 */

/** Hex-string address. Re-declared locally so this module stays
 *  dependency-free (no viem import in @bufi/location). */
export type Address = `0x${string}`;

export interface V4HookDeployment {
  /** Uniswap v4 hook contract address (CREATE2-deployed, salt-mined
   *  against the permission flags packed into the low-14 bits). */
  address: Address;
  /** Human description of the encoded permission bits. */
  permissionFlags: string;
}

export interface V4PeripheryDeployment {
  /** PoolSwapTest router OR a minimal FxSwapRouter forwarder. Used by
   *  demo scripts to call `PoolManager.unlock` → inner `swap` from an
   *  EOA. `null` until Wave M3 broadcasts it from the fx-telarana repo
   *  — until then, read from env `V4_SWAP_ROUTER_<CHAINID>`. */
  v4SwapRouter: Address | null;
  /** Uniswap v4 hooks deployed alongside the PoolManager. */
  hooks: {
    fxSwapHook?: V4HookDeployment;
    telaranaGatewayHubHook?: V4HookDeployment;
  };
}

const DEPLOYMENTS: Record<number, V4PeripheryDeployment> = {
  // Arc Testnet — Wave M1 (2026-05-21).
  5042002: {
    v4SwapRouter: null,
    hooks: {
      fxSwapHook: {
        address: "0xC6F894f30d0D28972C876B4af58C02A4E88A0aC8",
        permissionFlags:
          "beforeAddLiquidity | beforeRemoveLiquidity | beforeSwap | afterSwap | beforeSwapReturnDelta",
      },
      telaranaGatewayHubHook: {
        address: "0xe895CB461AFF6E98167a7FA0Db252ba906714088",
        permissionFlags: "beforeSwap | beforeSwapReturnDelta",
      },
    },
  },
};

/** Per-chain v4 hook + periphery deployment. Returns null when nothing
 *  is deployed on the chain yet (every non-Arc chain today). */
export function getV4PeripheryDeployment(
  chainId: number,
): V4PeripheryDeployment | null {
  return DEPLOYMENTS[chainId] ?? null;
}

/** Convenience: FxSwapHook address for `chainId`, or null. */
export function getFxSwapHookAddress(chainId: number): Address | null {
  return DEPLOYMENTS[chainId]?.hooks.fxSwapHook?.address ?? null;
}

/** Convenience: TelaranaGatewayHubHook address for `chainId`, or null. */
export function getTelaranaGatewayHubHookAddress(
  chainId: number,
): Address | null {
  return DEPLOYMENTS[chainId]?.hooks.telaranaGatewayHubHook?.address ?? null;
}

/**
 * v4 swap router for `chainId`. Returns the pinned address when
 * available, or null when not yet deployed. For env-var fallback
 * (`V4_SWAP_ROUTER_<CHAINID>`) use the sibling helper in
 * `@bufi/contracts/bento` (`getV4SwapRouterAddress`) — kept out of
 * this module so `@bufi/location` stays dependency-free and safe to
 * import from any layer (browser bundle, server, deploy scripts).
 *
 * Universal Router would be the preferred entry point per the v4 SDK,
 * but is not deployed on Arc Testnet — see
 * https://developers.uniswap.org/contracts/v4/deployments (checked
 * 2026-05-21). PoolSwapTest (from `@uniswap/v4-core/src/test/`) is the
 * canonical fallback for EOA-driven swaps.
 */
export function getV4SwapRouterAddress(chainId: number): Address | null {
  return DEPLOYMENTS[chainId]?.v4SwapRouter ?? null;
}

/** Chains with at least one v4 hook pinned. */
export const V4_HOOK_DEPLOYED_CHAIN_IDS: readonly number[] = Object.keys(
  DEPLOYMENTS,
).map(Number);
