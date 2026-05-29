import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { cache } from "@hyper/cache";
import { createPublicClient, http, fallback, formatUnits } from "viem";
import { ARC, contractAddress, tokenAddress } from "../registry/index.ts";

// FxHedgeHook (0x466e…) — the delta-neutral layer. A Uniswap v4 pool with this
// hook keeps the LP delta-neutral by opening offsetting perp exposure; the hook
// exposes the live net delta + a neutrality flag per poolId. This is the surface
// behind the hookathon pitch: a WETH/USDC-style LP stays neutral via a perp.
const ARC_RPC = process.env.ARC_TESTNET_RPC ?? ARC.rpc;
const ARC_RPC_FALLBACK = process.env.ARC_TESTNET_RPC_FALLBACK ?? "https://rpc.testnet.arc.network";
const arcClient = createPublicClient({ transport: fallback([http(ARC_RPC), http(ARC_RPC_FALLBACK)]) });

const HEDGE_HOOK = contractAddress("arc", "lpInsuranceLayer.fxHedgeHook");

// Known hedge pools (from fx-telarana/deployments/fx-hedge-hook-5042002.json).
// poolId = keccak256(abi.encode(PoolKey{currency0,currency1,fee,tickSpacing,hooks})).
const HEDGE_POOLS = [
  {
    symbol: "JPYC",
    poolId: "0xd19440c05e5c0d9549187e01162e8aeab29c196c3177cde6360db740b8aa3504",
    currency0: tokenAddress("arc", "USDC"),
    currency1: "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29",
    fee: 100,
    marketId: "0x848d2b05de70986fa3661af2a50953b537f05066eedc33c18cde1bd12cdd0a2d",
  },
] as const;

const zPoolId = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const hedgeAbi = [
  { type: "function", name: "currentDelta", stateMutability: "view", inputs: [{ name: "poolId", type: "bytes32" }], outputs: [{ type: "int256" }] },
  { type: "function", name: "isDeltaNeutral", stateMutability: "view", inputs: [{ name: "poolId", type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;

const hedgePools = route
  .get("/hedge/pools")
  .use(cache({ maxAge: 300, staleWhileRevalidate: 600 }))
  .meta({ mcp: { title: "Hedge Hook — Pools", description: "Known FxHedgeHook v4 pools (poolId + token pair + fee). poolId = keccak256(abi.encode(PoolKey)). Use a poolId with /api/hedge/status." } })
  .output(z.object({ hook: z.string(), chainId: z.number(), pools: z.array(z.object({ symbol: z.string(), poolId: z.string(), currency0: z.string(), currency1: z.string(), fee: z.number(), marketId: z.string() })), note: z.string() }))
  .handle(async () =>
    ok({ hook: HEDGE_HOOK, chainId: ARC.chainId, pools: HEDGE_POOLS.map((p) => ({ ...p })), note: "Delta-neutral LP pools. Query /api/hedge/status?poolId=<id> for live net delta + neutrality." }),
  );

const hedgeStatus = route
  .get("/hedge/status")
  .query(z.object({ poolId: zPoolId }))
  .meta({ mcp: { title: "Hedge Hook — Delta Status", description: "Live net delta (int256, signed; 0 = neutral) + isDeltaNeutral flag for a hedged pool. The delta-neutral guarantee the LP relies on; non-zero delta = unhedged exposure." } })
  .output(z.object({ hook: z.string(), poolId: z.string(), currentDelta: z.string().optional(), isDeltaNeutral: z.boolean().optional(), known: z.boolean(), error: z.string().optional() }))
  .handle(async ({ query }) => {
    const known = HEDGE_POOLS.some((p) => p.poolId.toLowerCase() === query.poolId.toLowerCase());
    try {
      const [delta, neutral] = await Promise.all([
        arcClient.readContract({ address: HEDGE_HOOK, abi: hedgeAbi, functionName: "currentDelta", args: [query.poolId as `0x${string}`] }) as Promise<bigint>,
        arcClient.readContract({ address: HEDGE_HOOK, abi: hedgeAbi, functionName: "isDeltaNeutral", args: [query.poolId as `0x${string}`] }) as Promise<boolean>,
      ]);
      return ok({ hook: HEDGE_HOOK, poolId: query.poolId, currentDelta: delta.toString(), isDeltaNeutral: neutral, known });
    } catch (e) {
      return ok({ hook: HEDGE_HOOK, poolId: query.poolId, known, error: `read reverted: ${String(e).slice(0, 140)} (poolId may be unconfigured on this hook)` });
    }
  });

const hedgeUnpause = route
  .post("/hedge/unpause")
  .body(z.object({ poolId: zPoolId }))
  .meta({ mcp: { title: "Hedge Hook — Prepare Unpause", description: "Prepare an unsigned FxHedgeHook.unpauseHedge(poolId) call. OWNER-GATED (POOL_CONFIGURATOR_ROLE) — only the role holder can execute. PREPARE only; you sign." } })
  .output(z.object({ action: z.literal("hedge_unpause"), hook: z.string(), contract: z.object({ address: z.string(), function: z.string(), args: z.record(z.string()) }), chainId: z.number(), authNote: z.string() }))
  .handle(async ({ body }) =>
    ok({ action: "hedge_unpause", hook: HEDGE_HOOK, contract: { address: HEDGE_HOOK, function: "unpauseHedge(bytes32 poolId)", args: { poolId: body.poolId } }, chainId: ARC.chainId, authNote: "Reverts unless msg.sender holds POOL_CONFIGURATOR_ROLE on the hook. This prepare returns the call only; execution requires the role." }),
  );

export default new Hyper({ prefix: "/api" }).use([hedgePools, hedgeStatus, hedgeUnpause]);
