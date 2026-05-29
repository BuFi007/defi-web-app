import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { cache } from "@hyper/cache";
import { createPublicClient, http, fallback } from "viem";
import { ARC, contractAddress, tokenAddress } from "../registry/index.ts";

// On-chain protocol registries — the canonical discovery surface:
//   AssetRegistry (0x7618…) — registered assets + per-chain addresses
//   PoolRegistry  (0x05B7…) — best/all swap routes per token pair
const ARC_RPC = process.env.ARC_TESTNET_RPC ?? ARC.rpc;
const ARC_RPC_FALLBACK = process.env.ARC_TESTNET_RPC_FALLBACK ?? "https://rpc.testnet.arc.network";
const arcClient = createPublicClient({ transport: fallback([http(ARC_RPC), http(ARC_RPC_FALLBACK)]) });

const ASSET_REGISTRY = contractAddress("arc", "registry.assetRegistry");
const POOL_REGISTRY = contractAddress("arc", "registry.poolRegistry");

const assetCfg = { type: "tuple", components: [
  { name: "symbol", type: "string" }, { name: "decimals", type: "uint8" },
  { name: "strategy", type: "uint8" }, { name: "liquidityHomeChainId", type: "uint256" }, { name: "enabled", type: "bool" },
] } as const;
const routeTuple = { type: "tuple", components: [
  { name: "venue", type: "uint8" }, { name: "pool", type: "address" }, { name: "poolKey", type: "bytes32" },
  { name: "targetChainId", type: "uint256" }, { name: "spreadBps", type: "uint16" }, { name: "enabled", type: "bool" }, { name: "preferred", type: "bool" },
] } as const;
const assetRegistryAbi = [
  { type: "function", name: "assetCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "listAssets", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32[]" }] },
  { type: "function", name: "getAsset", stateMutability: "view", inputs: [{ name: "key", type: "bytes32" }], outputs: [assetCfg] },
  { type: "function", name: "tokenAddressOnChain", stateMutability: "view", inputs: [{ name: "symbol", type: "string" }, { name: "chainId", type: "uint256" }], outputs: [{ type: "address" }] },
] as const;
const poolRegistryAbi = [
  { type: "function", name: "routeCount", stateMutability: "view", inputs: [{ name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allRoutes", stateMutability: "view", inputs: [{ name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }], outputs: [{ type: "tuple[]", components: routeTuple.components }] },
] as const;

const registryAssets = route
  .get("/registry/assets")
  .use(cache({ maxAge: 120, staleWhileRevalidate: 300 }))
  .meta({ mcp: { title: "Asset Registry — Registered Assets", description: "All assets registered in the on-chain AssetRegistry: symbol, decimals, bridge strategy, home chain, enabled flag. The canonical asset list for the protocol." } })
  .output(z.object({ assetRegistry: z.string(), chainId: z.number(), count: z.number(), assets: z.array(z.object({ key: z.string(), symbol: z.string(), decimals: z.number(), strategyId: z.number(), liquidityHomeChainId: z.number(), enabled: z.boolean() })), truncated: z.boolean() }))
  .handle(async () => {
    let keys: readonly `0x${string}`[] = [];
    try { keys = (await arcClient.readContract({ address: ASSET_REGISTRY, abi: assetRegistryAbi, functionName: "listAssets" })) as readonly `0x${string}`[]; } catch {}
    const slice = keys.slice(0, 50);
    const assets = [] as Array<{ key: string; symbol: string; decimals: number; strategyId: number; liquidityHomeChainId: number; enabled: boolean }>;
    for (const key of slice) {
      try {
        const c = (await arcClient.readContract({ address: ASSET_REGISTRY, abi: assetRegistryAbi, functionName: "getAsset", args: [key] })) as { symbol: string; decimals: number; strategy: number; liquidityHomeChainId: bigint; enabled: boolean };
        assets.push({ key, symbol: c.symbol, decimals: Number(c.decimals), strategyId: Number(c.strategy), liquidityHomeChainId: Number(c.liquidityHomeChainId), enabled: c.enabled });
      } catch { assets.push({ key, symbol: "?", decimals: 0, strategyId: 0, liquidityHomeChainId: 0, enabled: false }); }
    }
    return ok({ assetRegistry: ASSET_REGISTRY, chainId: ARC.chainId, count: keys.length, assets, truncated: keys.length > 50 });
  });

const registryAssetAddress = route
  .get("/registry/asset-address")
  .query(z.object({ symbol: z.string().regex(/^[A-Za-z]{2,10}$/), chainId: z.coerce.number().int().positive() }))
  .meta({ mcp: { title: "Asset Registry — Resolve Address", description: "Resolve a symbol → token address on a given chainId via AssetRegistry.tokenAddressOnChain (e.g. symbol=EURC, chainId=5042002)." } })
  .output(z.object({ symbol: z.string(), chainId: z.number(), address: z.string().nullable(), error: z.string().optional() }))
  .handle(async ({ query }) => {
    try {
      const addr = (await arcClient.readContract({ address: ASSET_REGISTRY, abi: assetRegistryAbi, functionName: "tokenAddressOnChain", args: [query.symbol, BigInt(query.chainId)] })) as `0x${string}`;
      const isZero = /^0x0+$/.test(addr);
      return ok({ symbol: query.symbol, chainId: query.chainId, address: isZero ? null : addr, ...(isZero ? { error: "not registered on that chain" } : {}) });
    } catch (e) { return ok({ symbol: query.symbol, chainId: query.chainId, address: null, error: String(e).slice(0, 120) }); }
  });

const registryRoutes = route
  .get("/registry/routes")
  .query(z.object({ in: z.string().regex(/^[A-Za-z]{2,10}$/), out: z.string().regex(/^[A-Za-z]{2,10}$/) }))
  .meta({ mcp: { title: "Pool Registry — Swap Routes", description: "On-chain swap routes for a token pair from PoolRegistry (venue, pool, poolKey, spread, enabled, preferred). Pass symbols, e.g. in=USDC&out=EURC." } })
  .output(z.object({ poolRegistry: z.string(), tokenIn: z.string(), tokenOut: z.string(), count: z.number(), routes: z.array(z.object({ venueId: z.number(), pool: z.string(), poolKey: z.string(), targetChainId: z.number(), spreadBps: z.number(), enabled: z.boolean(), preferred: z.boolean() })), error: z.string().optional() }))
  .handle(async ({ query }) => {
    let tin: `0x${string}`, tout: `0x${string}`;
    try { tin = tokenAddress("arc", query.in); tout = tokenAddress("arc", query.out); }
    catch (e) { return ok({ poolRegistry: POOL_REGISTRY, tokenIn: query.in, tokenOut: query.out, count: 0, routes: [], error: e instanceof Error ? e.message : String(e) }); }
    try {
      const raw = (await arcClient.readContract({ address: POOL_REGISTRY, abi: poolRegistryAbi, functionName: "allRoutes", args: [tin, tout] })) as readonly { venue: number; pool: string; poolKey: string; targetChainId: bigint; spreadBps: number; enabled: boolean; preferred: boolean }[];
      const routes = raw.map((r) => ({ venueId: Number(r.venue), pool: r.pool, poolKey: r.poolKey, targetChainId: Number(r.targetChainId), spreadBps: Number(r.spreadBps), enabled: r.enabled, preferred: r.preferred }));
      return ok({ poolRegistry: POOL_REGISTRY, tokenIn: tin, tokenOut: tout, count: routes.length, routes });
    } catch (e) { return ok({ poolRegistry: POOL_REGISTRY, tokenIn: tin, tokenOut: tout, count: 0, routes: [], error: `read reverted: ${String(e).slice(0, 120)}` }); }
  });

export default new Hyper({ prefix: "/api" }).use([registryAssets, registryAssetAddress, registryRoutes]);
