// Each keeper app runs `bun run --hot src/index.ts` from its own
// `apps/keeper-*/` cwd. Bun only auto-loads `.env.local` from cwd, so
// the workspace-root `.env.local` (where KEEPER_PRIVATE_KEY lives) is
// invisible to keepers. Walk up the dir tree from this module, stop at
// the first `.env.local` we find, and hand it to Bun.env before any
// `@bufi/env` call materializes the schema. Safe to run multiple times;
// existing process.env wins (so per-app overrides still work).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function loadRootEnvLocal(): void {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i += 1) {
      const candidate = join(dir, ".env.local");
      if (existsSync(candidate)) {
        const text = readFileSync(candidate, "utf8");
        for (const rawLine of text.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line || line.startsWith("#")) continue;
          const eq = line.indexOf("=");
          if (eq < 0) continue;
          const key = line.slice(0, eq).trim();
          if (!key || process.env[key] !== undefined) continue;
          let value = line.slice(eq + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          process.env[key] = value;
        }
        return;
      }
      const parent = resolve(dir, "..");
      if (parent === dir) return;
      dir = parent;
    }
  } catch {
    // dotenv is best-effort; if anything fails the schema validation
    // downstream will surface a clear error.
  }
}

loadRootEnvLocal();

import { getRpcUrl } from "@bufi/contracts";
import { serverEnv } from "@bufi/env";
import { initOtel, withSpan } from "@bufi/observability";
import { createLogger, type Logger } from "@bufinance/logger";
import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { resolveHealthPort, startHealthServer } from "./health-server";

export {
  resolveHealthPort,
  startHealthServer,
  type HealthServerOptions,
  type HealthStatus,
} from "./health-server";
export {
  postPublish,
  type AnalyticsEnvelope,
  type PublishEnvelope,
  type PublishResult,
  type RealtimeEnvelope,
} from "./publish";

export interface KeeperContext {
  name: string;
  log: Logger;
  env: ReturnType<typeof serverEnv>;
  clients: {
    fuji: PublicClient;
    arc: PublicClient;
  };
}

export interface KeeperDefinition {
  name: string;
  tick(ctx: KeeperContext): Promise<void>;
}

// Wraps a Logger so identical (level, event, payload) triples emitted
// back-to-back collapse to a single line. Keepers tick every pollMs and
// most ticks are no-ops; without this every 5s we get the same
// "*.scan no-op" line N times per keeper across N keepers — which floods
// the terminal in `bun dev:complete`. First call always emits; subsequent
// duplicates are silent until the payload changes or REEMIT_AFTER_MS
// elapses (so we still see a periodic heartbeat in long-running keepers).
const DEDUPE_REEMIT_AFTER_MS = Number(
  process.env.KEEPER_LOG_REEMIT_MS ?? 60 * 60 * 1000,
);

function wrapDedupe(base: Logger): Logger {
  const levels: Array<"debug" | "info" | "warn" | "error" | "fatal"> = [
    "debug",
    "info",
    "warn",
    "error",
    "fatal",
  ];
  let lastKey: string | null = null;
  let lastAt = 0;
  const out = {} as Logger;
  for (const lvl of levels) {
    (out as unknown as Record<string, (...args: unknown[]) => void>)[lvl] = (
      ...args: unknown[]
    ) => {
      let key: string;
      try {
        key = `${lvl}:${JSON.stringify(args)}`;
      } catch {
        key = `${lvl}:${String(args[0])}`;
      }
      const now = Date.now();
      if (key === lastKey && now - lastAt < DEDUPE_REEMIT_AFTER_MS) {
        return;
      }
      lastKey = key;
      lastAt = now;
      (base[lvl] as (...a: unknown[]) => void)(...args);
    };
  }
  return out;
}

export function createKeeperContext(name: string): KeeperContext {
  const env = serverEnv();
  return {
    name,
    env,
    log: wrapDedupe(createLogger({ prefix: name })),
    clients: {
      fuji: createPublicClient({ transport: http(getRpcUrl(43113)) }),
      arc: createPublicClient({ transport: http(getRpcUrl(5042002)) }),
    },
  };
}

export class KeeperSignerMissingError extends Error {
  constructor() {
    super("KEEPER_PRIVATE_KEY is required for on-chain keeper mutations");
    this.name = "KeeperSignerMissingError";
  }
}

