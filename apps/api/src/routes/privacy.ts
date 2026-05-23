/**
 * Privacy Hook read-only API routes.
 *
 * Surface the FxPrivacyEntrypoint's on-chain state (latest merkle root,
 * pool resolution, swap-adapter address) without requiring the client
 * to hold an RPC handle. The full deposit / relay / relayCrossCurrency
 * flow stays client-side because (a) shielded operations require
 * client-generated Groth16 proofs (snarkjs), and (b) any server-mediated
 * proof would leak the user's secret. The API is read-only by design.
 *
 * Next step (out of scope for the initial wiring): wire the UI's
 * `useGhostMode()` hook to call these endpoints + render the privacy
 * pool TVL alongside the public spot/perp surfaces. The
 * @bufi/fx-telarana-sdk's PrivacyTradeClient is the client-side
 * counterpart that handles proof generation.
 */

import { Hono } from "hono";
import { createPublicClient, http, type Address, type Hex } from "viem";

import {
  CHAIN_IDS,
  fxPrivacyEntrypointAbi,
  getContracts,
  getRpcUrl,
} from "@bufi/contracts";

import { jsonSafe } from "../services";

const privacyRoutes = new Hono();

type PrivacyChainKey = "arc" | "fuji";
const CHAIN_BY_KEY: Record<PrivacyChainKey, 5042002 | 43113> = {
  arc: CHAIN_IDS.arcTestnet,
  fuji: CHAIN_IDS.avalancheFuji,
};

function parseChain(value: string | undefined): PrivacyChainKey {
  if (value === "arc" || value === "fuji") return value;
  throw new Error("chain must be 'arc' or 'fuji'");
}

function clientFor(chain: PrivacyChainKey) {
  const chainId = CHAIN_BY_KEY[chain];
  return createPublicClient({ transport: http(getRpcUrl(chainId)) });
}

/**
 * GET /privacy/state?chain=arc|fuji
 *
 * Returns the static contract addresses + live `latestRoot` and (Arc
 * only) the configured `swapAdapter`. UI uses this to render the
 * Ghost Mode pool overview without each consumer rebuilding an RPC.
 */
privacyRoutes.get("/state", async (c) => {
  const chain = parseChain(c.req.query("chain") ?? "arc");
  const chainId = CHAIN_BY_KEY[chain];
  const contracts = getContracts(chainId).privacy;
  if (!contracts.entrypoint) {
    return c.json({ error: `privacy hook not deployed on ${chain}` }, 404);
  }
  const client = clientFor(chain);
  const entrypoint = {
    address: contracts.entrypoint as Address,
    abi: fxPrivacyEntrypointAbi,
  } as const;
  // `owner()` is intentionally omitted — the UUPS proxy doesn't expose
  // it via the standard selector, and the field isn't user-facing. Read
  // the two essentials independently so a transient revert on one
  // doesn't 502 the whole state lookup.
  try {
    const latestRootPromise = client
      .readContract({ ...entrypoint, functionName: "latestRoot" })
      .catch((e) => ({ error: (e as Error).message }));
    const swapAdapterPromise: Promise<Address | null | { error: string }> =
      contracts.swapAdapter
        ? client
            .readContract({ ...entrypoint, functionName: "swapAdapter" })
            .then((v) => v as Address)
            .catch((e) => ({ error: (e as Error).message }))
        : Promise.resolve(null);
    const [latestRoot, configuredSwapAdapter] = await Promise.all([
      latestRootPromise,
      swapAdapterPromise,
    ]);
    return c.json(
      jsonSafe({
        chain,
        chainId,
        addresses: contracts,
        live: {
          latestRoot,
          configuredSwapAdapter,
        },
      }),
    );
  } catch (e) {
    return c.json({ error: `rpc: ${(e as Error).message}` }, 502);
  }
});

/**
 * GET /privacy/pool?chain=arc&scope=<uint256>
 *
 * Resolve a scope (per-asset namespace, derived client-side from the
 * asset+depth+chain triple) to its concrete pool address. Lets the UI
 * lookup pool TVL via standard ERC-20 balanceOf without depending on
 * the entrypoint's internal mapping.
 */
privacyRoutes.get("/pool", async (c) => {
  const chain = parseChain(c.req.query("chain") ?? "arc");
  const scopeRaw = c.req.query("scope");
  if (!scopeRaw) return c.json({ error: "scope required" }, 400);
  let scope: bigint;
  try {
    scope = BigInt(scopeRaw);
  } catch {
    return c.json({ error: "scope must be a uint256 (decimal or 0x-hex)" }, 400);
  }
  const chainId = CHAIN_BY_KEY[chain];
  const contracts = getContracts(chainId).privacy;
  if (!contracts.entrypoint) {
    return c.json({ error: `privacy hook not deployed on ${chain}` }, 404);
  }
  try {
    const pool = (await clientFor(chain).readContract({
      address: contracts.entrypoint as Address,
      abi: fxPrivacyEntrypointAbi,
      functionName: "scopeToPool",
      args: [scope],
    })) as Address;
    return c.json(
      jsonSafe({ chain, chainId, scope: scopeRaw, pool }),
    );
  } catch (e) {
    return c.json({ error: `rpc: ${(e as Error).message}` }, 502);
  }
});

/**
 * GET /privacy/assets?chain=arc|fuji
 *
 * Static listing of which assets have shielded pools on the requested
 * chain. Wraps the address registry so the UI can render the Ghost
 * Mode asset picker without parsing the deployments JSON itself.
 */
privacyRoutes.get("/assets", (c) => {
  const chain = parseChain(c.req.query("chain") ?? "arc");
  const chainId = CHAIN_BY_KEY[chain];
  const contracts = getContracts(chainId);
  const privacy = contracts.privacy;
  const assets: Array<{ symbol: string; token: Hex | undefined; pool: Hex | undefined }> = [];
  if (privacy.poolUSDC && contracts.tokens.usdc) {
    assets.push({ symbol: "USDC", token: contracts.tokens.usdc, pool: privacy.poolUSDC });
  }
  if (privacy.poolEURC && contracts.tokens.eurc) {
    assets.push({ symbol: "EURC", token: contracts.tokens.eurc, pool: privacy.poolEURC });
  }
  return c.json({ chain, chainId, assets, crossCurrencyEnabled: Boolean(privacy.swapAdapter) });
});

export { privacyRoutes };
