import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createTradingMachineDbFromEnv } from "@bufi/db";
import {
  ARC_PERPS_CHAIN_ID,
  privateKeyFromEnv,
  seedPartialFillReplacementEvent,
} from "./perps-replacement-e2e-fixture";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const API_URL =
  process.env.BUFI_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";
const WEB_URL = process.env.BUFI_WEB_URL ?? "http://localhost:3001";
const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT ?? 9227);
const CHROME_PATH =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RESET_DB = process.env.SMOKE_RESET_DB !== "0";

if (!process.env.BUFI_DB_PATH) {
  throw new Error(
    "BUFI_DB_PATH must be set to the same absolute SQLite path used by apps/api",
  );
}
process.env.BUFI_DB_PATH = resolve(process.env.BUFI_DB_PATH);

await assertHealth(new URL("/health", API_URL), "api");
await assertWebReachable();

const seed = await seedPartialFillReplacementEvent({ resetDb: RESET_DB });
await assertSeedVisibleInApi(seed.eventId);

const userDataDir = mkdtempSync(join(tmpdir(), "bufx-perps-replacement-e2e-"));
const chrome = Bun.spawn(
  [
    CHROME_PATH,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ],
  {
    stdout: "ignore",
    stderr: "pipe",
  },
);

try {
  await waitForChrome(DEBUG_PORT);
  const target = await openCdpTarget(WEB_URL);
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.navigate", { url: WEB_URL });
    await waitForEval(
      cdp,
      "document.readyState === 'complete' || document.readyState === 'interactive'",
      "web app document ready",
    );
    await waitForEval(
      cdp,
      "window.__BUFX_PERPS_REPLACEMENT_E2E__?.enabled === true",
      "dev mock wallet to be enabled",
      20_000,
      [
        "Start the web app with NEXT_PUBLIC_PERPS_REPLACEMENT_E2E=1.",
        "The API URL must also be compiled into the web app via NEXT_PUBLIC_API_URL.",
      ].join(" "),
    );
    await waitForEval(
      cdp,
      `window.__BUFX_PERPS_REPLACEMENT_E2E__?.lastToast?.eventId === ${JSON.stringify(
        seed.eventId,
      )}`,
      "replacement toast event",
      30_000,
    );

    const clicked = await evaluate<boolean>(
      cdp,
      `(() => {
        const button = document.querySelector('[data-testid="perps-replacement-sign"]');
        if (!button) return false;
        button.click();
        return true;
      })()`,
      { userGesture: true },
    );
    if (!clicked) throw new Error("replacement sign button was not found");

    await waitForEval(
      cdp,
      `window.__BUFX_PERPS_REPLACEMENT_E2E__?.lastSubmitted?.eventId === ${JSON.stringify(
        seed.eventId,
      )}`,
      "replacement submission",
      30_000,
    );
  } finally {
    await cdp.close();
  }

  const replacement = await waitForReplacement(seed.originalIntentId);
  console.log(
    JSON.stringify(
      {
        ok: true,
        apiUrl: API_URL,
        webUrl: WEB_URL,
        trader: seed.trader,
        originalIntentId: seed.originalIntentId,
        eventId: seed.eventId,
        replacementIntentId: replacement.intentId,
        replacementStatus: replacement.status,
        remainingSizeDelta: replacement.remainingSizeDelta,
      },
      null,
      2,
    ),
  );
} finally {
  chrome.kill();
  rmSync(userDataDir, { recursive: true, force: true });
}

