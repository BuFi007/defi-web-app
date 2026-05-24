/**
 * Wave N7c — Gateway attestation rotation keeper.
 *
 * Stacks on N2c (the one-shot CLI at `src/mint-attestation.ts`). N6 had to
 * re-mint the demo attestation manually because the first one (minted at
 * Fuji block 43_390_606, ~24h TTL) had expired. This keeper closes that
 * gap: it boots, scans every `attestations/*.json` artefact written by the
 * N2c CLI, and re-mints any whose `expirationBlock` minus the current
 * Fuji block is less than `GATEWAY_ROTATION_BUFFER_BLOCKS` (default 10_800
 * ≈ 6h at 2s blocks).
 *
 * Mirrors N2b's `apps/keeper-pyth` pattern:
 *   - Bun-native entry (no transpile)
 *   - Dual mode: dry-run when no signer key, full-run when set
 *   - `runKeeper` wrapper from `@bufi/keeper-runtime` (hooks tick into
 *     OTel + the health-port plumbing the rest of the keeper fleet uses)
 *   - Dedicated health endpoint on :9101 (the `KEEPER_GATEWAY_SIGNER_HEALTH_PORT`
 *     resolved by `@bufi/keeper-runtime`'s `resolveHealthPort`).
 *
 * Env (read directly via process.env; not promoted into the Zod schema
 * because these are keeper-only and the schema is shared with web/api):
 *
 *   GATEWAY_KEEPER_PRIVATE_KEY        Overrides KEEPER_PRIVATE_KEY if set
 *                                     (mirrors the dual-key pattern N2b
 *                                     uses for the Pyth keeper).
 *   GATEWAY_KEEPER_HEALTH_PORT        Default 9101.
 *   GATEWAY_ROTATION_BUFFER_BLOCKS    Default 10_800 (~6h on Fuji).
 *   GATEWAY_KEEPER_INTERVAL_MS        Default 300_000 (5 min). Two-minute
 *                                     slack against the rotation buffer.
 *   CIRCLE_GATEWAY_API_URL            Alias for GATEWAY_API_BASE used by
 *                                     N2c. Either works; we read both.
 *
 * Safety:
 *   - Private key is read from env only. Never logged. Never persisted.
 *   - Each rotation call uses N2c's `mintAttestation()` which already has
 *     a 60s deadline + 3-attempt exponential backoff per network call.
 *   - On rotation failure the tick records the error and the next tick
 *     retries (no manual intervention required for transient HTTP errors).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getRpcUrl } from "@bufi/contracts";
import { runKeeper } from "@bufi/keeper-runtime";
import {
  createPublicClient,
  type Address,
  type Hex,
  http,
} from "viem";

import { mintAttestation } from "./mint-attestation";

// ───────────────────────── constants ───────────────────────────────────

const FUJI_CHAIN_ID = 43_113 as const;

// ~6h at Fuji's nominal 2s block time = 10_800 blocks. The N2c artefact
// shows a 24h-ish TTL (`expirationBlock - mintBlock` ~ 43_200 blocks),
// so a 6h buffer keeps each attestation fresh for 18h of nominal use
// before the keeper rotates it.
const DEFAULT_ROTATION_BUFFER_BLOCKS = 10_800n;

// 5 min default — two-minute slack against the rotation buffer. A keeper
// outage of up to (buffer - interval) = ~6h - 5m still rotates in time.
const DEFAULT_INTERVAL_MS = 300_000;

const DEFAULT_HEALTH_PORT = 9101;

// Minimum wall-clock gap between two rotations of the SAME label. Circle
// charges ~0.020005 USDC per /transfer call, so a runaway loop (e.g. the
// `expirationBlock` field stays "expired" indefinitely because we're
// comparing against the wrong block clock — see the comment in tickOnce)
// would burn $5.76/day at the default 5min cadence. This per-label cooldown
// caps that exposure at ~$0.30/day per label. Override via
// `GATEWAY_KEEPER_MIN_REMINT_MS`; default 1h.
const DEFAULT_MIN_REMINT_MS = 3_600_000;

// ───────────────────────── types ───────────────────────────────────────

interface AttestationArtefact {
  /** Filename stem (without `.json`). Matches `--label` in the N2c CLI. */
  label: string;
  /** Absolute path to the artefact on disk. */
  path: string;
  /** Source-chain (Fuji) block at which Circle will reject this attestation. */
  expirationBlock: bigint | null;
  /** Destination domain (Circle's domain table; 26 = Arc Testnet). */
  destinationDomain: number;
  /** Destination chain id (5042002 = Arc Testnet). */
  destinationChainId: number;
  /** Destination recipient address (20-byte EVM). */
  destinationRecipient: Address;
  /** Destination caller address (20-byte EVM). */
  destinationCaller: Address;
  /** Raw USDC amount (6-decimals, e.g. "100000" = 0.1 USDC). */
  amountRaw: string;
  /** Raw USDC max-fee. */
  maxFeeRaw: string;
  /** Circle API base URL used at mint time. */
  apiBase: string;
  /** ISO timestamp the artefact was last written. */
  mintedAt: string;
}

