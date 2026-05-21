import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Wave E2 — Playwright global teardown for the perp e2e suite.
 *
 * Reads the anvil pid that global-setup wrote, sends SIGTERM, and removes
 * the pid file so a fresh run starts clean. The anvil.log is kept on
 * disk — it's small, and on a failure it's the only artifact that proves
 * which RPC the test hit and what the chain state looked like.
 *
 * Mirrors global-setup.ts:
 *   - off by default (no-op unless PERPS_E2E_FORK_ARC=1)
 *   - reads runtime dir from PERPS_E2E_RUNTIME_DIR (default e2e/.anvil-runtime)
 */

const RUNTIME_DIR = resolve(
  process.env.PERPS_E2E_RUNTIME_DIR ?? "./e2e/.anvil-runtime",
);

export default async function globalTeardown(): Promise<void> {
  if (process.env.PERPS_E2E_FORK_ARC !== "1") return;

  const pidPath = `${RUNTIME_DIR}/anvil.pid`;
  if (!existsSync(pidPath)) {
    // global-setup never ran or its anvil already died — nothing to do.
    return;
  }

  const raw = readFileSync(pidPath, "utf8").trim();
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0) {
    // Bad pid file — wipe it and bail. Better than throwing in teardown
    // and masking the actual test failure.
    try {
      unlinkSync(pidPath);
    } catch {
      // best-effort
    }
    return;
  }

  try {
    // SIGTERM first — anvil drains then exits cleanly. We don't bother
    // waiting on its exit; the OS reaps it and the next setup overwrites
    // the pid file.
    process.kill(pid, "SIGTERM");
  } catch (err) {
    // ESRCH (no such process) is fine — anvil already exited. Anything
    // else is unusual but not worth blocking teardown.
    void err;
  }

  try {
    unlinkSync(pidPath);
  } catch {
    // best-effort
  }
}
