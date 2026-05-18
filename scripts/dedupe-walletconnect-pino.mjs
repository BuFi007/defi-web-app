#!/usr/bin/env node
// Postinstall dedupe step for WalletConnect's nested pino.
//
// WHY: @walletconnect/logger locks pino@7 which itself locks
// thread-stream@0.15 + sonic-boom@1.x. Bun's `overrides` field doesn't
// reach deeply-nested deps, and Turbopack v16's SSR externalizer chokes
// on the resulting nested paths under .next/dev — it mangles the package
// names into `pino-<contenthash>` and emits broken `require()` calls.
//
// Symptom: "Failed to load external module pino-25a67b89a808db7f:
//           Cannot find package 'pino-25a67b89a808db7f'".
//
// Fix: delete the nested @walletconnect/logger/node_modules/pino tree so
// node's CJS resolver walks up to the top-level pino (declared via the
// root package.json `overrides`). The top-level pino is modern enough
// that WalletConnect's logger usage (which only needs `.info/.warn`)
// still works fine.
//
// Idempotent and best-effort: if the nested dir doesn't exist (clean
// install or already deduped), this is a no-op.

import { rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "node_modules/@walletconnect/logger/node_modules/pino",
  "node_modules/@walletconnect/logger/node_modules/thread-stream",
  "node_modules/@walletconnect/logger/node_modules/sonic-boom",
  "node_modules/@walletconnect/logger/node_modules/pino-std-serializers",
  "node_modules/@walletconnect/logger/node_modules/pino-abstract-transport",
  "node_modules/@walletconnect/logger/node_modules/pino-pretty",
];

let removed = 0;
for (const rel of targets) {
  const abs = resolve(repoRoot, rel);
  if (existsSync(abs)) {
    rmSync(abs, { recursive: true, force: true });
    removed += 1;
    console.log(`[dedupe-wc-pino] removed ${rel}`);
  }
}
if (removed === 0) {
  console.log("[dedupe-wc-pino] no nested pino dirs to remove (already clean)");
}
