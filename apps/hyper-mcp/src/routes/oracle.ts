import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { cache } from "@hyper/cache";
import { createPublicClient, http, fallback, formatUnits } from "viem";
import { ARC, tokenAddress, contractAddress, tokenSymbols } from "../registry/index.ts";

// FxOracleV2 (0xdA5C…) — the canonical FX price oracle: getMid(base,quote) with a
// Pyth → RedStone → Chainlink three-way fallback, returning a 1e18-scaled mid +
// publishedAt. Read-only surface; the staleness fields let an agent (or an
// adversary probing the feed) see exactly how fresh the price is.
const ARC_RPC = process.env.ARC_TESTNET_RPC ?? ARC.rpc;
const ARC_RPC_FALLBACK = process.env.ARC_TESTNET_RPC_FALLBACK ?? "https://rpc.testnet.arc.network";
const arcClient = createPublicClient({ transport: fallback([http(ARC_RPC), http(ARC_RPC_FALLBACK)]) });

const FX_ORACLE_V2 = contractAddress("arc", "lpInsuranceLayer.fxOracleV2");
const ORACLE_MAX_STALE = Number(process.env.ORACLE_MAX_STALE_SECONDS ?? 3600);

const fxOracleV2Abi = [
  {
    type: "function", name: "getMid", stateMutability: "view",
    inputs: [{ name: "base", type: "address" }, { name: "quote", type: "address" }],
    outputs: [{ name: "midE18", type: "uint256" }, { name: "publishedAt", type: "uint256" }],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const oraclePrice = route
  .get("/oracle/price")
  .query(
    z.object({
      base: z.string().regex(/^[A-Za-z]{2,8}$/),
      quote: z.string().regex(/^[A-Za-z]{2,8}$/).default("USDC"),
    }),
  )
  .meta({
    mcp: {
      title: "FX Oracle V2 — Mid Price",
      description:
        "Read the live FxOracleV2 mid price for a base/quote pair (e.g. base=EURC, quote=USDC) on Arc. Returns a 1e18-scaled mid via the Pyth → RedStone → Chainlink fallback, plus publishedAt + a staleness flag (the protocol treats >maxStaleSeconds as stale, which blocks live swaps). Pure read; no signing.",
    },
  })
  .output(
    z.object({
      base: z.string(),
      quote: z.string(),
      oracle: z.string(),
      midE18: z.string().optional(),
      mid: z.string().optional(),
      publishedAt: z.number().nullable().optional(),
      ageSeconds: z.number().nullable().optional(),
      stale: z.boolean().optional(),
      maxStaleSeconds: z.number(),
      source: z.string().optional(),
      error: z.string().optional(),
      hint: z.string().optional(),
      supported: z.array(z.string()).optional(),
    }),
  )
  .handle(async ({ query }) => {
    let baseAddr: `0x${string}`, quoteAddr: `0x${string}`;
    try {
      baseAddr = tokenAddress("arc", query.base);
      quoteAddr = tokenAddress("arc", query.quote);
    } catch (e) {
      return ok({
        base: query.base, quote: query.quote, oracle: FX_ORACLE_V2, maxStaleSeconds: ORACLE_MAX_STALE,
        error: e instanceof Error ? e.message : String(e), supported: tokenSymbols("arc"),
      });
    }
    if (baseAddr.toLowerCase() === quoteAddr.toLowerCase()) {
      return ok({ base: query.base, quote: query.quote, oracle: FX_ORACLE_V2, maxStaleSeconds: ORACLE_MAX_STALE, error: "base and quote must differ" });
    }
    try {
      const res = (await arcClient.readContract({
        address: FX_ORACLE_V2, abi: fxOracleV2Abi, functionName: "getMid", args: [baseAddr, quoteAddr],
      })) as readonly [bigint, bigint];
      const midE18 = res[0];
      const publishedAt = Number(res[1]);
      const now = Math.floor(Date.now() / 1000);
      const ageSeconds = publishedAt > 0 ? now - publishedAt : null;
      return ok({
        base: query.base, quote: query.quote, oracle: FX_ORACLE_V2,
        midE18: midE18.toString(), mid: formatUnits(midE18, 18),
        publishedAt: publishedAt || null, ageSeconds,
        stale: ageSeconds === null ? false : ageSeconds > ORACLE_MAX_STALE,
        maxStaleSeconds: ORACLE_MAX_STALE,
        source: "FxOracleV2 (Pyth → RedStone → Chainlink)",
      });
    } catch (e) {
      return ok({
        base: query.base, quote: query.quote, oracle: FX_ORACLE_V2, maxStaleSeconds: ORACLE_MAX_STALE,
        error: `oracle read reverted: ${String(e).slice(0, 160)}`,
        hint: "the pair may not be configured on FxOracleV2 (no Pyth/RedStone/Chainlink feed); try a configured pair like EURC/USDC",
      });
    }
  });

const oracleInfo = route
  .get("/oracle/info")
  .use(cache({ maxAge: 300, staleWhileRevalidate: 600 }))
  .meta({
    mcp: {
      title: "FX Oracle V2 — Info",
      description: "FxOracleV2 address, decimals, supported tokens, and price-source order. Use before /api/oracle/price.",
    },
  })
  .output(
    z.object({
      oracle: z.string(), chainId: z.number(), decimals: z.number().nullable(),
      supportedTokens: z.array(z.string()), priceSources: z.string(), note: z.string(),
    }),
  )
  .handle(async () => {
    let decimals: number | null = null;
    try {
      decimals = Number(await arcClient.readContract({ address: FX_ORACLE_V2, abi: fxOracleV2Abi, functionName: "decimals" }));
    } catch {}
    return ok({
      oracle: FX_ORACLE_V2, chainId: ARC.chainId, decimals,
      supportedTokens: tokenSymbols("arc"),
      priceSources: "Pyth → RedStone → Chainlink (3-way fallback)",
      note: "getMid(base,quote) returns a 1e18-scaled mid. Query /api/oracle/price?base=EURC&quote=USDC.",
    });
  });

export default new Hyper({ prefix: "/api" }).use([oraclePrice, oracleInfo]);
