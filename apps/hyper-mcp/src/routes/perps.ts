import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { cache } from "@hyper/cache";
import { createPublicClient, http, fallback, formatUnits } from "viem";
import { ARC, contractAddress } from "../registry/index.ts";

// Perps clearinghouse reads + liquidation + cross-hub gateway status.
const ARC_RPC = process.env.ARC_TESTNET_RPC ?? ARC.rpc;
const ARC_RPC_FALLBACK = process.env.ARC_TESTNET_RPC_FALLBACK ?? "https://rpc.testnet.arc.network";
const arcClient = createPublicClient({ transport: fallback([http(ARC_RPC), http(ARC_RPC_FALLBACK)]) });

const MARGIN = contractAddress("arc", "perps.fxMarginAccount");
const HEALTH = contractAddress("arc", "perps.fxHealthChecker");
const FUNDING = contractAddress("arc", "perps.fxFundingEngine");
const LIQ_ROUTER = contractAddress("arc", "lending.liquidationRouter");
const GATEWAY = contractAddress("arc", "gateway.fxGatewayHook");

const zAddr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const zBytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const marginAbi = [
  { type: "function", name: "marginOf", stateMutability: "view", inputs: [{ name: "t", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "reservedMarginOf", stateMutability: "view", inputs: [{ name: "t", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "freeMarginOf", stateMutability: "view", inputs: [{ name: "t", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "marginDecimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;
const healthAbi = [
  { type: "function", name: "healthFactor", stateMutability: "view", inputs: [{ name: "m", type: "bytes32" }, { name: "t", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isLiquidatable", stateMutability: "view", inputs: [{ name: "m", type: "bytes32" }, { name: "t", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "maintenanceMargin", stateMutability: "view", inputs: [{ name: "m", type: "bytes32" }, { name: "t", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const fundingAbi = [{ type: "function", name: "getFundingIndex", stateMutability: "view", inputs: [{ name: "m", type: "bytes32" }, { name: "v", type: "uint64" }], outputs: [{ type: "int256" }] }] as const;
const liqAbi = [{ type: "function", name: "flaggedAt", stateMutability: "view", inputs: [{ name: "m", type: "bytes32" }, { name: "t", type: "address" }], outputs: [{ type: "uint256" }] }] as const;
const gatewayAbi = [
  { type: "function", name: "gatewayBalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "gatewayWithdrawalUnlockBlock", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const perpsAccount = route
  .get("/perps/account")
  .query(z.object({ address: zAddr }))
  .meta({ mcp: { title: "Perps — Margin Account", description: "FxMarginAccount margin for a trader: total / reserved / free (in margin-token units)." } })
  .output(z.object({ marginAccount: z.string(), trader: z.string(), marginDecimals: z.number(), totalMargin: z.string(), reservedMargin: z.string(), freeMargin: z.string() }))
  .handle(async ({ query }) => {
    const t = query.address as `0x${string}`;
    let dec = 6;
    try { dec = Number(await arcClient.readContract({ address: MARGIN, abi: marginAbi, functionName: "marginDecimals" })); } catch {}
    const rd = (fn: string) => arcClient.readContract({ address: MARGIN, abi: marginAbi, functionName: fn as never, args: [t] }).then((v) => formatUnits(v as bigint, dec)).catch(() => "0");
    const [total, reserved, free] = await Promise.all([rd("marginOf"), rd("reservedMarginOf"), rd("freeMarginOf")]);
    return ok({ marginAccount: MARGIN, trader: query.address, marginDecimals: dec, totalMargin: total, reservedMargin: reserved, freeMargin: free });
  });

const perpsHealth = route
  .get("/perps/health")
  .query(z.object({ marketId: zBytes32, trader: zAddr }))
  .meta({ mcp: { title: "Perps — Health Factor", description: "Health factor (ratioBps; <10000 = under maintenance), isLiquidatable, maintenanceMargin, and the liquidation flaggedAt block for a trader in a perp market." } })
  .output(z.object({ marketId: z.string(), trader: z.string(), healthFactorBps: z.string().optional(), isLiquidatable: z.boolean().optional(), maintenanceMargin: z.string().optional(), flaggedAtBlock: z.string().optional(), error: z.string().optional() }))
  .handle(async ({ query }) => {
    const m = query.marketId as `0x${string}`, t = query.trader as `0x${string}`;
    try {
      const [hf, liq, mm, flagged] = await Promise.all([
        arcClient.readContract({ address: HEALTH, abi: healthAbi, functionName: "healthFactor", args: [m, t] }) as Promise<bigint>,
        arcClient.readContract({ address: HEALTH, abi: healthAbi, functionName: "isLiquidatable", args: [m, t] }) as Promise<boolean>,
        arcClient.readContract({ address: HEALTH, abi: healthAbi, functionName: "maintenanceMargin", args: [m, t] }).catch(() => 0n) as Promise<bigint>,
        arcClient.readContract({ address: LIQ_ROUTER, abi: liqAbi, functionName: "flaggedAt", args: [m, t] }).catch(() => 0n) as Promise<bigint>,
      ]);
      return ok({ marketId: query.marketId, trader: query.trader, healthFactorBps: hf.toString(), isLiquidatable: liq, maintenanceMargin: mm.toString(), flaggedAtBlock: flagged.toString() });
    } catch (e) { return ok({ marketId: query.marketId, trader: query.trader, error: `read reverted: ${String(e).slice(0, 140)} (marketId may be unknown / trader has no position)` }); }
  });

const perpsFunding = route
  .get("/perps/funding")
  .query(z.object({ marketId: zBytes32, version: z.coerce.number().int().nonnegative().default(0) }))
  .meta({ mcp: { title: "Perps — Funding Index", description: "Cumulative funding index (int256, 1e18) for a perp market version from FxFundingEngine." } })
  .output(z.object({ marketId: z.string(), version: z.number(), cumulativeFundingE18: z.string().optional(), error: z.string().optional() }))
  .handle(async ({ query }) => {
    try {
      const idx = (await arcClient.readContract({ address: FUNDING, abi: fundingAbi, functionName: "getFundingIndex", args: [query.marketId as `0x${string}`, BigInt(query.version)] })) as bigint;
      return ok({ marketId: query.marketId, version: query.version, cumulativeFundingE18: idx.toString() });
    } catch (e) { return ok({ marketId: query.marketId, version: query.version, error: `read reverted: ${String(e).slice(0, 140)}` }); }
  });

const liquidationStatus = route
  .get("/liquidation/status")
  .query(z.object({ marketId: zBytes32, trader: zAddr }))
  .meta({ mcp: { title: "Liquidation — Status", description: "Whether a trader is flagged for liquidation (flaggedAt block) + isLiquidatable for a market." } })
  .output(z.object({ marketId: z.string(), trader: z.string(), flaggedAtBlock: z.string(), isLiquidatable: z.boolean().optional(), error: z.string().optional() }))
  .handle(async ({ query }) => {
    const m = query.marketId as `0x${string}`, t = query.trader as `0x${string}`;
    let flagged = "0";
    try { flagged = ((await arcClient.readContract({ address: LIQ_ROUTER, abi: liqAbi, functionName: "flaggedAt", args: [m, t] })) as bigint).toString(); } catch (e) { return ok({ marketId: query.marketId, trader: query.trader, flaggedAtBlock: "0", error: `read reverted: ${String(e).slice(0, 120)}` }); }
    let liq: boolean | undefined;
    try { liq = (await arcClient.readContract({ address: HEALTH, abi: healthAbi, functionName: "isLiquidatable", args: [m, t] })) as boolean; } catch {}
    return ok({ marketId: query.marketId, trader: query.trader, flaggedAtBlock: flagged, isLiquidatable: liq });
  });

const gatewayInfo = route
  .get("/gateway/info")
  .use(cache({ maxAge: 30, staleWhileRevalidate: 60 }))
  .meta({ mcp: { title: "Gateway — Cross-Hub Status", description: "FxGatewayHook cross-hub USDC: locked gateway balance + the withdrawal unlock block (Circle Gateway operator delay)." } })
  .output(z.object({ gatewayHook: z.string(), chainId: z.number(), gatewayBalance: z.string(), withdrawalUnlockBlock: z.string(), note: z.string() }))
  .handle(async () => {
    let bal = "0", unlock = "0";
    try { bal = formatUnits((await arcClient.readContract({ address: GATEWAY, abi: gatewayAbi, functionName: "gatewayBalance" })) as bigint, 6); } catch {}
    try { unlock = ((await arcClient.readContract({ address: GATEWAY, abi: gatewayAbi, functionName: "gatewayWithdrawalUnlockBlock" })) as bigint).toString(); } catch {}
    return ok({ gatewayHook: GATEWAY, chainId: ARC.chainId, gatewayBalance: bal, withdrawalUnlockBlock: unlock, note: "Cross-hub USDC via Circle Gateway; FxGatewayHook is the only contract that moves USDC across hubs. Authority rotates to the hub contract once Circle ships 1271 on burn intents." });
  });

export default new Hyper({ prefix: "/api" }).use([perpsAccount, perpsHealth, perpsFunding, liquidationStatus, gatewayInfo]);
