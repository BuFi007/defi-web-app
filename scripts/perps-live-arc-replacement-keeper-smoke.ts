import { createTradingMachineDbFromEnv } from "@bufi/db";
import {
  buildPerpsOrderTypedData,
  hashPerpsOrder,
  livePerpsMarkets,
  orderFlags,
} from "@bufi/perps";
import type { PerpIntent } from "@bufi/shared-types";
import {
  FxMarginAccountAbi,
  FxPerpClearinghouseAbi,
  getRpcUrl,
  loadContracts,
} from "@bufi/contracts";
import type { Address, Hex } from "viem";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const CHAIN_ID = 5042002 as const;
const API_URL =
  process.env.BUFI_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";
const WAIT_MS = Number(process.env.SMOKE_WAIT_MS ?? 120_000);
const MAKER_PRIVATE_KEY =
  (process.env.SMOKE_MAKER_PRIVATE_KEY as Hex | undefined) ??
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COUNTERPARTY_ONE_PRIVATE_KEY =
  (process.env.SMOKE_COUNTERPARTY_ONE_PRIVATE_KEY as Hex | undefined) ??
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const COUNTERPARTY_TWO_PRIVATE_KEY =
  (process.env.SMOKE_COUNTERPARTY_TWO_PRIVATE_KEY as Hex | undefined) ??
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const MARGIN_SEEDER_PRIVATE_KEY = normalizePrivateKey(
  process.env.SMOKE_MARGIN_SEEDER_PRIVATE_KEY ??
    process.env.ARC_OPERATOR_PRIVATE_KEY ??
    process.env.DEPLOYER_PRIVATE_KEY ??
    process.env.KEEPER_PRIVATE_KEY,
);
const MARGIN_SEED_AMOUNT = BigInt(process.env.SMOKE_MARGIN_SEED_AMOUNT ?? "250000");
const CLEANUP_POSITIONS = process.env.SMOKE_CLEANUP_POSITIONS !== "0";
const E18 = 1_000_000_000_000_000_000n;
const MAKER_SIZE_DELTA_E18 = E18.toString();
const FIRST_FILL_SIZE_DELTA_E18 = (E18 * 4n / 10n).toString();
const RESIDUAL_SIZE_DELTA_E18 = (E18 * 6n / 10n).toString();
const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

interface PositionSnapshot {
  sizeE18: string;
  entryPriceE18: string;
  marginReserved: string;
  lastFundingVersion: string;
}

if (!process.env.BUFI_DB_PATH) {
  throw new Error(
    "BUFI_DB_PATH must be set to the same absolute SQLite path used by apps/api and apps/keeper-perps-matcher",
  );
}

const db = createTradingMachineDbFromEnv(process.env);
const client = createPublicClient({
  transport: http(process.env.ARC_RPC_URL ?? getRpcUrl(CHAIN_ID)),
});
const market = livePerpsMarkets(CHAIN_ID)[0];
if (!market) throw new Error("no live Arc perps market configured");
const contracts = loadContracts()[CHAIN_ID];
const clearinghouse = contracts.perps.clearinghouse;
if (!clearinghouse) throw new Error("Arc perps clearinghouse is not configured");
const marginAccount = contracts.perps.marginAccount;
if (!marginAccount) throw new Error("Arc perps margin account is not configured");
const usdc = contracts.tokens.usdc;
if (!usdc) throw new Error("Arc USDC is not configured");

