import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { cache } from "@hyper/cache";
import { createPublicClient, http, fallback, formatUnits, parseUnits } from "viem";
import { ARC, contractAddress, tokenAddress } from "../registry/index.ts";

// FxSwap layer — the vault-backed Uniswap-v4 cross-currency pools (one FxSwapHook
// per asset) routed by FxRouter.executeIntent. Each hook is a USDC/<asset> pool;
// quote() gives a live size-aware-ish quote, effectiveSpreadBps the spread, and
// tradableAssets the liquidity ceiling (thin => the constant-spread MVP slips).
const ARC_RPC = process.env.ARC_TESTNET_RPC ?? ARC.rpc;
const ARC_RPC_FALLBACK = process.env.ARC_TESTNET_RPC_FALLBACK ?? "https://rpc.testnet.arc.network";
const arcClient = createPublicClient({ transport: fallback([http(ARC_RPC), http(ARC_RPC_FALLBACK)]) });

const USDC = tokenAddress("arc", "USDC");
const FX_ROUTER = contractAddress("arc", "lpInsuranceLayer.fxRouter");

// Per-asset FxSwapHook pools (token order from fx-telarana/deployments/fxswap-*.json).
// token0/token1 are sorted by address; zeroForOne = (inputToken === token0).
const POOLS: Record<string, { hook: `0x${string}`; token0: `0x${string}`; token1: `0x${string}`; sym0: string; sym1: string; dec0: number; dec1: number; fee: number; pyth: string }> = {
  AUDF: { hook: contractAddress("arc", "lpInsuranceLayer.fxSwapHooks.AUDF"), token0: USDC, token1: tokenAddress("arc", "AUDF"), sym0: "USDC", sym1: "AUDF", dec0: 6, dec1: 6, fee: 100, pyth: "AUD/USD" },
  MXNB: { hook: contractAddress("arc", "lpInsuranceLayer.fxSwapHooks.MXNB"), token0: USDC, token1: tokenAddress("arc", "MXNB"), sym0: "USDC", sym1: "MXNB", dec0: 6, dec1: 6, fee: 100, pyth: "USD/MXN" },
  QCAD: { hook: contractAddress("arc", "lpInsuranceLayer.fxSwapHooks.QCAD"), token0: tokenAddress("arc", "QCAD"), token1: USDC, sym0: "QCAD", sym1: "USDC", dec0: 6, dec1: 6, fee: 100, pyth: "USD/CAD" },
  EURC: { hook: contractAddress("arc", "lpInsuranceLayer.fxSwapHooks.EURC"), token0: USDC, token1: tokenAddress("arc", "EURC"), sym0: "USDC", sym1: "EURC", dec0: 6, dec1: 6, fee: 100, pyth: "EUR/USD" },
};

