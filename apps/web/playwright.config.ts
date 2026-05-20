import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the Bento (Arcade) / Loan / Perps e2e suite.
 *
 * The suite drives the full UI through the BENTO_E2E dev-mock-wallet shim
 * (`lib/bento/dev-mock-wallet.ts`) — no real wallet, no MetaMask, no
 * dynamic-labs. The shim is gated on NEXT_PUBLIC_BENTO_E2E=1 so the entire
 * bypass branch tree-shakes out of production builds.
 *
 * The webServer block spawns a dedicated Next dev server with the env flag
 * set. If you already have a dev server running on :3001 WITHOUT the env
 * flag, kill it first (or set BENTO_E2E_REUSE_SERVER=1 to opt in to
 * reusing whatever is already there).
 *
 * Also requires apps/api on :3002 — the suite reads /health and
 * /fx-bento/rooms/:id directly to verify the commit/reveal pipeline reached
 * the simulator. Start it manually with `bun run dev:api`.
 *
 * Wave E2 (perps round-trip): when `PERPS_E2E_FORK_ARC=1` is exported,
 * `e2e/global-setup.ts` boots an Anvil fork of Arc Testnet on
 * 127.0.0.1:8546 and the perps-open-close + perps-liquidation specs
 * use it. Without the flag, the perp specs `test.skip()` and the rest
 * of the suite runs unchanged (no anvil dependency for the legacy
 * arcade/loan tests).
 *
 *   PERPS_E2E_FORK_ARC=1   bun run e2e
 *
 * Overrides (see e2e/global-setup.ts for the full env contract):
 *   PERPS_E2E_FORK_URL     — alternative RPC to fork from (private node)
 *   PERPS_E2E_FORK_PORT    — port anvil listens on (default 8546)
 *   PERPS_E2E_RPC_URL      — short-circuit setup, use external anvil
 *   PERPS_E2E_RUNTIME_DIR  — where setup writes pid/log/rpc-url
 */
const FORK_ENABLED = process.env.PERPS_E2E_FORK_ARC === "1";
// When the perps suite is forking Arc, the Next app needs to point its
// JSON-RPC at the local anvil instead of the public RPC. The frontend's
// chain config reads NEXT_PUBLIC_ARC_RPC_URL; we set it here so Next
// inherits it via the webServer env block. Default port matches
// global-setup.ts.
const ARC_RPC_FOR_WEB = FORK_ENABLED
  ? (process.env.PERPS_E2E_RPC_URL ??
      `http://127.0.0.1:${process.env.PERPS_E2E_FORK_PORT ?? "8546"}`)
  : "";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,

  // Wave E2 — spin up + tear down Anvil around the suite when forking
  // Arc Testnet. The setup/teardown modules are no-ops unless
  // PERPS_E2E_FORK_ARC=1, so this is safe for the existing arcade/loan
  // tests.
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  use: {
    baseURL: "http://localhost:3001",
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // Use bun's next runner — matches the workspace package script. The env
    // flag is the load-bearing piece: without it, dev-mock-wallet.ts returns
    // null and the multiplayer component never falls back to the dev wallet.
    // Inline-export the env on the command line because Playwright's
    // `env: { ... }` map is set on the wrapper process and doesn't always
    // propagate through `bun --bun` to the spawned Next.js worker.
    //
    // When forking Arc, we ALSO have to inline-export
    // NEXT_PUBLIC_ARC_RPC_URL so the Next dev server reads our local
    // anvil instead of the public testnet RPC. Same propagation reason —
    // the `env:` map below doesn't always survive `bun --bun`.
    command: [
      "NEXT_PUBLIC_BENTO_E2E=1",
      "NEXT_PUBLIC_PERPS_REPLACEMENT_E2E=1",
      ARC_RPC_FOR_WEB
        ? `NEXT_PUBLIC_ARC_RPC_URL=${ARC_RPC_FOR_WEB}`
        : "",
      "NODE_ENV=development",
      "bun --bun next dev -p 3001",
    ]
      .filter(Boolean)
      .join(" "),
    cwd: ".",
    url: "http://localhost:3001",
    timeout: 180_000,
    reuseExistingServer:
      process.env.BENTO_E2E_REUSE_SERVER === "1" || !process.env.CI,
    env: {
      NEXT_PUBLIC_BENTO_E2E: "1",
      NEXT_PUBLIC_PERPS_REPLACEMENT_E2E: "1",
      ...(ARC_RPC_FOR_WEB ? { NEXT_PUBLIC_ARC_RPC_URL: ARC_RPC_FOR_WEB } : {}),
    },
  },
});
