import { createTradingMachineDbFromEnv } from "@bufi/db";
import {
  buildPerpsOrderTypedData,
  hashPerpsOrder,
  livePerpsMarkets,
  orderFlags,
} from "@bufi/perps";
import type { PerpIntent } from "@bufi/shared-types";
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const ROOT = resolve(import.meta.dir, "..");
const CANARY_NAME = "perps-local-replacement";
const CHAIN_ID = 5042002 as const;
const WAIT_MS = Number(process.env.SMOKE_WAIT_MS ?? 60_000);
const E18 = 1_000_000_000_000_000_000n;
const MAKER_SIZE_DELTA_E18 = E18.toString();
const FIRST_FILL_SIZE_DELTA_E18 = (E18 * 4n / 10n).toString();
const RESIDUAL_SIZE_DELTA_E18 = (E18 * 6n / 10n).toString();
const MAKER_PRIVATE_KEY =
  (process.env.SMOKE_MAKER_PRIVATE_KEY as Hex | undefined) ??
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COUNTERPARTY_ONE_PRIVATE_KEY =
  (process.env.SMOKE_COUNTERPARTY_ONE_PRIVATE_KEY as Hex | undefined) ??
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const COUNTERPARTY_TWO_PRIVATE_KEY =
  (process.env.SMOKE_COUNTERPARTY_TWO_PRIVATE_KEY as Hex | undefined) ??
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const DUMMY_KEEPER_PRIVATE_KEY =
  process.env.KEEPER_PRIVATE_KEY ??
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const apiPort = await choosePort(Number(process.env.CANARY_API_PORT ?? 3101));
const keeperPort = await choosePort(Number(process.env.CANARY_KEEPER_PORT ?? 3198));
const dbPath =
  process.env.BUFI_DB_PATH ??
  resolve(
    ROOT,
    ".bufi",
    "canary",
    `${CANARY_NAME}-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
  );
const apiUrl = `http://localhost:${apiPort}`;
const market = livePerpsMarkets(CHAIN_ID)[0];
if (!market) throw new Error("no live Arc perps market configured");

const children: Bun.Subprocess[] = [];
const startedAt = Date.now();

mkdirSync(dirname(dbPath), { recursive: true });
rmSqliteFiles(dbPath);

try {
  spawnService("api", ["bun", "run", "dev:api"], {
    BUFI_DB_PATH: dbPath,
    NODE_ENV: "development",
    PORT: String(apiPort),
  });
  await waitForHttp(`${apiUrl}/health`, "api");

  spawnService("matcher", ["bun", "run", "keeper:perps-matcher"], {
    BUFI_DB_PATH: dbPath,
    KEEPER_POLL_MS: process.env.KEEPER_POLL_MS ?? "250",
    KEEPER_PRIVATE_KEY: DUMMY_KEEPER_PRIVATE_KEY,
    NODE_ENV: "development",
    PERPS_MATCHER_SETTLEMENT_MODE: "mock",
    PORT: String(keeperPort),
  });
  await waitForHttp(`http://localhost:${keeperPort}/health`, "matcher");

  const smoke = await runLocalSmoke();
  console.log(
    JSON.stringify(
      {
        ok: true,
        canary: CANARY_NAME,
        apiUrl,
        matcherUrl: `http://localhost:${keeperPort}`,
        dbPath,
        durationMs: Date.now() - startedAt,
        smoke,
      },
      null,
      2,
    ),
  );
  await stopChildren();
} catch (error) {
  await stopChildren();
  console.error(
    JSON.stringify(
      {
        ok: false,
        canary: CANARY_NAME,
        dbPath,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

async function runLocalSmoke(): Promise<Record<string, unknown>> {
  const db = createTradingMachineDbFromEnv({ ...process.env, BUFI_DB_PATH: dbPath });
  try {
    const maker = privateKeyToAccount(MAKER_PRIVATE_KEY);
    const counterpartyOne = privateKeyToAccount(COUNTERPARTY_ONE_PRIVATE_KEY);
    const counterpartyTwo = privateKeyToAccount(COUNTERPARTY_TWO_PRIVATE_KEY);

    const makerIntent = await putSignedIntent(db, {
      account: maker,
      side: "long",
      sizeDelta: MAKER_SIZE_DELTA_E18,
      sizeUsdc: "1",
      postOnly: true,
      createdAtOffset: 0,
    });
    const firstCounterpartyIntent = await putSignedIntent(db, {
      account: counterpartyOne,
      side: "short",
      sizeDelta: `-${FIRST_FILL_SIZE_DELTA_E18}`,
      sizeUsdc: "0.4",
      postOnly: false,
      createdAtOffset: 1,
    });

    const event = await waitForReplacementEvent(db, makerIntent.intentId);
    const makerAfterPartial = await requireIntent(db, makerIntent.intentId);
    const counterpartyOneAfterFill = await requireIntent(db, firstCounterpartyIntent.intentId);
    assertIntentStatus(makerAfterPartial, "partially_filled");
    assertIntentStatus(counterpartyOneAfterFill, "filled");
    if (makerAfterPartial.remainingSizeDelta !== RESIDUAL_SIZE_DELTA_E18) {
      throw new Error(
        `maker residual should be ${RESIDUAL_SIZE_DELTA_E18}, got ${makerAfterPartial.remainingSizeDelta}`,
      );
    }

    const replacement = await submitReplacementViaApi({
      account: maker,
      prepareApiPath: String(event.payload.prepareApiPath),
    });

    const secondCounterpartyIntent = await putSignedIntent(db, {
      account: counterpartyTwo,
      side: "short",
      sizeDelta: `-${RESIDUAL_SIZE_DELTA_E18}`,
      sizeUsdc: "0.6",
      postOnly: false,
      createdAtOffset: 2,
    });

    const replacementAfterFill = await waitForIntentStatus(db, replacement.intentId, "filled");
    const counterpartyTwoAfterFill = await requireIntent(db, secondCounterpartyIntent.intentId);
    assertIntentStatus(counterpartyTwoAfterFill, "filled");

    return {
      chainId: CHAIN_ID,
      marketId: market.marketId,
      maker: maker.address,
      counterpartyOne: counterpartyOne.address,
      counterpartyTwo: counterpartyTwo.address,
      originalIntentId: makerIntent.intentId,
      firstCounterpartyIntentId: firstCounterpartyIntent.intentId,
      replacementEventId: event.eventId,
      replacementSettlementTx: event.payload.settlementTx,
      replacementIntentId: replacement.intentId,
      replacementStatus: replacementAfterFill.status,
      secondCounterpartyIntentId: secondCounterpartyIntent.intentId,
      remainingSizeDelta: makerAfterPartial.remainingSizeDelta,
    };
  } finally {
    db.close();
  }
}

async function putSignedIntent(
  db: ReturnType<typeof createTradingMachineDbFromEnv>,
  args: {
    account: PrivateKeyAccount;
    side: "long" | "short";
    sizeDelta: string;
    sizeUsdc: string;
    postOnly: boolean;
    createdAtOffset: number;
  },
): Promise<PerpIntent> {
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
  const db = createTradingMachineDbFromEnv({ ...process.env, BUFI_DB_PATH: dbPath });
  try {
    return waitForIntentStatus(db, accepted.intentId, "pending");
  } finally {
    db.close();
  }
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
  const res = await fetch(new URL(path, apiUrl), {
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

async function waitForReplacementEvent(
  db: ReturnType<typeof createTradingMachineDbFromEnv>,
  intentId: string,
) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const [event] = await db.events.list({
      type: "bufx.perps.replacement_needed",
      aggregateId: intentId,
      limit: 1,
    });
    if (event) return event;
    await sleep(250);
  }
  throw new Error(`timed out waiting for replacement-needed event for ${intentId}`);
}

async function waitForIntentStatus(
  db: ReturnType<typeof createTradingMachineDbFromEnv>,
  intentId: string,
  status: PerpIntent["status"],
): Promise<PerpIntent> {
  const deadline = Date.now() + WAIT_MS;
  let last: PerpIntent | null = null;
  while (Date.now() < deadline) {
    last = await db.perpsIntents.get(intentId);
    if (last?.status === status) return last;
    await sleep(250);
  }
  throw new Error(
    `timed out waiting for ${intentId} status ${status}; last=${last?.status ?? "missing"}`,
  );
}

async function requireIntent(
  db: ReturnType<typeof createTradingMachineDbFromEnv>,
  intentId: string,
): Promise<PerpIntent> {
  const intent = await db.perpsIntents.get(intentId);
  if (!intent) throw new Error(`missing intent ${intentId}`);
  return intent;
}

function assertIntentStatus(intent: PerpIntent, status: PerpIntent["status"]): void {
  if (intent.status !== status) {
    throw new Error(`${intent.intentId} should be ${status}, got ${intent.status}`);
  }
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

function spawnService(
  name: string,
  cmd: string[],
  env: Record<string, string>,
): Bun.Subprocess {
  const proc = Bun.spawn(cmd, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stderr: "pipe",
    stdout: "pipe",
  });
  children.push(proc);
  void pipeProcessOutput(name, proc.stdout);
  void pipeProcessOutput(name, proc.stderr);
  return proc;
}

async function pipeProcessOutput(name: string, stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) process.stderr.write(`[${name}] ${line}\n`);
    }
  }
  if (carry.trim()) process.stderr.write(`[${name}] ${carry}\n`);
}

async function waitForHttp(url: string, label: string): Promise<void> {
  const deadline = Date.now() + Number(process.env.CANARY_BOOT_TIMEOUT_MS ?? 30_000);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Service is still booting.
    }
    await sleep(250);
  }
  throw new Error(`${label} did not become healthy at ${url}`);
}

async function stopChildren(): Promise<void> {
  await Promise.all(children.map((child) => stopChild(child)));
}

async function stopChild(child: Bun.Subprocess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGINT");
  await Promise.race([
    child.exited.catch(() => undefined),
    sleep(3_000).then(() => {
      if (child.exitCode === null) child.kill("SIGTERM");
    }),
  ]);
}

async function choosePort(preferred: number): Promise<number> {
  if (await canListen(preferred)) return preferred;
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("could not allocate a canary port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

function freshNonce(offset: number): string {
  return (BigInt(Date.now()) * 1_000n + BigInt(offset)).toString();
}

function rmSqliteFiles(path: string): void {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    rmSync(file, { force: true });
  }
}