interface RotationLogEntry {
  label: string;
  rotatedAt: string;
  prevExpiration: string | null;
  newExpiration: string | null;
  transferId: string | null;
  feeUsdc: string | null;
}

// ───────────────────────── helpers ─────────────────────────────────────

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function envBigInt(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) return fallback;
  try {
    return BigInt(raw);
  } catch {
    return fallback;
  }
}

function resolveSignerKey(): Hex | null {
  const raw = process.env.GATEWAY_KEEPER_PRIVATE_KEY ?? process.env.KEEPER_PRIVATE_KEY;
  if (!raw) return null;
  const pk = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) {
    // Don't echo the bad value — just refuse.
    throw new Error(
      "GATEWAY_KEEPER_PRIVATE_KEY / KEEPER_PRIVATE_KEY must be 0x + 64 hex chars",
    );
  }
  return pk as Hex;
}

function attestationsDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, "..", "attestations");
}

function readArtefacts(): AttestationArtefact[] {
  const dir = attestationsDir();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: AttestationArtefact[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const path = resolve(dir, name);
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const j = parsed as Record<string, unknown>;
    const circleResponse =
      j.circleResponse && typeof j.circleResponse === "object"
        ? (j.circleResponse as Record<string, unknown>)
        : null;
    const expRaw = circleResponse?.expirationBlock;
    let expirationBlock: bigint | null = null;
    if (typeof expRaw === "string" && /^\d+$/.test(expRaw)) {
      expirationBlock = BigInt(expRaw);
    } else if (typeof expRaw === "number" && Number.isFinite(expRaw)) {
      expirationBlock = BigInt(expRaw);
    }
    out.push({
      label: name.slice(0, -".json".length),
      path,
      expirationBlock,
      destinationDomain:
        typeof j.destinationDomain === "number" ? j.destinationDomain : 26,
      destinationChainId:
        typeof j.destinationChain === "number" ? j.destinationChain : 5_042_002,
      destinationRecipient: (typeof j.destinationRecipient === "string"
        ? j.destinationRecipient
        : "0x0000000000000000000000000000000000000000") as Address,
      destinationCaller: (typeof j.destinationCaller === "string"
        ? j.destinationCaller
        : "0x0000000000000000000000000000000000000000") as Address,
      amountRaw: typeof j.amountUsdc === "string" ? j.amountUsdc : "0",
      maxFeeRaw: typeof j.maxFee === "string" ? j.maxFee : "2010000",
      apiBase:
        typeof j.apiBase === "string"
          ? j.apiBase
          : (process.env.GATEWAY_API_BASE ??
            process.env.CIRCLE_GATEWAY_API_URL ??
            "https://gateway-api-testnet.circle.com/v1"),
      mintedAt: typeof j.mintedAt === "string" ? j.mintedAt : "",
    });
  }
  // Stable ordering so health-endpoint output is reproducible.
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/** Convert a raw 6-dec USDC string back to a decimal string (e.g. "100000" → "0.1"). */
function rawUsdcToDecimal(raw: string): string {
  if (!/^\d+$/.test(raw)) return raw;
  const n = BigInt(raw);
  const denom = 1_000_000n;
  const whole = n / denom;
  const frac = n % denom;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr}`;
}

// ───────────────────────── shared state for /health ────────────────────

const state = {
  bootAt: new Date().toISOString(),
  signerConfigured: false,
  lastTickAt: null as string | null,
  lastTickError: null as string | null,
  lastFujiBlock: null as bigint | null,
  rotations: [] as RotationLogEntry[],
  artefacts: [] as AttestationArtefact[],
  rotationBufferBlocks: DEFAULT_ROTATION_BUFFER_BLOCKS,
  intervalMs: DEFAULT_INTERVAL_MS,
};

function snapshotForHealth() {
  const buf = state.rotationBufferBlocks;
  const current = state.lastFujiBlock;
  const attestations = state.artefacts.map((a) => {
    const blocksRemaining =
      a.expirationBlock !== null && current !== null
        ? a.expirationBlock - current
        : null;
    const dueForRotation =
      blocksRemaining !== null ? blocksRemaining < buf : null;
    return {
      label: a.label,
      destinationDomain: a.destinationDomain,
      destinationChainId: a.destinationChainId,
      destinationRecipient: a.destinationRecipient,
      amountUsdc: rawUsdcToDecimal(a.amountRaw),
      expirationBlock:
        a.expirationBlock !== null ? a.expirationBlock.toString() : null,
      blocksRemaining:
        blocksRemaining !== null ? blocksRemaining.toString() : null,
      dueForRotation,
      mintedAt: a.mintedAt || null,
      apiBase: a.apiBase,
    };
  });
  // Next rotation ETA = closest (positive) `blocksRemaining - buffer` *
  // 2s/block, in seconds from now. null when we have no live block yet
  // or no artefact is on track to expire.
  let nextRotationEtaSec: number | null = null;
  for (const a of state.artefacts) {
    if (a.expirationBlock === null || current === null) continue;
    const remaining = a.expirationBlock - current;
    const untilRotation = remaining - buf;
    const secs = Number(untilRotation) * 2; // ~2s/block on Fuji
    if (secs <= 0) {
      nextRotationEtaSec = 0;
      break;
    }
    if (nextRotationEtaSec === null || secs < nextRotationEtaSec) {
      nextRotationEtaSec = secs;
    }
  }
  const lastRotation = state.rotations[state.rotations.length - 1] ?? null;
  return {
    ok: state.lastTickError === null,
    bootAt: state.bootAt,
    signerConfigured: state.signerConfigured,
    lastTickAt: state.lastTickAt,
    lastTickError: state.lastTickError,
    lastMint: lastRotation?.rotatedAt ?? null,
    lastTxId: lastRotation?.transferId ?? null,
    nextRotationEta:
      nextRotationEtaSec === null
        ? null
        : new Date(Date.now() + nextRotationEtaSec * 1000).toISOString(),
    currentBlocks: {
      fuji: current !== null ? current.toString() : null,
    },
    rotationBufferBlocks: buf.toString(),
    intervalMs: state.intervalMs,
    attestations,
    recentRotations: state.rotations.slice(-5),
  };
}

// ───────────────────────── health endpoint ─────────────────────────────
//
// Bun.serve mirrors `apps/keeper-pyth`'s pattern (via
// @bufi/keeper-runtime/startHealthServer) but exposes a richer payload at
// `:9101/health`. We start our OWN Bun.serve here (rather than rely on
// the runtime's port plumbing) because the brief asks for `:9101` by
// default + a custom JSON shape with `attestations[]`.
function startHealthServer(port: number) {
  Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        const snap = snapshotForHealth();
        return Response.json(snap, { status: snap.ok ? 200 : 503 });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

// ───────────────────────── tick ────────────────────────────────────────

// Map of label → last rotation epoch ms. Used to enforce the per-label
// cooldown (see DEFAULT_MIN_REMINT_MS).
const lastRotatedAt = new Map<string, number>();

async function tickOnce(opts: {
  signerKey: Hex;
  rotationBuffer: bigint;
  minRemintMs: number;
}): Promise<void> {
  // Re-read artefacts each tick so a fresh mint (CLI or prior tick) is
  // picked up without restarting the keeper.
  state.artefacts = readArtefacts();

  // Use @bufi/contracts getRpcUrl so we honour AVALANCHE_FUJI_RPC_URL +
  // the hardcoded PublicNode fallback. Don't pass a `chain` — viem will
  // accept block lookups via the RPC's chainId without it, and binding
  // viem/chains.avalancheFuji would override our env-pinned RPC.
  const fujiPublic = createPublicClient({
    transport: http(getRpcUrl(FUJI_CHAIN_ID)),
  });
  const blockNumber = await fujiPublic.getBlockNumber();
  state.lastFujiBlock = blockNumber;

  for (const artefact of state.artefacts) {
    if (artefact.expirationBlock === null) {
      console.warn(
        `[gateway-keeper] artefact ${artefact.label} has no expirationBlock — skipping (re-mint manually)`,
      );
      continue;
    }
    const remaining = artefact.expirationBlock - blockNumber;
    if (remaining >= opts.rotationBuffer) {
      // Plenty of TTL left.
      continue;
    }
    // NOTE on block-clock mismatch: Circle Gateway's `expirationBlock` is
    // returned as a number that is NOT the current Fuji RPC block height.
    // Smoke testing N7c showed Circle reports ~43.5M while Fuji's
    // `eth_blockNumber` returns ~55.6M (a ~12M-block / ~278-day drift at
    // 2s/block). The N2c README assumed they were comparable. Until that's
    // re-spec'd (probably querying Circle's own block clock via /balances
    // or a Circle attestation endpoint), the `expirationBlock < currentFuji`
    // comparison ALWAYS triggers — which is why we gate on `lastRotatedAt`
    // to prevent runaway re-mints. See README "Block-clock caveat" section.
    const sinceLast = Date.now() - (lastRotatedAt.get(artefact.label) ?? 0);
    if (sinceLast < opts.minRemintMs) {
      console.warn(
        `[gateway-keeper] ${artefact.label} due for rotation but last re-mint was ${Math.round(sinceLast / 1000)}s ago (< ${opts.minRemintMs}ms cooldown) — skipping to cap fee burn`,
      );
      continue;
    }
    console.log(
      `[gateway-keeper] rotating ${artefact.label} (remaining=${remaining.toString()} blocks, buffer=${opts.rotationBuffer.toString()})`,
    );
    lastRotatedAt.set(artefact.label, Date.now());
    const result = await mintAttestation({
      label: artefact.label,
      destinationDomain: artefact.destinationDomain,
      destinationChainId: artefact.destinationChainId,
      destinationRecipient: artefact.destinationRecipient,
      destinationCaller: artefact.destinationCaller,
      amountUsdc: rawUsdcToDecimal(artefact.amountRaw),
      maxFeeUsdc: rawUsdcToDecimal(artefact.maxFeeRaw),
      apiBase: artefact.apiBase,
      privateKey: opts.signerKey,
      silentEnvBanner: true,
    });
    const entry: RotationLogEntry = {
      label: result.label,
      rotatedAt: new Date().toISOString(),
      prevExpiration: artefact.expirationBlock.toString(),
      newExpiration:
        result.expirationBlock !== null ? result.expirationBlock.toString() : null,
      transferId: result.transferId,
      feeUsdc: result.feeUsdc,
    };
    state.rotations.push(entry);
    // Keep the rotation log bounded (last 50). Plenty for the health endpoint.
    if (state.rotations.length > 50) state.rotations.shift();
    console.log("[gateway-keeper] gateway.rotated", entry);
  }
}

// ───────────────────────── boot ────────────────────────────────────────

const healthPort = envNumber("GATEWAY_KEEPER_HEALTH_PORT", DEFAULT_HEALTH_PORT);
const rotationBuffer = envBigInt(
  "GATEWAY_ROTATION_BUFFER_BLOCKS",
  DEFAULT_ROTATION_BUFFER_BLOCKS,
);
const intervalMs = envNumber("GATEWAY_KEEPER_INTERVAL_MS", DEFAULT_INTERVAL_MS);
const minRemintMs = envNumber(
  "GATEWAY_KEEPER_MIN_REMINT_MS",
  DEFAULT_MIN_REMINT_MS,
);

state.rotationBufferBlocks = rotationBuffer;
state.intervalMs = intervalMs;
state.artefacts = readArtefacts();

let signerKey: Hex | null = null;
try {
  signerKey = resolveSignerKey();
} catch (e) {
  console.error(`[gateway-keeper] ${(e as Error).message}`);
  process.exit(1);
}
state.signerConfigured = signerKey !== null;

startHealthServer(healthPort);

console.log("[gateway-keeper] boot", {
  healthPort,
  rotationBufferBlocks: rotationBuffer.toString(),
  intervalMs,
  minRemintMs,
  attestations: state.artefacts.length,
  signerConfigured: state.signerConfigured,
});

if (!signerKey) {
  console.log(
    `[gateway-keeper] GATEWAY_KEEPER_PRIVATE_KEY not configured — dry-run mode; would rotate ${state.artefacts.length} attestation(s) on next tick`,
  );
  // Still serve /health for ops; no tick loop. We exit 0 per the brief
  // ("dry-run mode; ... exit 0"). The health server keeps the process
  // alive for the smoke test if needed via a one-shot probe before exit;
  // production deploys MUST supply the signer key.
  // (Bun.serve doesn't pin the event loop here — let the process drain.)
  process.exit(0);
}

// Honour KEEPER_POLL_MS via the runtime's interval — but the brief asks
// for an explicit GATEWAY_KEEPER_INTERVAL_MS. We export it as
// KEEPER_POLL_MS for `runKeeper` to pick up (the schema reads from
// process.env at first call). Set it BEFORE @bufi/env caches.
if (process.env.KEEPER_POLL_MS === undefined) {
  process.env.KEEPER_POLL_MS = String(intervalMs);
}

await runKeeper({
  name: "@bufi/keeper-gateway-signer",
  async tick() {
    try {
      await tickOnce({
        signerKey: signerKey as Hex,
        rotationBuffer,
        minRemintMs,
      });
      state.lastTickAt = new Date().toISOString();
      state.lastTickError = null;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      state.lastTickError = msg;
      state.lastTickAt = new Date().toISOString();
      throw e; // let runKeeper log it via keeper.tick_failed
    }
  },
});
