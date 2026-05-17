import {
  FxHealthCheckerAbi,
  FxLiquidationEngineAbi,
  FxPerpClearinghouseAbi,
  loadContracts,
} from "@bufi/contracts";
import { createTradingMachineDbFromEnv } from "@bufi/db";
import { createKeeperWalletClient, requireKeeperSigner, runKeeper } from "@bufi/keeper-runtime";

const ARC_CHAIN_ID = 5042002;
const db = createTradingMachineDbFromEnv();

await runKeeper({
  name: "@bufi/keeper-perps-liquidator",
  async tick(ctx) {
    requireKeeperSigner(ctx);
    const contracts = loadContracts()[ARC_CHAIN_ID];
    const healthChecker = contracts.perps.healthChecker;
    const liquidationEngine = contracts.perps.liquidationEngine;
    const clearinghouse = contracts.perps.clearinghouse;
    if (!healthChecker || !liquidationEngine || !clearinghouse) {
      ctx.log.warn("perps_liquidator.not_configured", {
        missing: {
          healthChecker: !healthChecker,
          liquidationEngine: !liquidationEngine,
          clearinghouse: !clearinghouse,
        },
      });
      return;
    }

    const wallet = createKeeperWalletClient(ctx, "arc");
    const accounts = await knownAccounts();
    const liquidations: Array<{ marketId: string; trader: string; flagTx: string; liquidateTx: string }> = [];
    for (const account of accounts) {
      const liquidatable = await ctx.clients.arc.readContract({
        address: healthChecker,
        abi: FxHealthCheckerAbi,
        functionName: "isLiquidatable",
        args: [account.marketId as `0x${string}`, account.trader as `0x${string}`],
      });
      if (!liquidatable) continue;
      const position = await ctx.clients.arc.readContract({
        address: clearinghouse,
        abi: FxPerpClearinghouseAbi,
        functionName: "position",
        args: [account.marketId as `0x${string}`, account.trader as `0x${string}`],
      });
      const maxClose = abs(positionSize(position));
      if (maxClose === 0n) continue;
      const hash = await wallet.writeContract({
        chain: null,
        account: wallet.account!,
        address: liquidationEngine,
        abi: FxLiquidationEngineAbi,
        functionName: "flagAccount",
        args: [account.marketId as `0x${string}`, account.trader as `0x${string}`],
      });
      const liquidateHash = await wallet.writeContract({
        chain: null,
        account: wallet.account!,
        address: liquidationEngine,
        abi: FxLiquidationEngineAbi,
        functionName: "liquidate",
        args: [account.marketId as `0x${string}`, account.trader as `0x${string}`, maxClose],
      });
      liquidations.push({ ...account, flagTx: hash, liquidateTx: liquidateHash });
    }

    ctx.log.info("perps_liquidator.scan", {
      scanned: accounts.length,
      liquidations,
    });
  },
});

async function knownAccounts(): Promise<Array<{ marketId: string; trader: string }>> {
  const intents = await db.perpsIntents.list();
  const seen = new Set<string>();
  const accounts: Array<{ marketId: string; trader: string }> = [];
  for (const intent of intents) {
    if (intent.chainId !== ARC_CHAIN_ID) continue;
    if (intent.status === "rejected" || intent.status === "expired") continue;
    const key = `${intent.marketId.toLowerCase()}:${intent.trader.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accounts.push({ marketId: intent.marketId, trader: intent.trader });
  }
  return accounts;
}

function positionSize(position: readonly unknown[] | { sizeE18?: bigint }): bigint {
  if (Array.isArray(position)) return position[0] as bigint;
  return (position as { sizeE18?: bigint }).sizeE18 ?? 0n;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