try {
  await assertApiHealthy();

  const maker = privateKeyToAccount(MAKER_PRIVATE_KEY);
  const counterpartyOne = privateKeyToAccount(COUNTERPARTY_ONE_PRIVATE_KEY);
  const counterpartyTwo = privateKeyToAccount(COUNTERPARTY_TWO_PRIVATE_KEY);
  await seedMarginIfNeeded([
    maker.address,
    counterpartyOne.address,
    counterpartyTwo.address,
  ]);
  const before = await readPositions([
    maker.address,
    counterpartyOne.address,
    counterpartyTwo.address,
  ]);

  const makerIntent = await putSignedIntent({
    account: maker,
    side: "long",
    sizeDelta: MAKER_SIZE_DELTA_E18,
    sizeUsdc: "1",
    postOnly: true,
    createdAtOffset: 0,
  });
  const firstCounterpartyIntent = await putSignedIntent({
    account: counterpartyOne,
    side: "short",
    sizeDelta: `-${FIRST_FILL_SIZE_DELTA_E18}`,
    sizeUsdc: "0.4",
    postOnly: false,
    createdAtOffset: 1,
  });

  const firstEvent = await waitForReplacementEvent(makerIntent.intentId);
  const makerAfterPartial = await requireIntent(makerIntent.intentId);
  const counterpartyOneAfterFill = await requireIntent(firstCounterpartyIntent.intentId);
  if (makerAfterPartial.status !== "partially_filled") {
    throw new Error(`maker should be partially_filled, got ${makerAfterPartial.status}`);
  }
  if (makerAfterPartial.remainingSizeDelta !== RESIDUAL_SIZE_DELTA_E18) {
    throw new Error(
      `maker residual should be ${RESIDUAL_SIZE_DELTA_E18}, got ${makerAfterPartial.remainingSizeDelta}`,
    );
  }
  if (counterpartyOneAfterFill.status !== "filled") {
    throw new Error(
      `first counterparty should be filled, got ${counterpartyOneAfterFill.status}`,
    );
  }

  const replacement = await submitReplacementViaApi({
    account: maker,
    originalIntentId: makerIntent.intentId,
    prepareApiPath: String(firstEvent.payload.prepareApiPath),
  });

  const secondCounterpartyIntent = await putSignedIntent({
    account: counterpartyTwo,
    side: "short",
    sizeDelta: `-${RESIDUAL_SIZE_DELTA_E18}`,
    sizeUsdc: "0.6",
    postOnly: false,
    createdAtOffset: 2,
  });

  const replacementAfterFill = await waitForIntentStatus(replacement.intentId, "filled");
  const counterpartyTwoAfterFill = await requireIntent(secondCounterpartyIntent.intentId);
  if (counterpartyTwoAfterFill.status !== "filled") {
    throw new Error(
      `second counterparty should be filled, got ${counterpartyTwoAfterFill.status}`,
    );
  }

  const after = await waitForPositionSizes(
    {
      [maker.address]: BigInt(before[maker.address]!.sizeE18) + E18,
      [counterpartyOne.address]:
        BigInt(before[counterpartyOne.address]!.sizeE18) -
        BigInt(FIRST_FILL_SIZE_DELTA_E18),
      [counterpartyTwo.address]:
        BigInt(before[counterpartyTwo.address]!.sizeE18) -
        BigInt(RESIDUAL_SIZE_DELTA_E18),
    },
    "replacement-fill positions",
  );
  const cleanup = CLEANUP_POSITIONS
    ? await cleanupIncrementalPositions({
        maker,
        counterpartyOne,
        counterpartyTwo,
        expectedPositionsAfterCleanup: {
          [maker.address]: BigInt(before[maker.address]!.sizeE18),
          [counterpartyOne.address]: BigInt(before[counterpartyOne.address]!.sizeE18),
          [counterpartyTwo.address]: BigInt(before[counterpartyTwo.address]!.sizeE18),
        },
      })
    : null;
  console.log(
    JSON.stringify(
      {
        ok: true,
        apiUrl: API_URL,
        chainId: CHAIN_ID,
        marketId: market.marketId,
        maker: maker.address,
        counterpartyOne: counterpartyOne.address,
        counterpartyTwo: counterpartyTwo.address,
        firstSettlementTx: firstEvent.payload.settlementTx,
        originalIntentId: makerIntent.intentId,
        replacementIntentId: replacement.intentId,
        replacementStatus: replacementAfterFill.status,
        firstCounterpartyStatus: counterpartyOneAfterFill.status,
        secondCounterpartyStatus: counterpartyTwoAfterFill.status,
        positions: { before, after, afterCleanup: cleanup?.positionsAfterCleanup ?? null },
        cleanup,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}

async function putSignedIntent(args: {
  account: PrivateKeyAccount;
  side: "long" | "short";
  sizeDelta: string;
  sizeUsdc: string;
  postOnly: boolean;
  createdAtOffset: number;
}): Promise<PerpIntent> {
  const now = Math.floor(Date.now() / 1000);
  const order = {
    chainId: CHAIN_ID,
    trader: args.account.address,
    marketId: market.marketId,
    side: args.side,
    sizeUsdc: args.sizeUsdc,
    sizeDelta: args.sizeDelta,
    leverage: 1,
    orderType: "limit" as const,
    priceE18: "1000000000000000000",
    reduceOnly: false,
    postOnly: args.postOnly,
    nonce: freshNonce(args.createdAtOffset),
    deadline: now + 60 * 30,
  };
  const signature = await args.account.signTypedData(buildPerpsOrderTypedData(order));
  const intentId = hashPerpsOrder(order);
  const intent: PerpIntent = {
    intentId,
    chainId: CHAIN_ID,
    trader: args.account.address,
    marketId: market.marketId,
    side: args.side,
    sizeUsdc: order.sizeUsdc,
    sizeDelta: order.sizeDelta,
    filledSizeDelta: "0",
    remainingSizeDelta: order.sizeDelta,
    leverage: order.leverage,
    orderType: order.orderType,
    priceE18: order.priceE18,
    reduceOnly: order.reduceOnly,
    postOnly: order.postOnly,
    flags: orderFlags(order),
    digest: intentId,
    signature,
    nonce: BigInt(order.nonce),
    deadline: order.deadline,
    status: "pending",
    createdAt: now + args.createdAtOffset,
    updatedAt: now + args.createdAtOffset,
  };
  await db.perpsIntents.put(intent);
  return intent;
}

async function submitReplacementViaApi(args: {
  account: PrivateKeyAccount;
  originalIntentId: string;
  prepareApiPath: string;
}): Promise<PerpIntent> {
  const headers = await walletSessionHeaders(args.account);
  const nonce = freshNonce(50);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const prepared = await api<{
    remainingSizeDelta: string;
    typedData: {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    };
  }>(args.prepareApiPath, {
    method: "POST",
    headers,
    body: JSON.stringify({ nonce, deadline }),
  });
  if (prepared.remainingSizeDelta !== RESIDUAL_SIZE_DELTA_E18) {
    throw new Error(
      `replacement residual should be ${RESIDUAL_SIZE_DELTA_E18}, got ${prepared.remainingSizeDelta}`,
    );
  }
  const signature = await args.account.signTypedData(normalizeTypedData(prepared.typedData));
  const accepted = await api<{ intentId: string }>(
    args.prepareApiPath.replace(/\/prepare$/, ""),
    {
      method: "POST",
      headers,
      body: JSON.stringify({ nonce, deadline, signature }),
    },
  );
  return waitForIntentStatus(accepted.intentId, "pending");
}

async function walletSessionHeaders(
  account: PrivateKeyAccount,
): Promise<Record<string, string>> {
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

async function assertApiHealthy(): Promise<void> {
  const res = await fetch(new URL("/health", API_URL));
  if (!res.ok) throw new Error(`API health failed: ${res.status} ${await res.text()}`);
}

async function waitForReplacementEvent(intentId: string) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const events = await db.events.list({
      type: "bufx.perps.replacement_needed",
      aggregateId: intentId,
      limit: 1,
    });
    const [event] = events;
    if (event) return event;
    await sleep(1_000);
  }
  throw new Error(`timed out waiting for replacement-needed event for ${intentId}`);
}

async function waitForIntentStatus(
  intentId: string,
  status: PerpIntent["status"],
): Promise<PerpIntent> {
  const deadline = Date.now() + WAIT_MS;
  let last: PerpIntent | null = null;
  while (Date.now() < deadline) {
    last = await db.perpsIntents.get(intentId);
    if (last?.status === status) return last;
    await sleep(1_000);
  }
  throw new Error(
    `timed out waiting for ${intentId} status ${status}; last=${last?.status ?? "missing"}`,
  );
}

async function requireIntent(intentId: string): Promise<PerpIntent> {
  const intent = await db.perpsIntents.get(intentId);
  if (!intent) throw new Error(`missing intent ${intentId}`);
  return intent;
}

async function readPositions(traders: string[]): Promise<Record<string, PositionSnapshot>> {
  const result: Record<string, PositionSnapshot> = {};
  for (const trader of traders) {
    const position = await client.readContract({
      address: clearinghouse,
      abi: FxPerpClearinghouseAbi,
      functionName: "position",
      args: [market.marketId as Hex, trader as Hex],
    });
    result[trader] = {
      sizeE18: position.sizeE18.toString(),
      entryPriceE18: position.entryPriceE18.toString(),
      marginReserved: position.marginReserved.toString(),
      lastFundingVersion: position.lastFundingVersion.toString(),
    };
  }
  return result;
}

async function seedMarginIfNeeded(traders: Address[]): Promise<void> {
  const deficits: Array<{ trader: Address; amount: bigint }> = [];
  for (const trader of traders) {
    const free = await client.readContract({
      address: marginAccount,
      abi: FxMarginAccountAbi,
      functionName: "freeMarginOf",
      args: [trader],
    });
    if (free < MARGIN_SEED_AMOUNT) {
      deficits.push({ trader, amount: MARGIN_SEED_AMOUNT - free });
    }
  }
  if (deficits.length === 0) return;
  if (!MARGIN_SEEDER_PRIVATE_KEY) {
    throw new Error(
      "SMOKE_MARGIN_SEEDER_PRIVATE_KEY, ARC_OPERATOR_PRIVATE_KEY, DEPLOYER_PRIVATE_KEY, or KEEPER_PRIVATE_KEY is required to seed live Arc margin",
    );
  }

  const seeder = privateKeyToAccount(MARGIN_SEEDER_PRIVATE_KEY);
  const wallet = createWalletClient({
    account: seeder,
    transport: http(process.env.ARC_RPC_URL ?? getRpcUrl(CHAIN_ID)),
  });
  const total = deficits.reduce((sum, item) => sum + item.amount, 0n);
  const allowance = await client.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [seeder.address, marginAccount],
  });
  if (allowance < total) {
    const approveHash = await wallet.writeContract({
      chain: null,
      account: seeder,
      address: usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [marginAccount, total],
    });
    await waitForTx("USDC.approve margin", approveHash);
  }
  for (const deficit of deficits) {
    const depositHash = await wallet.writeContract({
      chain: null,
      account: seeder,
      address: marginAccount,
      abi: FxMarginAccountAbi,
      functionName: "depositMargin",
      args: [deficit.trader, deficit.amount],
    });
    await waitForTx(`depositMargin ${deficit.trader}`, depositHash);
  }
}

