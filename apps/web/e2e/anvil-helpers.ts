import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Wave E2 — Anvil cheat-code wrappers for the perp e2e suite.
 *
 * Anvil exposes a handful of non-standard JSON-RPC methods that let tests
 * fast-forward time, rewrite storage slots, fund accounts, etc. These
 * helpers are thin wrappers — they exist because every test that wants to
 * push a position into the liquidation band has to reach for at least one
 * of them, and copy-paste of the raw fetch payload was getting ugly.
 *
 * Docs: https://book.getfoundry.sh/reference/anvil/#custom-methods
 *
 * All helpers throw on RPC error. Tests that want to tolerate a failure
 * (e.g. "this Arc fork doesn't accept setStorageAt for the USDC precompile
 * at 0x3600") should wrap the call in try/catch and skip themselves with
 * test.skip() — see perps-liquidation.spec.ts for the pattern.
 */

const DEFAULT_RUNTIME_DIR = resolve(
  process.env.PERPS_E2E_RUNTIME_DIR ?? "./e2e/.anvil-runtime",
);

let cachedRpcUrl: string | null = null;

/**
 * Resolve the anvil RPC URL. Reads `rpc-url.txt` written by global-setup,
 * with PERPS_E2E_RPC_URL as the explicit override (useful if a single
 * dev wants to point the suite at an anvil they're running manually for
 * debugging, e.g. with `anvil --fork-url …` in another terminal).
 *
 * Throws if neither source is available, because every helper here needs
 * a URL — silently defaulting to localhost would hide the misconfiguration.
 */
export function getAnvilRpcUrl(): string {
  if (cachedRpcUrl) return cachedRpcUrl;
  const explicit = process.env.PERPS_E2E_RPC_URL;
  if (explicit) {
    cachedRpcUrl = explicit;
    return explicit;
  }
  const rpcPath = `${DEFAULT_RUNTIME_DIR}/rpc-url.txt`;
  if (!existsSync(rpcPath)) {
    throw new Error(
      `[anvil-helpers] no RPC URL — global-setup did not write ${rpcPath}, ` +
        "and PERPS_E2E_RPC_URL is unset. Did you forget PERPS_E2E_FORK_ARC=1?",
    );
  }
  cachedRpcUrl = readFileSync(rpcPath, "utf8").trim();
  return cachedRpcUrl;
}

interface RpcError {
  code?: number;
  message?: string;
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: RpcError;
}

let rpcCallId = 1;

/**
 * Low-level JSON-RPC caller. Used by every helper below. Surfaces RPC
 * errors as JS Errors with the anvil-supplied message so the assertion
 * failure points at the actual cheat-code problem (e.g. "invalid storage
 * slot" instead of a generic 500).
 */
export async function anvilRpc<T = unknown>(
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const url = getAnvilRpcUrl();
  const id = rpcCallId++;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id }),
  });
  if (!res.ok) {
    throw new Error(
      `[anvil-helpers] ${method} HTTP ${res.status}: ${await res.text()}`,
    );
  }
  const json = (await res.json()) as JsonRpcResponse<T>;
  if (json.error) {
    throw new Error(
      `[anvil-helpers] ${method} RPC error ${json.error.code ?? "?"}: ${
        json.error.message ?? "unknown"
      }`,
    );
  }
  if (json.result === undefined) {
    throw new Error(`[anvil-helpers] ${method} returned no result`);
  }
  return json.result;
}

/**
 * `anvil_setBalance` — Top up an EOA. Useful for the demo trader keys
 * (DEMO_MAKER_PRIVATE_KEY / DEMO_TAKER_PRIVATE_KEY) so they can pay gas
 * for deposit + order intents during the round-trip without first
 * needing a faucet.
 *
 * `amountWei` accepts a bigint OR a hex string. Anvil expects 0x-prefixed
 * hex; we stringify it here so callers can use the bigint literal.
 */
export async function setBalance(
  address: `0x${string}`,
  amountWei: bigint | `0x${string}`,
): Promise<void> {
  const hex =
    typeof amountWei === "bigint" ? `0x${amountWei.toString(16)}` : amountWei;
  await anvilRpc("anvil_setBalance", [address, hex]);
}

/**
 * `anvil_setStorageAt` — Rewrite a single 32-byte storage slot on a
 * contract. The primary use case is forcing a position into the
 * liquidation band: by overwriting the slot that holds the position's
 * `entryPriceE18` (or the oracle mock's `latestPriceE18`) we don't need
 * to wait for natural price movement.
 *
 * Both `slot` and `value` MUST be 32 bytes, 0x-prefixed. The helper does
 * NOT left-pad — callers compute the slot from `keccak256(abi.encode(key,
 * basesSlot))` style derivations and pass the full hash.
 */
export async function setStorageAt(
  address: `0x${string}`,
  slot: `0x${string}`,
  value: `0x${string}`,
): Promise<void> {
  await anvilRpc("anvil_setStorageAt", [address, slot, value]);
}

/**
 * `evm_setNextBlockTimestamp` — Force the next block's timestamp.
 * Used by the liquidation test to fast-forward past the 60s flag delay
 * without sleeping. Anvil enforces monotonicity — `seconds` must be
 * greater than the current block timestamp.
 */
export async function setNextBlockTimestamp(seconds: number): Promise<void> {
  await anvilRpc("evm_setNextBlockTimestamp", [seconds]);
}

/**
 * `evm_mine` — Mine N empty blocks. Combined with setNextBlockTimestamp
 * this is the canonical "advance to time T" pattern. Anvil mines on
 * every transaction by default; this is only needed when no tx has been
 * sent but the test wants chain time to advance.
 */
export async function mineBlocks(count: number = 1): Promise<void> {
  for (let i = 0; i < count; i++) {
    await anvilRpc("evm_mine");
  }
}

/**
 * `anvil_impersonateAccount` — Make anvil sign and submit as an arbitrary
 * address. The matched stop-condition for this helper is "third-party
 * wallet triggers flagAccount on the trader's position" — the test
 * impersonates a random liquidator EOA and fires flagAccount() without
 * needing its private key.
 *
 * Don't forget stopImpersonatingAccount() afterwards — anvil keeps the
 * impersonation until reset, which leaks state between tests.
 */
export async function impersonateAccount(
  address: `0x${string}`,
): Promise<void> {
  await anvilRpc("anvil_impersonateAccount", [address]);
}

export async function stopImpersonatingAccount(
  address: `0x${string}`,
): Promise<void> {
  await anvilRpc("anvil_stopImpersonatingAccount", [address]);
}

/**
 * Plain `eth_chainId`. Tests call this in beforeAll to confirm they're
 * talking to a fork of Arc Testnet (5042002) and not e.g. a stale Anvil
 * that defaulted back to mainnet.
 */
export async function getChainId(): Promise<number> {
  const hex = await anvilRpc<string>("eth_chainId");
  return parseInt(hex, 16);
}

export async function getBlockNumber(): Promise<bigint> {
  const hex = await anvilRpc<string>("eth_blockNumber");
  return BigInt(hex);
}

/**
 * Test the anvil endpoint is reachable. Used by the perps-fixtures
 * beforeAll() to skip the suite gracefully when PERPS_E2E_FORK_ARC=0 (or
 * if anvil crashed mid-suite) instead of throwing a confusing "Connection
 * refused" inside the first test step.
 */
export async function isAnvilReachable(): Promise<boolean> {
  try {
    await getChainId();
    return true;
  } catch {
    return false;
  }
}
