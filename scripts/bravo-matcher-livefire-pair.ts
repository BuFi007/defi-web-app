// BRAVO.1 — Pair a maker (LIMIT) + taker (MARKET) on the same market
// to force a fill that the matcher will settle on Arc via settleMatch.

import { spawnSync } from "node:child_process";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, type Hex } from "viem";

const ARC_RPC = "https://rpc.testnet.arc.network";
const MATCHER_HOST = "127.0.0.1:3005";
const PROTO_DIR = "/Users/criptopoeta/coding-dojo/defi-web-app/services/matcher/proto";
const PROTO = "matcher.v1.proto";
const MARKET_ID: Hex = "0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8";
const VERIFYING_CONTRACT = "0x0F62FCdA2de63d905Cb167301C00251A9bB6dAa1";
const CHAIN_ID = 5042002;
const E18 = 1_000_000_000_000_000_000n;

function toBytes32(n: bigint, signed = false): Hex {
  let v = n;
  if (signed && n < 0n) v = (1n << 256n) + n;
  return ("0x" + v.toString(16).padStart(64, "0")) as Hex;
}
function base64FromHex(hex: string): string {
  return Buffer.from(hex.replace(/^0x/, ""), "hex").toString("base64");
}

async function submit(pk: Hex, side: "long" | "short", orderType: "market" | "limit", priceE18: bigint, sizeE18: bigint, tag: string) {
  const account = privateKeyToAccount(pk);
  const sizeDelta = side === "long" ? sizeE18 : -sizeE18;
  const nonceU64 = BigInt(Date.now() & 0xff);
  const deadlineU64 = BigInt(Math.floor(Date.now() / 1000) + 600);
  const ot = orderType === "market" ? 0 : 1;
  const flags = 0;
  const typedData = {
    domain: { name: "TelaranaFxOrderSettlement", version: "1", chainId: CHAIN_ID, verifyingContract: VERIFYING_CONTRACT as Hex },
    types: { SignedOrder: [
      { name: "trader", type: "address" }, { name: "marketId", type: "bytes32" },
      { name: "sizeDeltaE18", type: "int256" }, { name: "priceE18", type: "uint256" },
      { name: "maxFee", type: "uint256" }, { name: "orderType", type: "uint8" },
      { name: "flags", type: "uint8" }, { name: "nonce", type: "uint64" }, { name: "deadline", type: "uint64" },
    ]},
    primaryType: "SignedOrder" as const,
    message: { trader: account.address as Hex, marketId: MARKET_ID, sizeDeltaE18: sizeDelta, priceE18, maxFee: 0n, orderType: ot, flags, nonce: nonceU64, deadline: deadlineU64 },
  };
  const signature = await account.signTypedData(typedData);
  const wire = {
    trader: base64FromHex(account.address), market_id: base64FromHex(MARKET_ID),
    size_delta_e18: base64FromHex(toBytes32(sizeDelta, true)), price_e18: base64FromHex(toBytes32(priceE18)),
    max_fee: base64FromHex(toBytes32(0n)), order_type: ot === 0 ? "ORDER_TYPE_MARKET" : "ORDER_TYPE_LIMIT",
    flags: 0, nonce: nonceU64.toString(), deadline_secs: deadlineU64.toString(),
    signature: base64FromHex(signature), tif: "TIF_GTC", client_tag: tag,
  };
  console.log(`[bravo:${tag}] trader=${account.address} side=${side} type=${orderType} price=${priceE18} size=${sizeE18}`);
  const res = spawnSync("grpcurl", ["-plaintext", "-import-path", PROTO_DIR, "-proto", PROTO, "-d", JSON.stringify(wire), MATCHER_HOST, "matcher.v1.Matcher/SubmitOrder"], { encoding: "utf8" });
  console.log(`[bravo:${tag}] stdout=${res.stdout}`);
  console.log(`[bravo:${tag}] stderr=${res.stderr}`);
  return res;
}

const maker = process.env.PERP_KEEPER_PRIVATE_KEY ?? process.env.LP_OPERATOR_PRIVATE_KEY ?? process.env.CANARY_TRADER_PRIVATE_KEY;
const taker = process.env.CANARY_TRADER_PRIVATE_KEY;
if (!maker || !taker) { console.error("need MAKER + TAKER pks"); process.exit(1); }

// Get current oracle mid for EURC ≈ 1.16e18. We post a maker LIMIT short
// (sell) at 1.16 and a taker MARKET long (buy) which crosses it.
const refPrice = 1_161_000_000_000_000_000n; // ≈1.161 USDC/EURC

const r1 = await submit(maker as Hex, "short", "limit", refPrice, E18 / 100n, "maker-limit-short");
await new Promise(r => setTimeout(r, 3000));
const r2 = await submit(taker as Hex, "long", "market", 0n, E18 / 100n, "taker-market-long");

await new Promise(r => setTimeout(r, 4000));
console.log("[bravo] metrics after trade:");
const m = spawnSync("curl", ["-s", "http://127.0.0.1:3006/metrics"], { encoding: "utf8" });
const lines = m.stdout.split("\n").filter(l => l.match(/fill|settle|tick_age|match_seq/));
console.log(lines.join("\n"));
