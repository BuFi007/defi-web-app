import { Hyper, badRequest, ok, route } from "@hyper/core";
import { z } from "zod";
import { createPublicClient, http, fallback, parseUnits } from "viem";
import { ARC, contractAddress } from "../registry/index.ts";

// Morpho Blue lending PREPARE shapes. The existing /api/lending/* returns metadata
// only; these emit the actual supply/borrow/repay/withdraw contract calls (+ an
// approval preflight) the user signs. PREPARE-ONLY — no key custody.
const ARC_RPC = process.env.ARC_TESTNET_RPC ?? ARC.rpc;
const ARC_RPC_FALLBACK = process.env.ARC_TESTNET_RPC_FALLBACK ?? "https://rpc.testnet.arc.network";
const arcClient = createPublicClient({ transport: fallback([http(ARC_RPC), http(ARC_RPC_FALLBACK)]) });

const MORPHOS = [
  contractAddress("arc", "lending.morphoBlue_canonical"),
  contractAddress("arc", "lending.morphoBlue_assetLoan"),
] as const;

const zAddr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const zBytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const zAmount = z.string().regex(/^\d+(\.\d+)?$/);

const morphoAbi = [
  { type: "function", name: "idToMarketParams", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "loanToken", type: "address" }, { name: "collateralToken", type: "address" }, { name: "oracle", type: "address" }, { name: "irm", type: "address" }, { name: "lltv", type: "uint256" }] },
] as const;
const erc20Abi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

type Market = { morpho: `0x${string}`; loanToken: `0x${string}`; collateralToken: `0x${string}`; oracle: `0x${string}`; irm: `0x${string}`; lltv: string };

