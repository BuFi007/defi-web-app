import { existsSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

import { createTradingMachineDbFromEnv } from "@bufi/db";
import {
  buildPerpsOrderTypedData,
  buildPerpsReplacementNeededEvent,
  hashPerpsOrder,
  livePerpsMarkets,
} from "@bufi/perps";
import type { PerpIntent } from "@bufi/shared-types";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const API_URL = process.env.BUFI_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";
const PRIVATE_KEY =
  (process.env.SMOKE_TRADER_PRIVATE_KEY as Hex | undefined) ??
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CHAIN_ID = 5042002 as const;
const RESET_DB = process.env.SMOKE_RESET_DB === "1";

if (RESET_DB) resetSqlitePath(process.env.BUFI_DB_PATH);

const account = privateKeyToAccount(PRIVATE_KEY);
const market = livePerpsMarkets(CHAIN_ID)[0];
if (!market) throw new Error("no live Arc perps market configured");

const db = createTradingMachineDbFromEnv(process.env);
const now = Math.floor(Date.now() / 1000);
const originalOrder = {
  chainId: CHAIN_ID,
  trader: account.address,
  marketId: market.marketId,
  side: "long" as const,
  sizeUsdc: "1.000000",
  sizeDelta: "1000",
  leverage: 5,
  orderType: "limit" as const,
  priceE18: "1000000000000000000",
  reduceOnly: false,
  postOnly: true,
  nonce: `${Date.now()}001`,
  deadline: now + 60 * 60,
};
const originalSignature = await account.signTypedData(buildPerpsOrderTypedData(originalOrder));
const originalIntentId = hashPerpsOrder(originalOrder);
const originalIntent: PerpIntent = {
  intentId: originalIntentId,
  chainId: CHAIN_ID,
  trader: account.address,
  marketId: market.marketId,
  side: "long",
  sizeUsdc: originalOrder.sizeUsdc,
  sizeDelta: originalOrder.sizeDelta,
  filledSizeDelta: "0",
  remainingSizeDelta: originalOrder.sizeDelta,
  leverage: originalOrder.leverage,
  orderType: originalOrder.orderType,
  priceE18: originalOrder.priceE18,
  reduceOnly: originalOrder.reduceOnly,
  postOnly: originalOrder.postOnly,
  flags: 2,
  digest: originalIntentId,
  signature: originalSignature,
  nonce: BigInt(originalOrder.nonce),
  deadline: originalOrder.deadline,
  status: "pending",
  createdAt: now,
  updatedAt: now,
};

await db.perpsIntents.put(originalIntent);
const partialIntent = await db.perpsIntents.recordFill(originalIntentId, 400n);
const event = buildPerpsReplacementNeededEvent({
  intent: partialIntent,
  settlementTx: `0x${"bb".repeat(32)}`,
  role: "taker",
  counterpartyIntentId: `0x${"cc".repeat(32)}`,
  fillSizeDelta: 400n,
  fillPriceE18: 1_000_000_000_000_000_000n,
  emittedAt: now,
});
await db.events.put(event);

await assertApiHealthy();
const headers = await walletSessionHeaders();
const queued = await api<{ events: Array<typeof event> }>("/perps/replacement-needed", {
  headers,
});
if (!queued.events.some((queuedEvent) => queuedEvent.eventId === event.eventId)) {
  throw new Error(`replacement-needed event was not returned by API: ${event.eventId}`);
}

const replacementNonce = `${Date.now()}002`;
const replacementDeadline = now + 60 * 15;
const prepared = await api<{
  originalIntentId: string;
  replacementOf: string;
  remainingSizeDelta: string;
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  };
}>(event.payload.prepareApiPath as string, {
  method: "POST",
  headers,
  body: JSON.stringify({ nonce: replacementNonce, deadline: replacementDeadline }),
});
if (prepared.remainingSizeDelta !== "600") {
  throw new Error(`expected residual 600, got ${prepared.remainingSizeDelta}`);
}

const signature = await account.signTypedData(normalizeTypedData(prepared.typedData));
const accepted = await api<{
  intentId: string;
  replacementOf: string;
  remainingSizeDelta: string;
}>(String(event.payload.prepareApiPath).replace(/\/prepare$/, ""), {
  method: "POST",
  headers,
  body: JSON.stringify({
    nonce: replacementNonce,
    deadline: replacementDeadline,
    signature,
  }),
});
const stored = await db.perpsIntents.get(accepted.intentId);
if (!stored) throw new Error(`replacement was accepted but not stored: ${accepted.intentId}`);
if (stored.status !== "pending") throw new Error(`replacement status should be pending, got ${stored.status}`);
if (stored.replacementOf !== originalIntentId) {
  throw new Error(`replacementOf mismatch: ${stored.replacementOf} !== ${originalIntentId}`);
}
if (stored.remainingSizeDelta !== "600") {
  throw new Error(`stored residual mismatch: ${stored.remainingSizeDelta}`);
}
const pending = await db.perpsIntents.list({ status: "pending" });
if (!pending.some((intent) => intent.intentId === stored.intentId)) {
  throw new Error("replacement is not visible in the pending order book");
}

console.log(JSON.stringify({
  ok: true,
  apiUrl: API_URL,
  trader: account.address,
  originalIntentId,
  eventId: event.eventId,
  replacementIntentId: stored.intentId,
  replacementStatus: stored.status,
  replacementOf: stored.replacementOf,
  remainingSizeDelta: stored.remainingSizeDelta,
  pendingOrderBookSize: pending.length,
}, null, 2));

db.close();

async function assertApiHealthy(): Promise<void> {
  const res = await fetch(new URL("/health", API_URL));
  if (!res.ok) throw new Error(`API health failed: ${res.status} ${await res.text()}`);
}

async function walletSessionHeaders(): Promise<Record<string, string>> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 60 * 60;
  const message = `BUFX wallet session;address:${account.address};chainId:${CHAIN_ID};iat:${iat};exp:${exp}`;
  const signature = await account.signMessage({ message });
  return {
    "Content-Type": "application/json",
    "X-Wallet-Address": account.address,
    "X-Wallet-ChainId": String(CHAIN_ID),
    "X-Wallet-Message": message,
    "X-Wallet-Signature": signature,
  };
}

async function api<T>(
  path: string,
  init: RequestInit & { headers: Record<string, string> },
): Promise<T> {
  const res = await fetch(new URL(path, API_URL), {
    method: init.method ?? "GET",
    ...init,
    headers: {
      accept: "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

function normalizeTypedData(typedData: {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}) {
  return {
    ...typedData,
    primaryType: typedData.primaryType as "SignedOrder",
    message: {
      ...typedData.message,
      sizeDeltaE18: BigInt(String(typedData.message.sizeDeltaE18)),
      priceE18: BigInt(String(typedData.message.priceE18)),
      nonce: BigInt(String(typedData.message.nonce)),
      deadline: BigInt(String(typedData.message.deadline)),
    },
  } as Parameters<typeof account.signTypedData>[0];
}

function resetSqlitePath(path: string | undefined): void {
  if (!path || path === ":memory:") return;
  mkdirSync(dirname(path), { recursive: true });
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(file)) unlinkSync(file);
  }
}