export async function runKeeper(def: KeeperDefinition): Promise<void> {
  // Initialise OTel once per keeper process. NoOp when AXIOM_TOKEN is unset
  // so dev pays zero cost; full OTLP exporter when set. Service name maps
  // a `@bufi/keeper-foo` package name to the Axiom convention `keeper.foo`.
  const otelServiceName = def.name
    .replace(/^@bufi\//, "")
    .replace(/^keeper-/, "keeper.");
  void initOtel({ serviceName: otelServiceName });

  const ctx = createKeeperContext(def.name);
  const pollMs = ctx.env.KEEPER_POLL_MS;
  let lastOkAt = 0;
  let lastTickAt: number | undefined; // ms; undefined before first success
  let lastError: string | null = null;
  let idledForMissingSigner = false;
  let tickIndex = 0;

  // Three missed ticks = degraded. Keepers vary widely in cadence
  // (matcher 5s, funding 1h), so we derive the staleness threshold
  // from KEEPER_POLL_MS rather than hard-coding a wall-clock.
  const staleAfterMs = pollMs * 3;
  const getHealthStatus = () => {
    if (idledForMissingSigner) {
      return {
        healthy: false,
        lastTick: lastTickAt,
        meta: {
          app: def.name,
          idle: true,
          lastError,
        },
      };
    }
    const fresh = lastTickAt !== undefined && Date.now() - lastTickAt < staleAfterMs;
    const healthy = fresh && lastError === null;
    return {
      healthy,
      lastTick: lastTickAt,
      meta: {
        app: def.name,
        pollMs,
        staleAfterMs,
        ...(lastError ? { lastError } : {}),
      },
    };
  };

  // New per-keeper health port: KEEPER_<APP>_HEALTH_PORT (preferred) or
  // generic KEEPER_HEALTH_PORT. Skip entirely when neither is set so we
  // don't double-bind in tests.
  const healthPort = resolveHealthPort(def.name);
  if (healthPort !== null) {
    startHealthServer({ name: def.name, port: healthPort, getStatus: getHealthStatus });
  } else if (ctx.env.PORT) {
    // Back-compat: pre-F3 deploys set the per-keeper PORT env. Serve the
    // same /health shape there so existing infra keeps working until they
    // migrate to KEEPER_*_HEALTH_PORT.
    startHealthServer({ name: def.name, port: ctx.env.PORT, getStatus: getHealthStatus });
  }

  ctx.log.info("keeper.boot", {
    pollMs,
    healthPort: healthPort ?? ctx.env.PORT ?? null,
    staleAfterMs,
  });
  for (;;) {
    const started = Date.now();
    try {
      if (idledForMissingSigner) {
        // Signer absent -- skip the tick entirely so we don't re-throw
        // every pollMs. Health endpoint still serves; bringing the key
        // online requires a restart.
      } else {
        const currentTick = tickIndex;
        tickIndex += 1;
        // One span per tick. `withSpan` re-throws so the outer catch still
        // sees the original error and records it the same way as before;
        // the span captures the exception + ERROR status as a side effect.
        await withSpan(
          "keeper.tick",
          async (span) => {
            try {
              await def.tick(ctx);
            } finally {
              span.setAttribute("tick.duration_ms", Date.now() - started);
            }
          },
          {
            "keeper.name": def.name,
            "tick.index": currentTick,
          },
          otelServiceName,
        );
        lastOkAt = Math.floor(Date.now() / 1000);
        lastTickAt = Date.now();
        lastError = null;
        // No per-tick heartbeat log -- each keeper's own scan log already
        // serves as a heartbeat (and is deduped). Re-add via KEEPER_TICK_LOG=1
        // when actively debugging tick latency.
        if (process.env.KEEPER_TICK_LOG === "1") {
          ctx.log.debug("keeper.tick", { ms: Date.now() - started });
        }
      }
    } catch (e) {
      if (e instanceof KeeperSignerMissingError) {
        idledForMissingSigner = true;
        lastError = e.message;
        ctx.log.warn("keeper.idle_no_signer", {
          reason: e.message,
          hint: "set KEEPER_PRIVATE_KEY in .env.local to enable on-chain ticks",
        });
      } else {
        lastError = (e as Error).message;
        ctx.log.error("keeper.tick_failed", { error: lastError });
      }
    }
    await sleep(pollMs);
  }
}

export function requireKeeperSigner(ctx: KeeperContext): `0x${string}` {
  const pk =
    ctx.env.KEEPER_PRIVATE_KEY ??
    (ctx.env.NODE_ENV === "production" ? undefined : ctx.env.API_SIGNER_PRIVATE_KEY);
  if (!pk) {
    throw new KeeperSignerMissingError();
  }
  return pk as `0x${string}`;
}

export function keeperAccount(ctx: KeeperContext): PrivateKeyAccount {
  return privateKeyToAccount(requireKeeperSigner(ctx));
}

export function createKeeperWalletClient(
  ctx: KeeperContext,
  chain: "fuji" | "arc",
): WalletClient {
  const chainId = chain === "fuji" ? 43113 : 5042002;
  return createWalletClient({
    account: keeperAccount(ctx),
    transport: http(getRpcUrl(chainId)),
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
