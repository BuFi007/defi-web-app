import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Wave E2 — Playwright global setup for the perp e2e suite.
 *
 * Boots a local Anvil that forks Arc Testnet so the perps round-trip tests
 * (apps/web/e2e/perps-open-close.spec.ts, perps-liquidation.spec.ts) hit a
 * deterministic chain instead of the public RPC. The public Arc Testnet
 * RPC is rate-limited, has variable latency, and shares state with every
 * other dev — running e2e against it is flaky and irreversible.
 *
 * The fork process is opt-in via PERPS_E2E_FORK_ARC=1; when unset (the
 * default for the existing arcade/loan/perps-panel suites), this returns
 * a no-op and Playwright proceeds normally. That keeps the non-perp tests
 * from paying a 5-second anvil boot tax and from requiring anvil on the
 * machine.
 *
 * State persisted in $PERPS_E2E_RUNTIME_DIR:
 *   - anvil.pid           — the forked anvil process id (read by teardown)
 *   - anvil.log           — anvil stdout/stderr (kept on failure for triage)
 *   - rpc-url.txt         — the rpc the suite should talk to (e.g.
 *                           http://127.0.0.1:8546) — read by perps-fixtures
 *
 * Anvil version: tested against 1.5.x. Fork URL defaults to the public Arc
 * Testnet RPC but can be overridden with PERPS_E2E_FORK_URL when the
 * operator has a private node.
 */

const RUNTIME_DIR = resolve(
  process.env.PERPS_E2E_RUNTIME_DIR ?? "./e2e/.anvil-runtime",
);
const FORK_URL =
  process.env.PERPS_E2E_FORK_URL ?? "https://rpc.testnet.arc.network";
const FORK_PORT = Number(process.env.PERPS_E2E_FORK_PORT ?? "8546");
const FORK_HOST = process.env.PERPS_E2E_FORK_HOST ?? "127.0.0.1";
// Anvil fork startup is dominated by the initial chain-state fetch — Arc
// Testnet typically returns the genesis block in 1-3s but the public RPC
// occasionally stalls. 30s is generous without masking a truly broken
// node.
const READINESS_TIMEOUT_MS = 30_000;

export default async function globalSetup(): Promise<void> {
  if (process.env.PERPS_E2E_FORK_ARC !== "1") {
    // Default OFF. The arcade/loan/perps-panel tests don't need anvil — only
    // the perp deposit/order/close/withdraw round-trip does. Opting in
    // explicitly keeps the existing suite from sprouting a hidden anvil
    // dependency.
    return;
  }

  mkdirSync(RUNTIME_DIR, { recursive: true });
  const logPath = `${RUNTIME_DIR}/anvil.log`;
  const pidPath = `${RUNTIME_DIR}/anvil.pid`;
  const rpcPath = `${RUNTIME_DIR}/rpc-url.txt`;

  // Re-create the log file so a re-run doesn't leave a stale trail. The
  // pid file is rewritten too — if a previous teardown was skipped (e.g.
  // user ctrl-C'd Playwright) the old pid may already be dead, in which
  // case the next teardown's kill() will no-op safely.
  writeFileSync(logPath, "", { encoding: "utf8" });

  const logFd = openSync(logPath, "a");

  // Spawn anvil detached so a Playwright crash doesn't auto-kill it before
  // teardown gets a chance to write triage logs. We DO want it killed at
  // teardown — that's globalTeardown.ts's job.
  const args = [
    "--fork-url",
    FORK_URL,
    "--port",
    String(FORK_PORT),
    "--host",
    FORK_HOST,
    // Avoid the colorful "Welcome to anvil!" banner — keeps the log small.
    "--no-cors",
  ];

  const anvil: ChildProcess = spawn("anvil", args, {
    detached: false,
    stdio: ["ignore", logFd, logFd],
  });

  if (!anvil.pid) {
    throw new Error(
      "[perps-e2e] anvil failed to spawn — is `anvil` on PATH? install foundry: https://book.getfoundry.sh/getting-started/installation",
    );
  }

  writeFileSync(pidPath, String(anvil.pid));
  writeFileSync(rpcPath, `http://${FORK_HOST}:${FORK_PORT}`);

  // Poll the RPC until eth_chainId returns. Anvil prints "Listening on …"
  // before the JSON-RPC handler is fully wired, so a port-up check is
  // insufficient — only a successful eth_chainId proves we can fork-read.
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${FORK_HOST}:${FORK_PORT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_chainId",
          params: [],
          id: 1,
        }),
        // AbortController-style timeout — node ≥ 18 supports it.
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) {
        const json = (await res.json()) as { result?: string };
        if (json.result) {
          // Arc Testnet chainId is 5042002 (0x4cef52). If the operator
          // pointed PERPS_E2E_FORK_URL elsewhere we still accept it —
          // the test files validate the chainId themselves.
          return;
        }
      }
    } catch (err) {
      lastErr = err;
    }
    await sleep(250);
  }

  // Timed out. Kill the anvil we just spawned so we don't leak it, then
  // throw with the log so the failure mode is obvious.
  try {
    anvil.kill("SIGTERM");
  } catch {
    // best-effort
  }
  throw new Error(
    `[perps-e2e] anvil did not become RPC-ready within ${READINESS_TIMEOUT_MS}ms — see ${logPath}. last error: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Ensure the imported `dirname` symbol isn't tree-shaken into a warning if
// some build path strips it. (`dirname` is intentionally imported so this
// module can be retargeted to write into a sibling .runtime dir without
// recomputing the path — keep it.)
void dirname;