const swapHookAbi = [
  { type: "function", name: "quote", stateMutability: "view", inputs: [{ name: "amountIn", type: "uint256" }, { name: "zeroForOne", type: "bool" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "effectiveSpreadBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "tradableAssets", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const fxswapPools = route
  .get("/fxswap/pools")
  .use(cache({ maxAge: 120, staleWhileRevalidate: 300 }))
  .meta({ mcp: { title: "FxSwap — Pools", description: "Vault-backed v4 cross-currency pools (one FxSwapHook per asset: AUDF/MXNB/QCAD/EURC vs USDC). Returns hook address, token pair + order, fee, and Pyth pair. Quote via /api/fxswap/quote; execute via FxRouter.executeIntent (see /api/fxswap/intent-shape)." } })
  .output(z.object({ router: z.string(), chainId: z.number(), pools: z.array(z.object({ asset: z.string(), hook: z.string(), token0: z.string(), token1: z.string(), pair: z.string(), fee: z.number(), pyth: z.string() })) }))
  .handle(async () =>
    ok({ router: FX_ROUTER, chainId: ARC.chainId, pools: Object.entries(POOLS).map(([asset, p]) => ({ asset, hook: p.hook, token0: p.token0, token1: p.token1, pair: `${p.sym0}/${p.sym1}`, fee: p.fee, pyth: p.pyth })) }),
  );

const fxswapQuote = route
  .get("/fxswap/quote")
  .query(z.object({ asset: z.enum(["AUDF", "MXNB", "QCAD", "EURC"]), amountIn: z.string().regex(/^\d+(\.\d+)?$/), side: z.enum(["buy", "sell"]).default("buy") }))
  .meta({ mcp: { title: "FxSwap — Quote", description: "Live cross-currency quote on a vault-backed pool. side=buy spends USDC to receive the asset; side=sell spends the asset to receive USDC. Returns amountOut, effectiveSpreadBps, and tradableAssets (liquidity ceiling — exceeding it slips badly on the constant-spread MVP)." } })
  .output(z.object({ asset: z.string(), side: z.string(), hook: z.string(), amountIn: z.string(), amountInAtomic: z.string(), tokenIn: z.string(), tokenOut: z.string(), amountOut: z.string().optional(), amountOutAtomic: z.string().optional(), zeroForOne: z.boolean(), spreadBps: z.number().nullable(), tradableOut: z.string().optional(), error: z.string().optional() }))
  .handle(async ({ query }) => {
    const p = POOLS[query.asset]!; // query.asset is the enum; key always present
    const assetAddr = tokenAddress("arc", query.asset);
    // buy: USDC -> asset (tokenIn=USDC). sell: asset -> USDC (tokenIn=asset).
    const tokenIn = query.side === "buy" ? USDC : assetAddr;
    const tokenOut = query.side === "buy" ? assetAddr : USDC;
    const zeroForOne = tokenIn.toLowerCase() === p.token0.toLowerCase();
    const decIn = tokenIn.toLowerCase() === p.token0.toLowerCase() ? p.dec0 : p.dec1;
    const decOut = tokenOut.toLowerCase() === p.token0.toLowerCase() ? p.dec0 : p.dec1;
    let amountInAtomic: bigint;
    try { amountInAtomic = parseUnits(query.amountIn, decIn); } catch { return ok({ asset: query.asset, side: query.side, hook: p.hook, amountIn: query.amountIn, amountInAtomic: "0", tokenIn, tokenOut, zeroForOne, spreadBps: null, error: "bad amountIn" }); }
    try {
      const [outAtomic, spread, tradable] = await Promise.all([
        arcClient.readContract({ address: p.hook, abi: swapHookAbi, functionName: "quote", args: [amountInAtomic, zeroForOne] }) as Promise<bigint>,
        arcClient.readContract({ address: p.hook, abi: swapHookAbi, functionName: "effectiveSpreadBps" }).catch(() => null) as Promise<number | null>,
        arcClient.readContract({ address: p.hook, abi: swapHookAbi, functionName: "tradableAssets", args: [tokenOut] }).catch(() => null) as Promise<bigint | null>,
      ]);
      return ok({ asset: query.asset, side: query.side, hook: p.hook, amountIn: query.amountIn, amountInAtomic: amountInAtomic.toString(), tokenIn, tokenOut, amountOut: formatUnits(outAtomic, decOut), amountOutAtomic: outAtomic.toString(), zeroForOne, spreadBps: spread === null ? null : Number(spread), tradableOut: tradable === null ? undefined : formatUnits(tradable, decOut) });
    } catch (e) {
      return ok({ asset: query.asset, side: query.side, hook: p.hook, amountIn: query.amountIn, amountInAtomic: amountInAtomic.toString(), tokenIn, tokenOut, zeroForOne, spreadBps: null, error: `quote reverted: ${String(e).slice(0, 140)} (pool may be paused / oracle stale / no liquidity)` });
    }
  });

const fxswapIntent = route
  .get("/fxswap/intent-shape")
  .use(cache({ maxAge: 600, staleWhileRevalidate: 1200 }))
  .meta({ mcp: { title: "FxSwap — executeIntent Shape", description: "The FxRouter.executeIntent call shape for an on-chain cross-currency swap. The FxIntent is EIP-712 signed (intentSig) + an ERC-2612 permit (permit/permitSig). For SHIELDED cross-currency, use the ghost path (/api/ghost/swap → relayer) instead." } })
  .output(z.object({ router: z.string(), function: z.string(), fxIntent: z.record(z.string()), notes: z.array(z.string()) }))
  .handle(async () =>
    ok({
      router: FX_ROUTER,
      function: "executeIntent(FxIntent intent, bytes intentSig, bytes permit, bytes permitSig) → buyAmount",
      fxIntent: { taker: "address", recipient: "address", sellToken: "address", buyToken: "address", sellAmount: "uint256", minBuyAmount: "uint256", deadline: "uint48", feeBps: "uint48 (<= router maxFeeBps)", tenor: "uint8 (TENOR_INSTANT only)", quoteId: "bytes32", uuid: "uint256" },
      notes: [
        "intentSig: EIP-712 signature over FxIntent by `taker`.",
        "permit/permitSig: ERC-2612 permit so the router can pull sellToken (or empty if pre-approved).",
        "Pair must be allow-listed (setPairAllowed) and deadline within MAX_DEADLINE_FUTURE.",
        "For shielded/private cross-currency use /api/ghost/swap (relayCrossCurrency via the relayer) instead.",
      ],
    }),
  );

export default new Hyper({ prefix: "/api" }).use([fxswapPools, fxswapQuote, fxswapIntent]);
