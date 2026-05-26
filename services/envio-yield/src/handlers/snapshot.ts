export function dayFromTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function emptyDailyMarketSnapshot(input: {
  id: string;
  marketId: string;
  date: string;
  chainId: number;
}) {
  return {
    id: input.id,
    marketId: input.marketId,
    date: input.date,
    chainId: input.chainId,
    perpVolume: 0n,
    perpFees: 0n,
    perpTradeCount: 0,
    spotVolume: 0n,
    spotTradeCount: 0,
    totalSupply: 0n,
    totalBorrow: 0n,
    supplyEvents: 0,
    borrowEvents: 0,
    turboFeeAmount: 0n,
    turboProtocolShare: 0n,
    turboLpShare: 0n,
    turboInsuranceShare: 0n,
    lpDepositEvents: 0,
    lpWithdrawEvents: 0,
    yieldClaimed: 0n,
    insurancePayouts: 0n,
    lastFundingRate: 0n,
    cumulativeFundingE18: 0n,
    morphoBaseApy: 0n,
    feeBoostApy: 0n,
    compositeApy: 0n,
    annualizedFeeApy: 0n,
  };
}

export async function getOrCreateDailyMarketSnapshot(context: any, marketId: string, timestamp: number, chainId: number) {
  const date = dayFromTimestamp(timestamp);
  const id = `${chainId}_${marketId}_${date}`;
  const existing = await context.DailyMarketSnapshot.get(id);
  return existing ?? emptyDailyMarketSnapshot({ id, marketId, date, chainId });
}
