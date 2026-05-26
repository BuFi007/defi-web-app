import { indexer } from "envio";

import { getOrCreateDailyMarketSnapshot } from "./snapshot";

const GLOBAL_VAULT_MARKET_ID = "turbo-vault";

indexer.onEvent(
  { contract: "TurboFeeVault", event: "FeeDeposited" },
  async ({ event, context }) => {
    context.TurboFeeVaultEvent.set({
      id: `${event.chainId}_${event.transaction.hash}_${event.logIndex}`,
      eventType: "fee_deposited",
      marketId: event.params.marketId,
      user: "",
      token: event.params.token,
      amount: event.params.amount,
      protocolShare: event.params.protocolShare,
      lpShare: event.params.lpShare,
      insuranceShare: event.params.insuranceShare,
      assets: 0n,
      shares: 0n,
      reason: "",
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });

    const snap = await getOrCreateDailyMarketSnapshot(
      context,
      event.params.marketId,
      event.block.timestamp,
      event.chainId,
    );

    context.DailyMarketSnapshot.set({
      ...snap,
      turboFeeAmount: snap.turboFeeAmount + event.params.amount,
      turboProtocolShare: snap.turboProtocolShare + event.params.protocolShare,
      turboLpShare: snap.turboLpShare + event.params.lpShare,
      turboInsuranceShare: snap.turboInsuranceShare + event.params.insuranceShare,
    });
  },
);

indexer.onEvent(
  { contract: "TurboFeeVault", event: "Deposited" },
  async ({ event, context }) => {
    context.TurboFeeVaultEvent.set({
      id: `${event.chainId}_${event.transaction.hash}_${event.logIndex}`,
      eventType: "lp_deposited",
      marketId: GLOBAL_VAULT_MARKET_ID,
      user: event.params.user,
      token: "",
      amount: event.params.assets,
      protocolShare: 0n,
      lpShare: 0n,
      insuranceShare: 0n,
      assets: event.params.assets,
      shares: event.params.shares,
      reason: "",
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });

    const snap = await getOrCreateDailyMarketSnapshot(
      context,
      GLOBAL_VAULT_MARKET_ID,
      event.block.timestamp,
      event.chainId,
    );

    context.DailyMarketSnapshot.set({
      ...snap,
      lpDepositEvents: snap.lpDepositEvents + 1,
    });
  },
);

indexer.onEvent(
  { contract: "TurboFeeVault", event: "Withdrawn" },
  async ({ event, context }) => {
    context.TurboFeeVaultEvent.set({
      id: `${event.chainId}_${event.transaction.hash}_${event.logIndex}`,
      eventType: "lp_withdrawn",
      marketId: GLOBAL_VAULT_MARKET_ID,
      user: event.params.user,
      token: "",
      amount: event.params.assets,
      protocolShare: 0n,
      lpShare: 0n,
      insuranceShare: 0n,
      assets: event.params.assets,
      shares: event.params.shares,
      reason: "",
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });

    const snap = await getOrCreateDailyMarketSnapshot(
      context,
      GLOBAL_VAULT_MARKET_ID,
      event.block.timestamp,
      event.chainId,
    );

    context.DailyMarketSnapshot.set({
      ...snap,
      lpWithdrawEvents: snap.lpWithdrawEvents + 1,
    });
  },
);

indexer.onEvent(
  { contract: "TurboFeeVault", event: "YieldClaimed" },
  async ({ event, context }) => {
    context.TurboFeeVaultEvent.set({
      id: `${event.chainId}_${event.transaction.hash}_${event.logIndex}`,
      eventType: "yield_claimed",
      marketId: GLOBAL_VAULT_MARKET_ID,
      user: event.params.user,
      token: "",
      amount: event.params.amount,
      protocolShare: 0n,
      lpShare: 0n,
      insuranceShare: 0n,
      assets: 0n,
      shares: 0n,
      reason: "",
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });

    const snap = await getOrCreateDailyMarketSnapshot(
      context,
      GLOBAL_VAULT_MARKET_ID,
      event.block.timestamp,
      event.chainId,
    );

    context.DailyMarketSnapshot.set({
      ...snap,
      yieldClaimed: snap.yieldClaimed + event.params.amount,
    });
  },
);

indexer.onEvent(
  { contract: "TurboFeeVault", event: "InsurancePayout" },
  async ({ event, context }) => {
    context.TurboFeeVaultEvent.set({
      id: `${event.chainId}_${event.transaction.hash}_${event.logIndex}`,
      eventType: "insurance_payout",
      marketId: event.params.marketId,
      user: "",
      token: "",
      amount: event.params.amount,
      protocolShare: 0n,
      lpShare: 0n,
      insuranceShare: 0n,
      assets: 0n,
      shares: 0n,
      reason: event.params.reason,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
      chainId: event.chainId,
    });

    const snap = await getOrCreateDailyMarketSnapshot(
      context,
      event.params.marketId,
      event.block.timestamp,
      event.chainId,
    );

    context.DailyMarketSnapshot.set({
      ...snap,
      insurancePayouts: snap.insurancePayouts + event.params.amount,
    });
  },
);
