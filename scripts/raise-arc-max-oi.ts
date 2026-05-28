#!/usr/bin/env bun
/**
 * One-shot admin script — raise the on-chain maxOpenInterestUsd cap on
 * Arc Testnet so the matcher tick loop can actually settle fills.
 *
 * BRAVO iter-2 finding:
 *   FxPerpClearinghouse stores maxOpenInterestUsd as 6-decimal USDC
 *   quantums (e.g. 1_000_000_000 = 1000 USDC), but the OI gate compares
 *   against 18-decimal WAD values. Result: every settlement attempt
 *   fired "OI gate blocked; leaving intents pending" and 0 fills landed
 *   across 13+ hours of uptime.
 *
 * Workaround for dogfooding: scale each existing cap by 1e12 so the
 * comparison matches the 18-dec WAD the matcher sends. Long-term fix is
 * on the contract side (either store in WAD or scale inside the gate),
 * tracked separately — this script is only for the testnet dogfood path.
 *
 * Reads DEPLOYER_PRIVATE_KEY (falls back to KEEPER_PRIVATE_KEY, then
 * PERP_KEEPER_PRIVATE_KEY) from .env.local. Never logs the key.
 *
 * Usage:
 *   cd /Users/criptopoeta/coding-dojo/defi-web-app
 *   bun run scripts/raise-arc-max-oi.ts            # raises by 1e12 scale
 *   bun run scripts/raise-arc-max-oi.ts --dry-run  # read current configs only
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DRY_RUN = process.argv.includes("--dry-run");

const RPC_URL = process.env.ARC_RPC_URL ?? "https://rpc.drpc.testnet.arc.network";
const KEY_HEX =
  process.env.DEPLOYER_PRIVATE_KEY ??
  process.env.KEEPER_PRIVATE_KEY ??
  process.env.PERP_KEEPER_PRIVATE_KEY;

if (!KEY_HEX && !DRY_RUN) {
  console.error(
    "❌ Need DEPLOYER_PRIVATE_KEY (or KEEPER_PRIVATE_KEY / PERP_KEEPER_PRIVATE_KEY) in env. Source .env.local first.",
  );
  process.exit(1);
}

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  testnet: true,
});

// FxPerpClearinghouse address on Arc Testnet — Sprint-1 broadcast
// (canonical address from packages/contracts/src/index.ts)
const CLEARINGHOUSE = "0x39dc43E2133CF860c1d17d4DB75Ef4204eebD46A" as Address;

// All live perp markets on Arc (TCHFC excluded per asset-rules: tCHFC
// fully removed). Sourced from perps-config-5042002.json.
const MARKETS: { name: string; id: `0x${string}` }[] = [
  {
    name: "EURC/USDC",
    id: "0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8",
  },
  {
    name: "JPYC/USDC",
    id: "0x9ccad283db415085bf69329b696bfc7a34bff2d476f5cf7b1d4a3ba9bc0b70ab",
  },
  {
    name: "MXNB/USDC",
    id: "0xb698dfdbcbae088741081a53b9f1da11df8ff7c92c9278b66e15a34077ea5ca3",
  },
  {
    name: "cirBTC/USDC",
    id: "0x238aacf17c8d170ad55905cd1c217ae2db8338354b1235059fb0f096e20b777a",
  },
  {
    name: "AUDF/USDC",
    id: "0x921b564f97b14b7d73c12a72af4b7847fb5e3414f98cbe5fb5f1d8a3168c0a00",
  },
];

const ABI = [
  {
    name: "marketConfig",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "baseToken", type: "address" },
          { name: "enabled", type: "bool" },
          { name: "initialMarginBps", type: "uint16" },
          { name: "maintenanceMarginBps", type: "uint16" },
          { name: "tradingFeeBps", type: "uint16" },
          { name: "maxLeverageBps", type: "uint32" },
          { name: "maxOpenInterestUsd", type: "uint256" },
          { name: "maxSkewUsd", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "configureMarket",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      {
        name: "config",
        type: "tuple",
        components: [
          { name: "baseToken", type: "address" },
          { name: "enabled", type: "bool" },
          { name: "initialMarginBps", type: "uint16" },
          { name: "maintenanceMarginBps", type: "uint16" },
          { name: "tradingFeeBps", type: "uint16" },
          { name: "maxLeverageBps", type: "uint32" },
          { name: "maxOpenInterestUsd", type: "uint256" },
          { name: "maxSkewUsd", type: "uint256" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

const SCALE = 1_000_000_000_000n; // 1e12

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(RPC_URL),
});

const account = KEY_HEX
  ? privateKeyToAccount(
      `0x${KEY_HEX.replace(/^0x/, "")}` as `0x${string}`,
    )
  : null;
const walletClient =
  account && !DRY_RUN
    ? createWalletClient({
        account,
        chain: arcTestnet,
        transport: http(RPC_URL),
      })
    : null;

if (account) {
  console.log(`Signer:        ${account.address}`);
}
console.log(`Clearinghouse: ${CLEARINGHOUSE}`);
console.log(`Mode:          ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
console.log("");

for (const market of MARKETS) {
  try {
    const current = (await publicClient.readContract({
      address: CLEARINGHOUSE,
      abi: ABI,
      functionName: "marketConfig",
      args: [market.id],
    })) as {
      baseToken: Address;
      enabled: boolean;
      initialMarginBps: number;
      maintenanceMarginBps: number;
      tradingFeeBps: number;
      maxLeverageBps: number;
      maxOpenInterestUsd: bigint;
      maxSkewUsd: bigint;
    };

    const nextMaxOi = current.maxOpenInterestUsd * SCALE;
    const nextMaxSkew = current.maxSkewUsd * SCALE;

    console.log(`── ${market.name} (${market.id.slice(0, 10)}…)`);
    console.log(`   enabled:         ${current.enabled}`);
    console.log(`   current maxOI:   ${current.maxOpenInterestUsd.toString()}`);
    console.log(`   next maxOI:      ${nextMaxOi.toString()}  (×1e12)`);
    console.log(`   current maxSkew: ${current.maxSkewUsd.toString()}`);
    console.log(`   next maxSkew:    ${nextMaxSkew.toString()}  (×1e12)`);

    if (DRY_RUN) {
      console.log("   (dry-run, no tx)");
      console.log("");
      continue;
    }

    if (!walletClient) {
      throw new Error("walletClient missing (key not loaded)");
    }

    const hash = await walletClient.writeContract({
      address: CLEARINGHOUSE,
      abi: ABI,
      functionName: "configureMarket",
      args: [
        market.id,
        {
          baseToken: current.baseToken,
          enabled: current.enabled,
          initialMarginBps: current.initialMarginBps,
          maintenanceMarginBps: current.maintenanceMarginBps,
          tradingFeeBps: current.tradingFeeBps,
          maxLeverageBps: current.maxLeverageBps,
          maxOpenInterestUsd: nextMaxOi,
          maxSkewUsd: nextMaxSkew,
        },
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`   tx:              ${hash}`);
    console.log(`   block:           ${receipt.blockNumber} (${receipt.status})`);
    console.log("");
  } catch (err) {
    console.error(`   ✗ failed: ${(err as Error).message}`);
    console.log("");
  }
}

console.log("Done.");