async function cleanupIncrementalPositions(args: {
  maker: PrivateKeyAccount;
  counterpartyOne: PrivateKeyAccount;
  counterpartyTwo: PrivateKeyAccount;
  expectedPositionsAfterCleanup: Record<string, bigint>;
}): Promise<{
  closeMakerWithCounterpartyOneIntentId: string;
  closeCounterpartyOneIntentId: string;
  closeMakerWithCounterpartyTwoIntentId: string;
  closeCounterpartyTwoIntentId: string;
  positionsAfterCleanup: Record<string, PositionSnapshot>;
}> {
  const closeMakerWithCounterpartyOne = await putSignedIntent({
    account: args.maker,
    side: "short",
    sizeDelta: `-${FIRST_FILL_SIZE_DELTA_E18}`,
    sizeUsdc: "0.4",
    postOnly: true,
    createdAtOffset: 100,
  });
  const closeCounterpartyOne = await putSignedIntent({
    account: args.counterpartyOne,
    side: "long",
    sizeDelta: FIRST_FILL_SIZE_DELTA_E18,
    sizeUsdc: "0.4",
    postOnly: false,
    createdAtOffset: 101,
  });
  const closeMakerWithCounterpartyTwo = await putSignedIntent({
    account: args.maker,
    side: "short",
    sizeDelta: `-${RESIDUAL_SIZE_DELTA_E18}`,
    sizeUsdc: "0.6",
    postOnly: true,
    createdAtOffset: 102,
  });
  const closeCounterpartyTwo = await putSignedIntent({
    account: args.counterpartyTwo,
    side: "long",
    sizeDelta: RESIDUAL_SIZE_DELTA_E18,
    sizeUsdc: "0.6",
    postOnly: false,
    createdAtOffset: 103,
  });

  await Promise.all([
    waitForIntentStatus(closeMakerWithCounterpartyOne.intentId, "filled"),
    waitForIntentStatus(closeCounterpartyOne.intentId, "filled"),
    waitForIntentStatus(closeMakerWithCounterpartyTwo.intentId, "filled"),
    waitForIntentStatus(closeCounterpartyTwo.intentId, "filled"),
  ]);

  const positionsAfterCleanup = await waitForPositionSizes(
    args.expectedPositionsAfterCleanup,
    "cleanup positions",
  );
  return {
    closeMakerWithCounterpartyOneIntentId: closeMakerWithCounterpartyOne.intentId,
    closeCounterpartyOneIntentId: closeCounterpartyOne.intentId,
    closeMakerWithCounterpartyTwoIntentId: closeMakerWithCounterpartyTwo.intentId,
    closeCounterpartyTwoIntentId: closeCounterpartyTwo.intentId,
    positionsAfterCleanup,
  };
}

async function waitForPositionSizes(
  expected: Record<string, bigint>,
  label: string,
): Promise<Record<string, PositionSnapshot>> {
  const traders = Object.keys(expected);
  const deadline = Date.now() + WAIT_MS;
  let last: Record<string, PositionSnapshot> | null = null;
  while (Date.now() < deadline) {
    last = await readPositions(traders);
    const matches = traders.every((trader) => last![trader]!.sizeE18 === expected[trader]!.toString());
    if (matches) return last;
    await sleep(1_000);
  }
  throw new Error(
    `${label} did not reach expected on-chain sizes; expected=${JSON.stringify(
      stringifyBigints(expected),
    )} last=${JSON.stringify(last)}`,
  );
}

function stringifyBigints(value: Record<string, bigint>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, item.toString()]),
  );
}

async function waitForTx(label: string, hash: Hex): Promise<void> {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
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
  } as Parameters<PrivateKeyAccount["signTypedData"]>[0];
}

function freshNonce(offset: number): string {
  return (BigInt(Date.now()) * 1_000n + BigInt(offset)).toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePrivateKey(value: string | undefined): Hex | undefined {
  if (!value) return undefined;
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("margin seeder private key must be a 32-byte hex string");
  }
  return normalized as Hex;
}
