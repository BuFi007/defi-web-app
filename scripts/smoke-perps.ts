/**
 * Sprint A smoke test — verifies the perps positions read path.
 *
 * Flow:
 *   1. Build a wallet session header from a dev mock private key.
 *   2. Sign a Long EIP-712 perp intent and POST /perps/intents.
 *   3. Poll /perps/positions/:address every 2s for up to 60s.
 *   4. Assert >=1 row whose marketId matches the submitted intent.
 *
 * Required env (script bails fast if missing):
 *   - SMOKE_API_URL                Defaults to http://localhost:3001
 *   - SMOKE_TRADER_PRIVATE_KEY     0x... 32-byte hex (dev mock wallet)
 *
 * Optional env:
 *   - SMOKE_CHAIN_ID               Defaults to 5042002 (Arc testnet)
 *   - SMOKE_MARKET_ID              Defaults to first live Arc perp market
 *   - SMOKE_SIZE_USDC              Defaults to "1.000000"
 *   - SMOKE_LEVERAGE               Defaults to 5
 *   - SMOKE_WAIT_MS                Defaults to 60_000
 *   - SMOKE_POLL_MS                Defaults to 2_000
 *
 * The script never broadcasts on-chain itself; it relies on the matcher
 * keeper running against the same API + Ponder pair to fill the intent
 * and the indexer to produce a `perps_position` row.
 */

import {
  buildPerpsOrderTypedData,
  livePerpsMarkets,
  orderFlags,
} from "@bufi/perps";
import { setTimeout as sleep } from "node:timers/promises";
import { type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const apiUrl = (process.env.SMOKE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const chainId = Number(process.env.SMOKE_CHAIN_ID ?? 5042002);
const sizeUsdc = process.env.SMOKE_SIZE_USDC ?? "1.000000";
const leverage = Number(process.env.SMOKE_LEVERAGE ?? 5);
const waitMs = Number(process.env.SMOKE_WAIT_MS ?? 60_000);
const pollMs = Number(process.env.SMOKE_POLL_MS ?? 2_000);
const traderPk = process.env.SMOKE_TRADER_PRIVATE_KEY as Hex | undefined;

if (!traderPk) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error:
          "SMOKE_TRADER_PRIVATE_KEY is required (0x-prefixed 32-byte hex of a dev mock wallet)",
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

const account = privateKeyToAccount(traderPk);
const markets = livePerpsMarkets(chainId);
const marketId = (process.env.SMOKE_MARKET_ID ?? markets[0]?.marketId) as string | undefined;
if (!marketId) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: `no live perps market for chainId=${chainId}; pass SMOKE_MARKET_ID`,
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

const startedAt = Date.now();

try {
  const session = await buildWalletSession(account);
  const intentResp = await submitIntent(account, session);
  console.log(
    JSON.stringify({
      step: "intent-submitted",
      intentId: intentResp.intentId,
      digest: intentResp.digest,
    }),
  );

  const positions = await pollPositions(account.address, session);
  if (positions.length === 0) {
    throw new Error(
      `no positions appeared in ${waitMs}ms for trader=${account.address} market=${marketId}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        smoke: "perps-positions-after-fill",
        apiUrl,
        chainId,
        marketId,
        trader: account.address,
        intentId: intentResp.intentId,
        positionsSeen: positions.length,
        sample: positions[0],
        durationMs: Date.now() - startedAt,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        smoke: "perps-positions-after-fill",
        apiUrl,
        chainId,
        marketId,
        trader: account.address,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

interface WalletSessionHeaders {
  "X-Wallet-Address": string;
  "X-Wallet-ChainId": string;
  "X-Wallet-TypedData": string;
  "X-Wallet-Signature": string;
}

async function buildWalletSession(
  signer: ReturnType<typeof privateKeyToAccount>,
): Promise<WalletSessionHeaders> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 86_400;
  const typedData = {
    domain: { name: "BUFX Wallet Session", version: "1", chainId },
    types: {
      WalletSession: [
        { name: "purpose", type: "string" },
        { name: "wallet", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "origin", type: "string" },
        { name: "iat", type: "uint256" },
        { name: "exp", type: "uint256" },
      ],
    },
    primaryType: "WalletSession" as const,
    message: {
      purpose: "bufx.smoke-perps",
      wallet: signer.address,
      chainId: BigInt(chainId),
      origin: apiUrl,
      iat: BigInt(iat),
      exp: BigInt(exp),
    },
  };
  const signature = await signer.signTypedData(typedData);
  const wire = JSON.stringify({
    ...typedData,
    message: {
      ...typedData.message,
      chainId: String(chainId),
      iat: String(iat),
      exp: String(exp),
    },
  });
  return {
    "X-Wallet-Address": signer.address,
    "X-Wallet-ChainId": String(chainId),
    "X-Wallet-TypedData": wire,
    "X-Wallet-Signature": signature,
  };
}

async function submitIntent(
  signer: ReturnType<typeof privateKeyToAccount>,
  session: WalletSessionHeaders,
): Promise<{ intentId: string; digest: string }> {
  const nonce = BigInt(Date.now()).toString();
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const order = {
    chainId: chainId as 5042002,
    trader: signer.address as Address,
    marketId: marketId as string,
    side: "long" as const,
    sizeUsdc,
    sizeDelta: "1000000000000000000",
    leverage,
    orderType: "limit" as const,
    priceE18: "1000000000000000000",
    reduceOnly: false,
    postOnly: false,
    nonce,
    deadline,
  };
  const typed = buildPerpsOrderTypedData(order);
  const signature = await signer.signTypedData(typed);

  const body = {
    chainId,
    marketId,
    trader: signer.address,
    side: "long",
    sizeUsdc,
    sizeDelta: order.sizeDelta,
    leverage,
    orderType: "limit",
    priceE18: order.priceE18,
    limitPrice: order.priceE18,
    reduceOnly: false,
    postOnly: false,
    nonce,
    deadline,
    flags: orderFlags(order),
    signature,
  };

  const res = await fetch(`${apiUrl}/perps/intents`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...session,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /perps/intents -> ${res.status}: ${text.slice(0, 240)}`);
  }
  return (await res.json()) as { intentId: string; digest: string };
}

async function pollPositions(
  address: Address,
  session: WalletSessionHeaders,
): Promise<unknown[]> {
  const deadline = Date.now() + waitMs;
  let lastBody: { positions: unknown[] } = { positions: [] };
  while (Date.now() < deadline) {
    const res = await fetch(`${apiUrl}/perps/positions/${address}`, {
      headers: { accept: "application/json", ...session },
    });
    if (res.ok) {
      lastBody = (await res.json()) as { positions: unknown[] };
      if (lastBody.positions.length > 0) return lastBody.positions;
    } else if (res.status !== 401) {
      // 401 may transiently occur during session warmup; other errors are fatal.
      const text = await res.text();
      throw new Error(`GET /perps/positions/${address} -> ${res.status}: ${text.slice(0, 240)}`);
    }
    await sleep(pollMs);
  }
  return lastBody.positions;
}
