import {
  FxHealthCheckerAbi,
  FxLiquidationEngineAbi,
  FxPerpClearinghouseAbi,
  loadContracts,
} from "@bufi/contracts";
import { createTradingMachineDbFromEnv } from "@bufi/db";
import {
  createKeeperWalletClient,
  postPublish,
  requireKeeperSigner,
  runKeeper,
} from "@bufi/keeper-runtime";
import { mapAccountLiquidatedToPublish } from "@bufi/keeper-runtime/publish-mappers";
import { withSpan } from "@bufi/observability";
import { decodeEventLog, type Hex } from "viem";

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
    const accounts = await withSpan(
      "perps.liquidator.candidate-scan",
      () => knownAccounts(),
      { "liquidator.chain_id": ARC_CHAIN_ID },
      "keeper.perps-liquidator",
    );
    const liquidations: Array<{ marketId: string; trader: string; flagTx: string; liquidateTx: string }> = [];
    for (const account of accounts) {
      const { flagTx, liquidateTx } = await withSpan(
        "perps.liquidator.attempt",
        async (span) => {
          const liquidatable = await ctx.clients.arc.readContract({
            address: healthChecker,
            abi: FxHealthCheckerAbi,
            functionName: "isLiquidatable",
            args: [account.marketId as `0x${string}`, account.trader as `0x${string}`],
          });
          if (!liquidatable) {
            span.setAttribute("liquidator.skipped", "not_liquidatable");
            return { flagTx: null, liquidateTx: null };
          }
          const position = await ctx.clients.arc.readContract({
            address: clearinghouse,
            abi: FxPerpClearinghouseAbi,
            functionName: "position",
            args: [account.marketId as `0x${string}`, account.trader as `0x${string}`],
          });
          const maxClose = abs(positionSize(position));
          if (maxClose === 0n) {
            span.setAttribute("liquidator.skipped", "zero_size");
            return { flagTx: null, liquidateTx: null };
          }
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
          span.setAttribute("liquidator.max_close", maxClose.toString());

          // Wait for the liquidate receipt + publish analytics post-confirm.
          // Wrapped in its own try/catch so a publish-side failure can't take
          // down a successful on-chain liquidation — we still return the
          // hashes so the outer logger records the liquidation.
          try {
            const receipt = await ctx.clients.arc.waitForTransactionReceipt({
              hash: liquidateHash,
            });
            if (receipt.status === "success") {
              const decoded = decodeAccountLiquidatedFromReceipt({
                logs: receipt.logs,
                liquidationEngine,
                marketId: account.marketId as Hex,
                trader: account.trader as Hex,
              });
              if (decoded) {
                void postPublish(
                  mapAccountLiquidatedToPublish(decoded.args, {
                    txHash: liquidateHash,
                    blockNumber: receipt.blockNumber,
                    logIndex: decoded.logIndex,
                  }),
                ).catch((err) => {
                  ctx.log.warn("perps_liquidator.publish_failed", {
                    error: (err as Error).message,
                    tx: liquidateHash,
                  });
                });
              } else {
                ctx.log.warn("perps_liquidator.no_event_in_receipt", {
                  marketId: account.marketId,
                  trader: account.trader,
                  tx: liquidateHash,
                });
              }
            } else {
              ctx.log.warn("perps_liquidator.liquidate_reverted", {
                marketId: account.marketId,
                trader: account.trader,
                tx: liquidateHash,
              });
            }
          } catch (publishErr) {
            ctx.log.warn("perps_liquidator.post_receipt_failed", {
              marketId: account.marketId,
              trader: account.trader,
              tx: liquidateHash,
              error: (publishErr as Error).message,
            });
          }

          return { flagTx: hash, liquidateTx: liquidateHash };
        },
        {
          "liquidator.market_id": account.marketId,
          "liquidator.trader": account.trader,
          "liquidator.chain_id": ARC_CHAIN_ID,
        },
        "keeper.perps-liquidator",
      );
      if (flagTx && liquidateTx) {
        liquidations.push({ ...account, flagTx, liquidateTx });
      }
    }

    // Skip the per-tick scan log when nothing happened — the empty
    // {scanned: 0, liquidations: []} line floods dev:complete every
    // pollMs. Log only when there's real activity OR a non-zero scan
    // (i.e. we actually had candidates to check).
    if (accounts.length > 0 || liquidations.length > 0) {
      ctx.log.info("perps_liquidator.scan", {
        scanned: accounts.length,
        liquidations,
      });
    }
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

// Walk a receipt's logs for the AccountLiquidated event matching
// (marketId, trader) emitted by the liquidationEngine contract. Decoded
// args carry raw bigint reward/socializedLoss; the mapper stringifies for
// transport. Returns the log index within the receipt so the downstream
// Tinybird dedupe key `${txHash}-${logIndex}` is stable across retries.
function decodeAccountLiquidatedFromReceipt(args: {
  logs: ReadonlyArray<{ address: `0x${string}`; topics: readonly `0x${string}`[]; data: `0x${string}` }>;
  liquidationEngine: `0x${string}`;
  marketId: Hex;
  trader: Hex;
}): {
  args: {
    marketId: `0x${string}`;
    trader: `0x${string}`;
    liquidator: `0x${string}`;
    reward: bigint;
    socializedLoss: bigint;
  };
  logIndex: number;
} | null {
  const targetEngine = args.liquidationEngine.toLowerCase();
  for (let i = 0; i < args.logs.length; i += 1) {
    const log = args.logs[i]!;
    if (log.address.toLowerCase() !== targetEngine) continue;
    try {
      const decoded = decodeEventLog({
        abi: FxLiquidationEngineAbi,
        eventName: "AccountLiquidated",
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      const decodedArgs = decoded.args as {
        marketId: `0x${string}`;
        trader: `0x${string}`;
        liquidator: `0x${string}`;
        reward: bigint;
        socializedLoss: bigint;
      };
      if (
        decodedArgs.marketId.toLowerCase() !== args.marketId.toLowerCase() ||
        decodedArgs.trader.toLowerCase() !== args.trader.toLowerCase()
      ) {
        continue;
      }
      return { args: decodedArgs, logIndex: i };
    } catch {
      // Not an AccountLiquidated log; continue scanning.
    }
  }
  return null;
}
