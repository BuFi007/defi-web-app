/**
 * Place + replace a limit order on EURC/USDC.
 */

// In a consumer project: import { … } from "@bufi/sdk";
import {
  ARC_PERP_MARKETS,
  arcTestnet,
  createBufiClient,
  getMarkPrice,
  placeLimitOrder,
} from "../src";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";

async function main(): Promise<void> {
  const bufi = createBufiClient({
    apiUrl: process.env.BUFI_API_URL ?? "https://api.bu.finance",
    chainId: 5042002,
  });

  const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(),
  });

  const market = ARC_PERP_MARKETS["EURC/USDC"];
  const { price } = await getMarkPrice(bufi, market.marketId);
  // Place a buy 1% below mark.
  const limitDecimal = (Number(price) * 0.99).toFixed(6);
  const priceE18 = BigInt(Math.floor(Number(limitDecimal) * 1e18)).toString();

  const { intentId, status } = await placeLimitOrder(bufi, {
    marketId: market.marketId,
    side: "long",
    sizeUsdc: "50",
    leverage: 3,
    priceE18,
    walletClient,
  });
  console.log("placeLimitOrder:", { intentId, status, limitDecimal });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
