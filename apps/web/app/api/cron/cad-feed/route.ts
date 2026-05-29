import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

// CAD/USD oracle keeper. QCAD has NO first-party on-chain price feed on Arc
// (Pyth's on-chain Arc deployment returns PriceFeedNotFound for USD/CAD, and
// there is no Chainlink/RedStone there). FxOracleV2 prices the QCAD pool via a
// self-published ManualPriceFeed whose `updatedAt` is gated by V2's
// chainlinkMaxAge (3600s) — so it STALES in ~1h without a keeper. This route
// relays Pyth Hermes USD/CAD (served off-chain even when absent on-chain),
// inverts to CAD/USD, and refreshes the feed. Retire it once a native push
// feed exists on Arc (see docs/architecture/shared-fx-vault-spec.md).
//
// Wire-up: Vercel cron (vercel.json) hits this every 10 min with
// `Authorization: Bearer ${CRON_SECRET}`. Signer = KEEPER (the feed owner).

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ManualPriceFeed CAD/USD, owner = KEEPER. 8-decimal Chainlink convention.
const CAD_USD_FEED = "0x48f01A9B92FFcF6AD854cBb71bAd7094435CAf10" as const;
const FEED_ABI = parseAbi([
  "function setPrice(int256 answer) external",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
]);

// Pyth FX.USD/CAD (Hermes off-chain price service).
const HERMES_USD_CAD = "0x3112b03a41c910ed446852aacf67118cb1bec67b2cd0b9a214c58cc0eaa2ecca";
const HERMES_URL = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${HERMES_USD_CAD}`;

// Guardrails — this is a centralization stopgap, so it self-polices hard.
const MAX_PUBLISH_AGE_S = 60; // reject Hermes data older than this
const MAX_CONF_BPS = 50; // reject if Pyth confidence interval > 0.5%
const SANITY_MIN_CAD_USD = 0.5; // plausible CAD/USD band (≈ 2.0 USD/CAD)
const SANITY_MAX_CAD_USD = 1.0; // (≈ 1.0 USD/CAD)
const MAX_STEP_BPS = 500; // reject a single update that jumps > 5% vs on-chain

function arcRpc() {
  // Paid dRPC in prod (env), public fallback. Never commit the key.
  return process.env.ARC_RPC_URL || arcTestnet.rpcUrls.default.http[0];
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const pk = process.env.CAD_KEEPER_PRIVATE_KEY;
  if (!pk) {
    return NextResponse.json({ error: "CAD_KEEPER_PRIVATE_KEY not set" }, { status: 500 });
  }

  // 1. Pull USD/CAD from Hermes.
  let usdCad: number;
  let confBps: number;
  let publishAge: number;
  try {
    const res = await fetch(HERMES_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`hermes ${res.status}`);
    const data = await res.json();
    const p = data?.parsed?.[0]?.price;
    if (!p) throw new Error("no parsed price");
    const price = Number(p.price);
    const expo = Number(p.expo);
    const conf = Number(p.conf);
    const publishTime = Number(p.publish_time);
    usdCad = price * 10 ** expo;
    confBps = (conf / price) * 10_000;
    publishAge = Math.floor(Date.now() / 1000) - publishTime;
  } catch (e) {
    return NextResponse.json({ error: `hermes fetch failed: ${String(e)}` }, { status: 502 });
  }

  // 2. Validate the source.
  if (publishAge > MAX_PUBLISH_AGE_S) {
    return NextResponse.json({ error: "stale hermes price", publishAge }, { status: 422 });
  }
  if (confBps > MAX_CONF_BPS) {
    return NextResponse.json({ error: "hermes conf too wide", confBps }, { status: 422 });
  }
  if (!Number.isFinite(usdCad) || usdCad <= 0) {
    return NextResponse.json({ error: "bad usdCad", usdCad }, { status: 422 });
  }

  // 3. Invert to CAD/USD, sanity-band it, encode as 8-dec int.
  const cadUsd = 1 / usdCad;
  if (cadUsd < SANITY_MIN_CAD_USD || cadUsd > SANITY_MAX_CAD_USD) {
    return NextResponse.json({ error: "cadUsd out of sanity band", cadUsd }, { status: 422 });
  }
  const answer = BigInt(Math.round(cadUsd * 1e8));

  // 4. Circuit-break against a wild jump vs the current on-chain value.
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(arcRpc()) });
  let prevAnswer = 0n;
  try {
    const [, prev] = await publicClient.readContract({
      address: CAD_USD_FEED,
      abi: FEED_ABI,
      functionName: "latestRoundData",
    });
    prevAnswer = prev as bigint;
  } catch {
    // first set or read hiccup — proceed (sanity band already bounds it)
  }
  if (prevAnswer > 0n) {
    const diff = answer > prevAnswer ? answer - prevAnswer : prevAnswer - answer;
    const stepBps = Number((diff * 10_000n) / prevAnswer);
    if (stepBps > MAX_STEP_BPS) {
      return NextResponse.json(
        { error: "step too large vs on-chain", stepBps, prevAnswer: prevAnswer.toString(), answer: answer.toString() },
        { status: 409 },
      );
    }
  }

  // 5. Push setPrice from KEEPER. (Plain contract call — not a native-USDC
  // transfer — so it routes fine despite Arc's USDC blocklist precompile.)
  const account = privateKeyToAccount(pk.startsWith("0x") ? (pk as `0x${string}`) : (`0x${pk}` as `0x${string}`));
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(arcRpc()) });
  let txHash: string;
  try {
    txHash = await walletClient.writeContract({
      address: CAD_USD_FEED,
      abi: FEED_ABI,
      functionName: "setPrice",
      args: [answer],
    });
  } catch (e) {
    return NextResponse.json({ error: `setPrice failed: ${String(e)}` }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    usdCad: Number(usdCad.toFixed(6)),
    cadUsd: Number(cadUsd.toFixed(6)),
    answer8dec: answer.toString(),
    prevAnswer8dec: prevAnswer.toString(),
    confBps: Number(confBps.toFixed(2)),
    publishAge,
    txHash,
  });
}
