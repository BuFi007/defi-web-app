import { getRpcUrl } from "@bufi/contracts";
import { serverEnv } from "@bufi/env";
import { createLogger, type Logger } from "@bufinance/logger";
import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

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

export function createKeeperContext(name: string): KeeperContext {
  const env = serverEnv();
  return {
    name,
    env,
    log: createLogger({ prefix: name }),
    clients: {
      fuji: createPublicClient({ transport: http(getRpcUrl(43113)) }),
      arc: createPublicClient({ transport: http(getRpcUrl(5042002)) }),
    },
  };
}

export async function runKeeper(def: KeeperDefinition): Promise<void> {
  const ctx = createKeeperContext(def.name);
  const pollMs = ctx.env.KEEPER_POLL_MS;
  let lastOkAt = 0;
  let lastError: string | null = null;

  if (ctx.env.PORT) {
    Bun.serve({
      port: ctx.env.PORT,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health") {
          return Response.json({
            ok: lastError === null,
            app: def.name,
            lastOkAt,
            lastError,
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
  }

  ctx.log.info("keeper.boot", { pollMs, port: ctx.env.PORT ?? null });
  for (;;) {
    const started = Date.now();
    try {
      await def.tick(ctx);
      lastOkAt = Math.floor(Date.now() / 1000);
      lastError = null;
      ctx.log.debug("keeper.tick", { ms: Date.now() - started });
    } catch (e) {
      lastError = (e as Error).message;
      ctx.log.error("keeper.tick_failed", { error: lastError });
    }
    await sleep(pollMs);
  }
}

export function requireKeeperSigner(ctx: KeeperContext): `0x${string}` {
  const pk =
    ctx.env.KEEPER_PRIVATE_KEY ??
    (ctx.env.NODE_ENV === "production" ? undefined : ctx.env.API_SIGNER_PRIVATE_KEY);
  if (!pk) {
    throw new Error("KEEPER_PRIVATE_KEY is required for on-chain keeper mutations");
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
