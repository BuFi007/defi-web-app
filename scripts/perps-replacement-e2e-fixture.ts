import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

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

export const ARC_PERPS_CHAIN_ID = 5042002 as const;
export const DEFAULT_E2E_PRIVATE_KEY =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

export interface SeedPartialFillReplacementEventOptions {
  privateKey?: Hex;
  chainId?: typeof ARC_PERPS_CHAIN_ID;
  resetDb?: boolean;
  fillSizeDelta?: bigint;
}

export interface SeedPartialFillReplacementEventResult {
  trader: string;
  originalIntentId: string;
  eventId: string;
  prepareApiPath: string;
  remainingSizeDelta: string;
}

export async function seedPartialFillReplacementEvent(
  opts: SeedPartialFillReplacementEventOptions = {},
): Promise<SeedPartialFillReplacementEventResult> {
  const chainId = opts.chainId ?? ARC_PERPS_CHAIN_ID;
  const privateKey = opts.privateKey ?? privateKeyFromEnv();
  if (opts.resetDb) resetSqlitePath(process.env.BUFI_DB_PATH);

  const account = privateKeyToAccount(privateKey);
  const market = livePerpsMarkets(chainId)[0];
  if (!market) throw new Error("no live Arc perps market configured");

  const db = createTradingMachineDbFromEnv(process.env);
  try {
    const now = Math.floor(Date.now() / 1000);
    const originalOrder = {
      chainId,
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
    const originalSignature = await account.signTypedData(
      buildPerpsOrderTypedData(originalOrder),
    );
    const originalIntentId = hashPerpsOrder(originalOrder);
    const originalIntent: PerpIntent = {
      intentId: originalIntentId,
      chainId,
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
    const partialIntent = await db.perpsIntents.recordFill(
      originalIntentId,
      opts.fillSizeDelta ?? 400n,
    );
    const event = buildPerpsReplacementNeededEvent({
      intent: partialIntent,
      settlementTx: `0x${"bb".repeat(32)}`,
      role: "taker",
      counterpartyIntentId: `0x${"cc".repeat(32)}`,
      fillSizeDelta: opts.fillSizeDelta ?? 400n,
      fillPriceE18: 1_000_000_000_000_000_000n,
      emittedAt: now,
    });
    await db.events.put(event);

    return {
      trader: account.address,
      originalIntentId,
      eventId: event.eventId,
      prepareApiPath: String(event.payload.prepareApiPath),
      remainingSizeDelta: partialIntent.remainingSizeDelta,
    };
  } finally {
    db.close();
  }
}

export function privateKeyFromEnv(): Hex {
  return (
    process.env.SMOKE_TRADER_PRIVATE_KEY ??
    process.env.NEXT_PUBLIC_PERPS_REPLACEMENT_E2E_PRIVATE_KEY ??
    DEFAULT_E2E_PRIVATE_KEY
  ) as Hex;
}

export function resetSqlitePath(path: string | undefined): void {
  if (!path || path === ":memory:") return;
  mkdirSync(dirname(path), { recursive: true });
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(file)) unlinkSync(file);
  }
}
