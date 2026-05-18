// SPDX-License-Identifier: Apache-2.0
// FXBentoHook (Uniswap v4 hook) ABI — ported from fx-bento monorepo.
import { parseAbi } from "viem";

export const FxBentoHookAbi = parseAbi([
  "event PoolInitialized(bytes32 indexed poolId, address indexed currency0, address indexed currency1)",
  "event FXBentoMarketSnapshot(bytes32 indexed poolId, uint256 indexed snapshotId, uint160 sqrtPriceX96, int24 tick, uint64 timestamp, uint256 volatility)",
  "event PreSwapContext(bytes32 indexed poolId, address indexed sender)",
  "event ArcadeFeeVaultUpdated(address indexed feeVault)",
  "event HookPoolAllowedUpdated(bytes32 indexed poolId, bool allowed)",
  "function setFeeVault(address feeVault)",
  "function setHookPoolAllowed(bytes32 poolId, bool allowed)",
  "function validatePool((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key) view returns (bool)",
  "function latestSnapshot(bytes32 poolId) view returns ((uint256 snapshotId,uint160 sqrtPriceX96,int24 tick,uint64 timestamp,uint256 volatility))",
  "function getPoolSnapshot(bytes32 poolId) view returns ((uint256 snapshotId,uint160 sqrtPriceX96,int24 tick,uint64 timestamp,uint256 volatility))",
  "function snapshotById(bytes32 poolId, uint256 snapshotId) view returns ((uint256 snapshotId,uint160 sqrtPriceX96,int24 tick,uint64 timestamp,uint256 volatility))",
  "function realizedVolatility(bytes32 poolId, uint256 window) view returns (uint256)",
]);
