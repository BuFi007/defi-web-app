import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(import.meta.dir, "..");
const CANARY_NAME = "perps-arc-replacement";
const startedAt = Date.now();
const arcRpcUrl = process.env.ARC_RPC_URL ?? "https://rpc.drpc.testnet.arc.network";
const keeperPrivateKey =
  process.env.KEEPER_PRIVATE_KEY ??
  process.env.ARC_OPERATOR_PRIVATE_KEY ??
  process.env.SMOKE_MARGIN_SEEDER_PRIVATE_KEY;
const marginSeederPrivateKey =
  process.env.SMOKE_MARGIN_SEEDER_PRIVATE_KEY ??
  process.env.ARC_OPERATOR_PRIVATE_KEY ??
  process.env.KEEPER_PRIVATE_KEY;
const apiPort = await choosePort(Number(process.env.CANARY_API_PORT ?? 3102));
const keeperPort = await choosePort(Number(process.env.CANARY_KEEPER_PORT ?? 3199));
const dbPath =
  process.env.BUFI_DB_PATH ??
  resolve(
    ROOT,
    ".bufi",
    "canary",
    `${CANARY_NAME}-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
  );
const smokeWaitMs = process.env.SMOKE_WAIT_MS ?? "180000";
const children: Bun.Subprocess[] = [];

if (!keeperPrivateKey || !marginSeederPrivateKey) {
  throw new Error(
    "ARC_OPERATOR_PRIVATE_KEY, KEEPER_PRIVATE_KEY, or SMOKE_MARGIN_SEEDER_PRIVATE_KEY is required",
  );
}

mkdirSync(dirname(dbPath), { recursive: true });
rmSqliteFiles(dbPath);

try {
  const api = spawnService("api", ["bun", "run", "dev:api"], {
    BUFI_DB_PATH: dbPath,
    NODE_ENV: "development",
    PORT: String(apiPort),
  });
  await waitForHttp(`http://localhost:${apiPort}/health`, "api");

  const matcher = spawnService("matcher", ["bun", "run", "keeper:perps-matcher"], {
    ARC_RPC_URL: arcRpcUrl,
    BUFI_DB_PATH: dbPath,
    KEEPER_POLL_MS: process.env.KEEPER_POLL_MS ?? "2500",
    KEEPER_PRIVATE_KEY: keeperPrivateKey,
    NODE_ENV: "development",
    PORT: String(keeperPort),
  });
  await waitForHttp(`http://localhost:${keeperPort}/health`, "matcher");

  const smoke = await runSmoke({
    ARC_RPC_URL: arcRpcUrl,
    BUFI_API_URL: `http://localhost:${apiPort}`,
    BUFI_DB_PATH: dbPath,
    SMOKE_CLEANUP_POSITIONS: process.env.SMOKE_CLEANUP_POSITIONS ?? "1",
    SMOKE_MARGIN_SEEDER_PRIVATE_KEY: marginSeederPrivateKey,
    SMOKE_WAIT_MS: smokeWaitMs,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        canary: CANARY_NAME,
        apiUrl: `http://localhost:${apiPort}`,
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
  api.kill("SIGTERM");
  matcher.kill("SIGTERM");
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

async function runSmoke(env: Record<string, string>): Promise<unknown> {
  const proc = Bun.spawn(["bun", "scripts/perps-live-arc-replacement-keeper-smoke.ts"], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (stderr.trim()) process.stderr.write(prefixLines("smoke", stderr));
  if (exitCode !== 0) {
    throw new Error(`smoke exited ${exitCode}: ${stderr || stdout}`);
  }
  return parseLastJson(stdout);
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
    await sleep(500);
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

function rmSqliteFiles(path: string): void {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    rmSync(file, { force: true });
  }
}

function parseLastJson(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.lastIndexOf("\n{");
  const json = start >= 0 ? trimmed.slice(start + 1) : trimmed;
  return JSON.parse(json);
}

function prefixLines(name: string, text: string): string {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `[${name}] ${line}`)
    .join("\n")
    .concat("\n");
}
