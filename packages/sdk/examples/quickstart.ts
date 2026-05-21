/**
 * @bufi/sdk quickstart — open a 5x long on EURC/USDC.
 *
 * Run with:
 *   PRIVATE_KEY=0x… BUFI_API_URL=http://localhost:3002 \
 *     bun run examples/quickstart.ts
 *
 * Compile-check with:
 *   bun run check:example
 */

// In a consumer project, replace this with: import { … } from "@bufi/sdk";
// Inside this monorepo, the relative path keeps the example
// type-checkable without a workspace link step.
import {
  ARC_PERP_MARKETS,
  arcTestnet,
  closePerp,
  createBufiClient,
  getMarketStats,
  getMarkets,
  getPositions,
  openPerp,
} from "../src";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";

async function main(): Promise<void> {
  const bufi = createBufiClient({
    apiUrl: process.env.BUFI_API_URL ?? "https://api.bu.finance",
    chainId: 5042002,
  });

  // 1. Read-side: list markets + stats.
  const { markets } = await getMarkets(bufi);
  console.log("markets:", markets.map((m) => m.symbol));

  const stats = await getMarketStats(bufi, "EURC_USDC");
  console.log("EURC/USDC mark:", stats.markPrice);

  // 2. Open a position. Needs a private key in env.
  if (!process.env.PRIVATE_KEY) {
    console.log("(set PRIVATE_KEY to also exercise the write path)");
    return;
  }

  const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(),
  });

  const { intentId, status, quote } = await openPerp(bufi, {
    marketId: ARC_PERP_MARKETS["EURC/USDC"].marketId,
    side: "long",
    sizeUsdc: "10",
    leverage: 5,
    walletClient,
  });
  console.log("openPerp:", { intentId, status, fee: quote.fee, markPrice: quote.markPrice });

  // 3. Inspect open positions.
  const { positions } = await getPositions(bufi, account.address);
  console.log("positions:", positions.length);

  // 4. Close everything.
  if (positions.length > 0) {
    const close = await closePerp(bufi, {
      marketId: ARC_PERP_MARKETS["EURC/USDC"].marketId,
      walletClient,
    });
    console.log("closePerp:", { intentId: close.intentId, status: close.status });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