async function assertHealth(url: URL, name: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name} health failed: ${res.status} ${await res.text()}`);
}

async function assertWebReachable(): Promise<void> {
  const res = await fetch(WEB_URL, { redirect: "manual" });
  if (res.status >= 500) {
    throw new Error(`web app failed: ${res.status} ${await res.text()}`);
  }
}

async function assertSeedVisibleInApi(eventId: string): Promise<void> {
  const account = privateKeyToAccount(privateKeyFromEnv());
  const headers = await walletSessionHeaders(account);
  const res = await fetch(new URL("/perps/replacement-needed", API_URL), {
    headers,
  });
  if (!res.ok) {
    throw new Error(`replacement-needed preflight failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { events: Array<{ eventId: string }> };
  if (!body.events.some((event) => event.eventId === eventId)) {
    throw new Error(
      [
        "API did not return the seeded replacement-needed event.",
        "Use the same absolute BUFI_DB_PATH for this script and apps/api.",
      ].join(" "),
    );
  }
}

async function walletSessionHeaders(
  account: ReturnType<typeof privateKeyToAccount>,
): Promise<Record<string, string>> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 60 * 60;
  const message = `BUFX wallet session;address:${account.address};chainId:${ARC_PERPS_CHAIN_ID};iat:${iat};exp:${exp}`;
  const signature = await account.signMessage({ message });
  return {
    accept: "application/json",
    "X-Wallet-Address": account.address,
    "X-Wallet-ChainId": String(ARC_PERPS_CHAIN_ID),
    "X-Wallet-Message": message,
    "X-Wallet-Signature": signature,
  };
}

async function waitForReplacement(originalIntentId: string) {
  const deadline = Date.now() + 30_000;
  let lastPendingCount = 0;
  while (Date.now() < deadline) {
    const db = createTradingMachineDbFromEnv(process.env);
    try {
      const pending = await db.perpsIntents.list({ status: "pending" });
      lastPendingCount = pending.length;
      const replacement = pending.find(
        (intent) => intent.replacementOf === originalIntentId,
      );
      if (replacement) return replacement;
    } finally {
      db.close();
    }
    await sleep(250);
  }
  throw new Error(
    `timed out waiting for replacement in DB; pending intents: ${lastPendingCount}`,
  );
}

async function waitForChrome(port: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
      lastError = `${res.status} ${await res.text()}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await sleep(100);
  }
  const stderr = await new Response(chrome.stderr).text().catch(() => "");
  throw new Error(`Chrome did not start: ${lastError}\n${stderr}`);
}

async function openCdpTarget(url: string): Promise<{ webSocketDebuggerUrl: string }> {
  const res = await fetch(
    `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" },
  );
  if (!res.ok) throw new Error(`CDP target open failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { webSocketDebuggerUrl: string };
}

async function waitForEval(
  cdp: CdpClient,
  expression: string,
  label: string,
  timeoutMs = 15_000,
  hint?: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: unknown = undefined;
  while (Date.now() < deadline) {
    try {
      lastValue = await evaluate(cdp, `Boolean(${expression})`);
      if (lastValue === true) return;
    } catch (error) {
      lastValue = (error as Error).message;
    }
    await sleep(250);
  }
  throw new Error(
    `timed out waiting for ${label}; last=${JSON.stringify(lastValue)}${hint ? `; ${hint}` : ""}`,
  );
}

async function evaluate<T>(
  cdp: CdpClient,
  expression: string,
  opts: { userGesture?: boolean } = {},
): Promise<T> {
  const result = await cdp.send<{
    result: { value?: T; unserializableValue?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: opts.userGesture ?? false,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "Runtime.evaluate failed",
    );
  }
  return result.result.value as T;
}

class CdpClient {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  private constructor(private readonly ws: WebSocket) {
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string; data?: string };
      };
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new Error(
            [message.error.message, message.error.data].filter(Boolean).join(": "),
          ),
        );
      } else {
        pending.resolve(message.result);
      }
    });
  }

  static connect(url: string): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new CdpClient(ws)), {
        once: true,
      });
      ws.addEventListener(
        "error",
        () => reject(new Error(`CDP websocket failed: ${url}`)),
        { once: true },
      );
    });
  }

  send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 10_000);
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this.ws.addEventListener("close", () => resolve(), { once: true });
      this.ws.close();
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
