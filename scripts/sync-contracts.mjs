#!/usr/bin/env bun
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "packages/contracts/src/abis");

const files = [
  ["../BUFX/packages/sdk/src/abis/BuFxVenueRequestRouter.ts", "BuFxVenueRequestRouter.ts"],
  ["../BUFX/packages/sdk/src/abis/BuFxTelaranaRequestRouter.ts", "BuFxTelaranaRequestRouter.ts"],
  ["../BUFX/packages/sdk/src/abis/BuFxFeeConfig.ts", "BuFxFeeConfig.ts"],
  ["../BUFX/packages/sdk/src/abis/BuFxFeeCollector.ts", "BuFxFeeCollector.ts"],
  ["../BUFX/packages/sdk/src/abis/FxSpotExecutor.ts", "FxSpotExecutor.ts"],
  ["../fx-telarana/packages/sdk/src/abis/FxOracle.ts", "FxOracle.ts"],
  ["../fx-telarana/packages/sdk/src/abis/FxMarketRegistry.ts", "FxMarketRegistry.ts"],
  ["../fx-telarana/packages/sdk/src/abis/FxReceipt.ts", "FxReceipt.ts"],
  ["../fx-telarana/packages/sdk/src/abis/FxHubMessageReceiver.ts", "FxHubMessageReceiver.ts"],
  ["../fx-telarana/packages/sdk/src/abis/FxLiquidator.ts", "FxLiquidator.ts"],
  ["../fx-telarana/packages/sdk/src/abis/TelaranaGatewayHubHook.ts", "TelaranaGatewayHubHook.ts"],
];

mkdirSync(out, { recursive: true });
for (const [from, to] of files) {
  copyFileSync(resolve(root, from), resolve(out, to));
  console.log(`synced ${to}`);
}
