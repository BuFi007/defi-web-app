// BRAVO.1 — Submit a synthetic SignedOrder to the live matcher gRPC
// (127.0.0.1:3005) for the EURC/USDC market, then poll the chain for
// the matching settleMatch tx. Runs against the already-running
// matcher; does NOT spawn a sidecar.
//
// Usage: BUFI_CANARY_TRADER_PRIVATE_KEY=0x... bun scripts/bravo-matcher-livefire.ts

import { spawnSync } from "node:child_process";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, keccak256, encodePacked, type Hex } from "viem";

const ARC_RPC = "https://rpc.drpc.testnet.arc.network";
const MATCHER_HOST = "127.0.0.1:3005";
const PROTO_DIR = "/Users/criptopoeta/coding-dojo/defi-web-app/services/matcher/proto";
const PROTO = "matcher.v1.proto";

// EURC/USDC market — only one in MATCHER_FUNDING_MARKET_IDS so it has
// fresh oracle pushes.
const MARKET_ID: Hex = "0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8";
const VERIFYING_CONTRACT = "0x0F62FCdA2de63d905Cb167301C00251A9bB6dAa1"; // FxOrderSettlement on Arc
const CHAIN_ID = 5042002;

const pk = (process.env.BUFI_CANARY_TRADER_PRIVATE_KEY ??
  process.env.CANARY_TRADER_PRIVATE_KEY) as Hex | undefined;
if (!pk) {
  console.error("set CANARY_TRADER_PRIVATE_KEY or BUFI_CANARY_TRADER_PRIVATE_KEY");
  process.exit(1);
}

const account = privateKeyToAccount(pk);

const E18 = 1_000_000_000_000_000_000n;
const sizeDeltaE18 = E18 / 100n;  // 0.01 EURC long, tiny
const priceE18 = 0n;              // MARKET order → ignored
const maxFee = 0n;
const orderType = 0;              // MARKET
const flags = 0;
const nonceU64 = BigInt(Date.now()) & 0xffn; // permit2 bitmap-idx; per-trader rolling
const deadlineU64 = BigInt(Math.floor(Date.now() / 1000) + 600);

function toBytes32(n: bigint, signed = false): Hex {
  let v = n;
  if (signed && n < 0n) {
    v = (1n << 256n) + n;
  }
  return ("0x" + v.toString(16).padStart(64, "0")) as Hex;
}

function base64FromHex(hex: string): string {
  const buf = Buffer.from(hex.replace(/^0x/, ""), "hex");
  return buf.toString("base64");
}

const traderAddrPad20 = account.address.toLowerCase() as Hex;

const typedData = {
  domain: {
    name: "TelaranaFxOrderSettlement",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: VERIFYING_CONTRACT as Hex,
  },
  types: {
    SignedOrder: [
      { name: "trader", type: "address" },
      { name: "marketId", type: "bytes32" },
      { name: "sizeDeltaE18", type: "int256" },
      { name: "priceE18", type: "uint256" },
      { name: "maxFee", type: "uint256" },
      { name: "orderType", type: "uint8" },
      { name: "flags", type: "uint8" },
      { name: "nonce", type: "uint64" },
      { name: "deadline", type: "uint64" },
    ],
  },
  primaryType: "SignedOrder" as const,
  message: {
    trader: traderAddrPad20,
    marketId: MARKET_ID,
    sizeDeltaE18: sizeDeltaE18,
    priceE18: priceE18,
    maxFee: maxFee,
    orderType: orderType,
    flags: flags,
    nonce: nonceU64,
    deadline: deadlineU64,
  },
};

console.log("[bravo] trader=", account.address);
console.log("[bravo] marketId=", MARKET_ID);
console.log("[bravo] sizeDeltaE18=", sizeDeltaE18.toString());
console.log("[bravo] nonce=", nonceU64.toString(), "deadline=", deadlineU64.toString());

const signature = await account.signTypedData(typedData);
console.log("[bravo] signature=", signature);

// Build the proto3 JSON wire form. `bytes` fields must be base64.
// `bytes` field carrying address: must be 20 raw bytes per parse_and_verify().
const wire = {
  trader: base64FromHex(traderAddrPad20),
  market_id: base64FromHex(MARKET_ID),
  size_delta_e18: base64FromHex(toBytes32(sizeDeltaE18, true)),
  price_e18: base64FromHex(toBytes32(priceE18)),
  max_fee: base64FromHex(toBytes32(maxFee)),
  order_type: orderType === 0 ? "ORDER_TYPE_MARKET" : "ORDER_TYPE_LIMIT",
  flags: flags,
  nonce: nonceU64.toString(),
  deadline_secs: deadlineU64.toString(),
  signature: base64FromHex(signature),
  // matcher-only fields not part of EIP-712 hash:
  tif: "TIF_IOC",
  client_tag: `bravo-livefire-${Date.now()}`,
};

const payload = JSON.stringify(wire);
console.log("[bravo] payload=", payload);

const before = Date.now();
const res = spawnSync(
  "grpcurl",
  [
    "-plaintext",
    "-import-path", PROTO_DIR,
    "-proto", PROTO,
    "-d", payload,
    MATCHER_HOST,
    "matcher.v1.Matcher/SubmitOrder",
  ],
  { encoding: "utf8" },
);

console.log("[bravo] elapsed_ms=", Date.now() - before);
console.log("[bravo] stdout=", res.stdout);
console.log("[bravo] stderr=", res.stderr);
console.log("[bravo] exit=", res.status);

// Now poll the chain for a fresh settleMatch tx from the matcher keeper EOA.
const client = createPublicClient({ transport: http(ARC_RPC) });
const KEEPER = "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69" as Hex;
const latestBlock = await client.getBlockNumber();
console.log("[bravo] latest arc block=", latestBlock.toString());

process.exit(res.status ?? 0);
