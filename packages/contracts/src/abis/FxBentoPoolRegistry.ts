// SPDX-License-Identifier: Apache-2.0
// PoolRegistry (FX² Arcade) ABI — ported from fx-bento monorepo.
import { parseAbi } from "viem";

export const FxBentoPoolRegistryAbi = parseAbi([
  "event PoolAllowed(bytes32 indexed poolId, address indexed baseToken, address indexed quoteToken, address hook, bool allowed)",
  "function setPool((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key, address oracleSource, bool allowed, uint32 maxStaleSeconds)",
  "function isAllowed(bytes32 poolId) view returns (bool)",
  "function isAllowedKey((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key) view returns (bool)",
  "function getPool(bytes32 poolId) view returns (((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,address baseToken,address quoteToken,address oracleSource,bool allowed,uint32 maxStaleSeconds,int24 tickSpacing,address hook))",
]);