async function resolveMarket(marketId: `0x${string}`): Promise<Market | null> {
  for (const morpho of MORPHOS) {
    try {
      const r = (await arcClient.readContract({ address: morpho, abi: morphoAbi, functionName: "idToMarketParams", args: [marketId] })) as readonly [string, string, string, string, bigint];
      if (r[0] && !/^0x0+$/.test(r[0])) {
        return { morpho, loanToken: r[0] as `0x${string}`, collateralToken: r[1] as `0x${string}`, oracle: r[2] as `0x${string}`, irm: r[3] as `0x${string}`, lltv: r[4].toString() };
      }
    } catch {}
  }
  return null;
}
async function loanDecimals(token: `0x${string}`): Promise<number> {
  try { return Number(await arcClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" })); } catch { return 6; }
}
const marketParamsObj = (m: Market) => ({ loanToken: m.loanToken, collateralToken: m.collateralToken, oracle: m.oracle, irm: m.irm, lltv: m.lltv });

const OUT = z.object({
  action: z.string(), morpho: z.string().optional(), marketId: z.string(), amountAtomic: z.string().optional(),
  marketParams: z.record(z.string()).optional(),
  contract: z.object({ address: z.string(), function: z.string(), args: z.record(z.any()) }).optional(),
  approvalNeeded: z.object({ token: z.string(), spender: z.string(), atLeastAtomic: z.string(), currentAllowance: z.string() }).nullable().optional(),
  chainId: z.number(), note: z.string().optional(), error: z.string().optional(),
});

/** 400 body for a marketId the prepare path can't resolve. Mirrors the repo's
 *  status/code/message/why/fix error shape (see routes/_addr.ts). Names the
 *  chain prepare resolves on (Arc 5042002) so the caller can filter, rather
 *  than circularly pointing back at the list the id came from. */
function unsupportedMarketBody(action: string, marketId: string) {
  return {
    status: 400,
    code: "MARKET_NOT_PREPARABLE" as const,
    message: `marketId ${JSON.stringify(marketId)} does not resolve on any Arc Morpho (chainId ${ARC.chainId}). The ${action}-prepare endpoints resolve ONLY Arc markets; Fuji (43113) marketIds from /api/lending/markets are not preparable here.`,
    why: "idToMarketParams returned no market for this id on either Arc MorphoBlue deployment. /api/lending/markets lists markets across both hubs (Arc + Fuji), but prepare is Arc-only.",
    fix: "Call GET /api/lending/markets and pick a marketId whose `hubChainId` is 5042002 (Arc) — equivalently one with `prepareSupported: true` — then retry.",
  };
}

/** 400 body for an unparseable amount string. */
function badAmountBody(action: string, amount: string, decimals: number) {
  return {
    status: 400,
    code: "BAD_AMOUNT" as const,
    message: `Could not parse amount ${JSON.stringify(amount)} for ${action} (loanToken has ${decimals} decimals).`,
    why: "parseUnits(amount, decimals) threw — the amount was not a valid decimal string for this token.",
    fix: "Pass a non-negative decimal string (e.g. \"10.5\") with at most the token's decimal places.",
  };
}

function mk(action: string, fn: string, opts: { needsApprove?: boolean; receiver?: boolean }) {
  return route
    .post(`/lending/${action}-prepare`)
    .body(z.object({ marketId: zBytes32, amount: zAmount, trader: zAddr, ...(opts.receiver ? { receiver: zAddr.optional() } : {}) }))
    .meta({ mcp: { title: `Lending — Prepare ${action}`, description: `Prepare an unsigned Morpho Blue ${action}(marketParams, assets, 0, onBehalf${opts.receiver ? ", receiver" : ", data"}) call for a market. ${opts.needsApprove ? "Includes an approval preflight (loanToken → Morpho)." : ""} PREPARE only — you sign.` } })
    .output(OUT)
    .handle(async ({ body }) => {
      const m = await resolveMarket(body.marketId as `0x${string}`);
      if (!m) return badRequest(unsupportedMarketBody(action, body.marketId));
      const dec = await loanDecimals(m.loanToken);
      let atomic: bigint;
      try { atomic = parseUnits(body.amount, dec); } catch { return badRequest(badAmountBody(action, body.amount, dec)); }
      const recv = (body as { receiver?: string }).receiver ?? body.trader;
      const args = opts.receiver
        ? { marketParams: marketParamsObj(m), assets: atomic.toString(), shares: "0", onBehalf: body.trader, receiver: recv }
        : { marketParams: marketParamsObj(m), assets: atomic.toString(), shares: "0", onBehalf: body.trader, data: "0x" };
      let approvalNeeded = null as null | { token: string; spender: string; atLeastAtomic: string; currentAllowance: string };
      if (opts.needsApprove) {
        let allowance = 0n;
        try { allowance = (await arcClient.readContract({ address: m.loanToken, abi: erc20Abi, functionName: "allowance", args: [body.trader as `0x${string}`, m.morpho] })) as bigint; } catch {}
        if (allowance < atomic) approvalNeeded = { token: m.loanToken, spender: m.morpho, atLeastAtomic: atomic.toString(), currentAllowance: allowance.toString() };
      }
      const sig = opts.receiver
        ? `${action}((address,address,address,address,uint256) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)`
        : `${action}((address,address,address,address,uint256) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data)`;
      return ok({ action, morpho: m.morpho, marketId: body.marketId, amountAtomic: atomic.toString(), marketParams: marketParamsObj(m), contract: { address: m.morpho, function: sig, args }, approvalNeeded, chainId: ARC.chainId, note: opts.needsApprove ? "Approve loanToken→Morpho first if approvalNeeded is set." : action === "borrow" ? "Requires collateral already supplied + sufficient health; reverts otherwise." : "Withdraws to receiver." });
    });
}

const supplyP = mk("supply", "supply", { needsApprove: true });
const borrowP = mk("borrow", "borrow", { receiver: true });
const repayP = mk("repay", "repay", { needsApprove: true });
const withdrawP = mk("withdraw", "withdraw", { receiver: true });

export default new Hyper({ prefix: "/api" }).use([supplyP, borrowP, repayP, withdrawP]);
