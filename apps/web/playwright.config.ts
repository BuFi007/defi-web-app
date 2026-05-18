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
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,

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
    command:
      "NEXT_PUBLIC_BENTO_E2E=1 NODE_ENV=development bun --bun next dev -p 3001",
    cwd: ".",
    url: "http://localhost:3001",
    timeout: 180_000,
    reuseExistingServer:
      process.env.BENTO_E2E_REUSE_SERVER === "1" || !process.env.CI,
    env: {
      NEXT_PUBLIC_BENTO_E2E: "1",
    },
  },
});
