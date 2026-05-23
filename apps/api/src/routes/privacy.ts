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
 * Full per-asset privacy registry. Mirrors the `registry` array in
 * `fx-telarana/deployments/privacy-hook-{network}.json`. Includes:
 *   - Live pools (status="live") with their on-chain pool address +
 *     minimumDeposit + maxRelayFeeBPS from the deployment registry.
 *   - Pending pools (status="pending") for issued tokens that don't
 *     yet have a shielded pool deployed — the UI shows them as
 *     "coming soon" rather than hiding the surface.
 *   - Cross-currency routes (`routes` array) — pairs the swap adapter
 *     supports today (`USDC ↔ EURC` on Arc, none on Fuji). UI uses
 *     this to render the cross-currency relay selector.
 */
interface PrivacyAssetEntry {
  symbol: string;
  token: Hex | undefined;
  pool: Hex | undefined;
  status: "live" | "pending";
  minimumDeposit?: string;
  minimumDepositHumanReadable?: string;
  maxRelayFeeBPS?: string;
  vettingFeeBPS?: string;
}

interface PrivacyRouteEntry {
  from: string;
  to: string;
  rate: string;
  rateHumanReadable: string;
}

const ARC_PRIVACY_REGISTRY: PrivacyAssetEntry[] = [
  {
    symbol: "USDC",
    token: "0x3600000000000000000000000000000000000000",
    pool: "0xc11c216c9c7a36848b1d4276d223160c8b51988f",
    status: "live",
    minimumDeposit: "1000000",
    minimumDepositHumanReadable: "1 USDC",
    vettingFeeBPS: "0",
    maxRelayFeeBPS: "500",
  },
  {
    symbol: "EURC",
    token: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    pool: "0x7B4582CDE65c8cC00fE24B16dBA60472242d234c",
    status: "live",
    minimumDeposit: "1000000",
    minimumDepositHumanReadable: "1 EURC",
    vettingFeeBPS: "0",
    maxRelayFeeBPS: "500",
  },
  // Issued issuer tokens with no shielded pool deployed yet. The
  // entries are kept so the UI surface "see all issuables I'd
  // eventually shield" — flip status to "live" + populate `pool`
  // when fx-telarana deploys the per-asset pool.
  {
    symbol: "MXNB",
    token: "0x836F73Fbc370A9329Ba4957E47912DfDBA6BA461",
    pool: undefined,
    status: "pending",
  },
  {
    symbol: "QCAD",
    token: "0x23d7CFFd0876f3ABb6B074287ba2aeefBc83825d",
    pool: undefined,
    status: "pending",
  },
  {
    symbol: "cirBTC",
    token: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
    pool: undefined,
    status: "pending",
  },
  {
    symbol: "AUDF",
    token: "0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b",
    pool: undefined,
    status: "pending",
  },
];

const ARC_PRIVACY_ROUTES: PrivacyRouteEntry[] = [
  {
    from: "USDC",
    to: "EURC",
    rate: "920000000000000000",
    rateHumanReadable: "1 USDC → 0.92 EURC",
  },
  {
    from: "EURC",
    to: "USDC",
    rate: "1080000000000000000",
    rateHumanReadable: "1 EURC → 1.08 USDC",
  },
];

const FUJI_PRIVACY_REGISTRY: PrivacyAssetEntry[] = [
  {
    symbol: "USDC",
    token: "0x5425890298aed601595a70AB815c96711a31Bc65",
    pool: "0xc490be46d2b87b92f146ab4dd907784d9658ec7f",
    status: "live",
    minimumDeposit: "1000000",
    minimumDepositHumanReadable: "1 USDC",
    vettingFeeBPS: "0",
    maxRelayFeeBPS: "500",
  },
  // EURC + MXNB privacy pools are deferred on Fuji per the
  // privacy-hook-fuji.json notes ("EURC deferred (MockEURC not
  // user-acquirable). MXNB deferred (privacy branch lineage pre-Stage 6)").
  {
    symbol: "EURC",
    token: undefined,
    pool: undefined,
    status: "pending",
  },
  {
    symbol: "MXNB",
    token: undefined,
    pool: undefined,
    status: "pending",
  },
];

privacyRoutes.get("/assets", (c) => {
  const chain = parseChain(c.req.query("chain") ?? "arc");
  const chainId = CHAIN_BY_KEY[chain];
  const contracts = getContracts(chainId).privacy;
  const assets = chain === "arc" ? ARC_PRIVACY_REGISTRY : FUJI_PRIVACY_REGISTRY;
  const routes = chain === "arc" ? ARC_PRIVACY_ROUTES : [];
  const livePoolCount = assets.filter((a) => a.status === "live").length;
  const pendingPoolCount = assets.length - livePoolCount;
  return c.json({
    chain,
    chainId,
    assets,
    routes,
    crossCurrencyEnabled: Boolean(contracts.swapAdapter),
    crossCurrencyAdapter: contracts.swapAdapter ?? null,
    summary: {
      live: livePoolCount,
      pending: pendingPoolCount,
      total: assets.length,
    },
  });
});

export { privacyRoutes };
