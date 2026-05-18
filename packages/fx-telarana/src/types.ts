import type { Address, Hex } from "viem";

import type { TelaranaHubChainId, TelaranaHubName } from "@bufi/contracts/telarana";

export type MarketParams = {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
};

export type MorphoMarketState = {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
};

export type MorphoPositionState = {
  supplyShares: bigint;
  borrowShares: bigint;
  collateral: bigint;
};

export type LendingMarket = MarketParams & {
  id: Hex;
  hubChainId: TelaranaHubChainId;
  hubName: TelaranaHubName;
  isLive: boolean;
  state?: MorphoMarketState;
};

export type AccountPosition = MorphoPositionState & {
  id: string;
  marketId: Hex;
  hubChainId: TelaranaHubChainId;
  account: Address;
  supplyAssets: bigint;
  borrowAssets: bigint;
  collateralPriceE36: bigint | null;
  oraclePublishedAt: bigint | null;
  healthFactorE18: bigint | null;
  liquidatable: boolean;
};

export type OracleQuote = {
  midE18: bigint;
  publishedAt: bigint;
};

export type BorrowQuote = {
  market: LendingMarket;
  collateral: bigint;
  borrowAmount: bigint;
  borrowAssetsAfter: bigint;
  healthFactorE18: bigint;
  liquidatable: boolean;
  maxBorrowAssets: bigint;
  oracle?: OracleQuote;
};

export type { TelaranaHubChainId, TelaranaHubName };
