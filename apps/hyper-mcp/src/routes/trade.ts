import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { perpsService, jsonSafe } from "../services.ts";
import { captureTradeError } from "../sentry.ts";
import { buildPerpsOrderTypedData, hashPerpsOrder } from "@bufi/perps";
import { ARC_PERP_MARKETS } from "@bufi/contracts";
import {
  ARC_CHAIN_ID, zAddress, zAmount, zSymbol, zSide, zSignature, zLeverage,
  resolveMarketId, computeSizeDelta, generateDeadlineAndNonce, withEip712Domain, scrubError,
} from "../shared.ts";

// Order time-to-live (seconds): floored at 1 and capped at 7 days, so a
// zero/negative ttl can't mint an already-expired signable order (red-team).
const zTtl = z.number().int().min(1).max(604800).default(3600);

// maintenanceMarginBps for a given market id, read from the protocol config
// (@bufi/contracts ARC_PERP_MARKETS). All Arc perp markets currently share
// ARC_PERP_DEFAULT_CONFIG (initialMarginBps 500 = 20x cap, maintenanceMarginBps
// 300 = 3%), but we look it up per-market so per-market overrides flow through.
function maintenanceMarginBpsFor(marketId: string): number | null {
  const m = Object.values(ARC_PERP_MARKETS).find(
    (mk) => mk.marketId.toLowerCase() === marketId.toLowerCase(),
  );
  return m?.config.maintenanceMarginBps ?? null;
}

/**
 * Pre-trade liquidation price for a prospective isolated-margin position.
 *
 * Inputs (all from data the quote/config already exposes):
 *   entry  — mark price at prepare time (human units; quote.markPrice is E18)
 *   leverage, side, maintenanceMarginBps (mmr = bps / 1e4).
 *
 * Isolated-margin model: a position is liquidated when remaining equity falls
 * to the maintenance-margin requirement. Initial margin fraction = 1/leverage.
 *   long :  equity/notional = (1/lev) - (P_entry - P)/P_entry  →  liq at = mmr
 *           ⇒ P_liq = P_entry · (1 - 1/lev + mmr)
 *   short:  ⇒ P_liq = P_entry · (1 + 1/lev - mmr)
 * Clamped at 0 (a long beyond 1/lev+... can't liquidate below zero price).
 */
function computeLiquidationPrice(
  entry: number,
  leverage: number,
  side: "long" | "short",
  maintenanceMarginBps: number,
): number {
  const mmr = maintenanceMarginBps / 1e4;
  const invLev = 1 / leverage;
  const px = side === "long"
    ? entry * (1 - invLev + mmr)
    : entry * (1 + invLev - mmr);
  return Math.max(0, px);
}

const tradePrepare = route
  .post("/trade/prepare")
  .body(
    z.object({
      symbol: zSymbol,
      trader: zAddress,
      side: zSide,
      sizeUsdc: zAmount,
      leverage: zLeverage,
      // .default(...).optional() keeps the server-side default (parse(undefined)
      // still yields "market"/false/3600) while making the field NOT appear in
      // the MCP/OpenAPI inputSchema `required[]` — the converter only excludes a
      // field when its OUTER wrapper is ZodOptional. Matches llms.txt's
      // "omit unless overriding" guidance (G11).
      orderType: z.enum(["limit", "market"]).default("market").optional(),
      limitPrice: z.string().optional(),
      reduceOnly: z.boolean().default(false).optional(),
      ttl: zTtl.optional(),
    }),
  )
  .meta({
    mcp: {
      title: "Prepare Trade",
      description:
        "Prepare a forex perp trade in one call. Pass human-readable symbol (e.g. 'EURC/USDC'), side, size in USDC, and leverage. Returns quote + EIP-712 typed data to sign. After signing, call post__api_trade_execute.",
    },
  })
  .handle(async ({ body }) => {
    try {
      const marketId = resolveMarketId(body.symbol);
      if (!marketId) return ok({ error: `Unknown symbol: ${body.symbol}` });

      const sizeDelta = computeSizeDelta(body.side, body.sizeUsdc);
      // Re-assert the server defaults locally: the fields are now
      // .default(...).optional() (G11), so at runtime parse() already filled
      // them, but the static type widened to `| undefined`. Normalize without
      // `as any` so the signed order shape is unchanged.
      const orderType = body.orderType ?? "market";
      const reduceOnly = body.reduceOnly ?? false;
      const ttl = body.ttl ?? 3600;
      const { deadline, nonce } = generateDeadlineAndNonce(ttl);

      const quote = await perpsService.quote({
        chainId: ARC_CHAIN_ID,
        marketId,
        side: body.side,
        sizeUsdc: body.sizeUsdc,
        sizeDelta,
        leverage: body.leverage,
      });

      const order = {
        chainId: ARC_CHAIN_ID as 5042002,
        marketId,
        trader: body.trader,
        side: body.side,
        sizeUsdc: body.sizeUsdc,
        sizeDelta,
        leverage: body.leverage,
        deadline,
        nonce,
        orderType,
        limitPrice: body.limitPrice,
        reduceOnly,
        postOnly: false,
      };

      // --- Pre-trade risk: liquidation price + maintenance margin (G7) ---
      // markPrice is E18-scaled (1e18 = 1.0). requiredMargin & fee are USDC
      // atomic (1e6). mmrBps comes from the protocol market config.
      const mmrBps = maintenanceMarginBpsFor(marketId);
      const entryPrice = Number(quote.markPrice) / 1e18;
      const liquidationPrice = mmrBps !== null
        ? computeLiquidationPrice(entryPrice, body.leverage, body.side, mmrBps)
        : null;
      const requiredMarginUsdc = Number(quote.requiredMargin) / 1e6;
      // Maintenance margin in USDC = mmr * notional (notional = sizeUsdc).
      const maintenanceMarginUsdc = mmrBps !== null
        ? (mmrBps / 1e4) * Number(body.sizeUsdc)
        : null;

      // --- Fee disclosure (G7) ---
      // The signed order carries maxFee:0 (uncapped) on-chain, so the protocol
      // fee is whatever the matcher charges at fill — the `fee` below is an
      // estimate at the quoted mark, not a hard cap. Surface that explicitly.
      const protocolFeeUsdc = quote.fee ? Number(quote.fee) / 1e6 : null;

      return ok(jsonSafe({
        symbol: body.symbol,
        marketId,
        quote,
        order: {
          digest: hashPerpsOrder(order),
          typedData: withEip712Domain(buildPerpsOrderTypedData(order)),
          deadline,
          nonce,
        },
        // Risk preview for the PROSPECTIVE position (before signing). The
        // health/liquidation read-endpoints only work once a position is open;
        // this lets an agent see its liq price up front.
        risk: {
          entryPrice: entryPrice.toString(),
          side: body.side,
          leverage: body.leverage,
          liquidationPrice: liquidationPrice !== null ? liquidationPrice.toString() : null,
          maintenanceMarginBps: mmrBps,
          maintenanceMargin: maintenanceMarginUsdc !== null
            ? `${maintenanceMarginUsdc.toFixed(6)} USDC`
            : null,
          requiredMargin: `${requiredMarginUsdc.toFixed(6)} USDC`,
          note: mmrBps === null
            ? "maintenanceMarginBps unavailable for this market; liquidationPrice not computed"
            : "Isolated-margin estimate at the quoted mark; actual liq depends on funding + fees accrued.",
        },
        costEstimate: {
          margin: `${(Number(body.sizeUsdc) / body.leverage).toFixed(4)} USDC`,
          fee: quote.fee ? `${quote.fee} atomic` : "see quote",
          x402Fee: "0.005 USDC",
        },
        // Fees are NOT capped by the signed order (on-chain maxFee = 0). The
        // figure below is an estimate at the quoted mark; the fill may charge
        // more if the mark moves before settlement.
        feeDisclosure: {
          maxFee: "0 (uncapped — the signed order does not cap the protocol fee)",
          estimatedProtocolFee: protocolFeeUsdc !== null
            ? `${protocolFeeUsdc.toFixed(6)} USDC`
            : "see quote.fee",
          worstCaseFee: "uncapped; scales with notional at fill price — fee is not bounded by the signature",
          x402Fee: "0.005 USDC",
        },
        nextStep: "Sign the order digest with your wallet, then call post__api_trade_execute with the signature.",
      }));
    } catch (e) {
      captureTradeError(e, { tool: "trade", symbol: body.symbol, side: body.side, sizeUsdc: body.sizeUsdc, leverage: body.leverage, wallet: body.trader });
      return ok({ error: scrubError(e) });
    }
  });

const tradeExecute = route
  .post("/trade/execute")
  .body(
    z.object({
      symbol: zSymbol,
      trader: zAddress,
      side: zSide,
      sizeUsdc: zAmount,
      leverage: zLeverage,
      orderType: z.enum(["limit", "market"]).default("market"),
      limitPrice: z.string().optional(),
      reduceOnly: z.boolean().default(false),
      postOnly: z.boolean().default(false),
      deadline: z.number().int(),
      nonce: z.string(),
      signature: zSignature,
    }),
  )
  .meta({
    mcp: {
      title: "Execute Trade",
      description:
        "Submit a signed forex perp order. Use the values from post__api_trade_prepare + your wallet signature. Returns the intent ID and SSE stream URL for real-time status tracking. x402: $0.005.",
    },
  })
  .handle(async ({ body }) => {
    try {
      const marketId = resolveMarketId(body.symbol);
      if (!marketId) return ok({ error: `Unknown symbol: ${body.symbol}` });

      const sizeDelta = computeSizeDelta(body.side, body.sizeUsdc);

      const intent = await perpsService.createIntent({
        chainId: ARC_CHAIN_ID,
        marketId,
        trader: body.trader,
        side: body.side,
        sizeUsdc: body.sizeUsdc,
        sizeDelta,
        leverage: body.leverage,
        deadline: body.deadline,
        nonce: body.nonce,
        orderType: body.orderType,
        limitPrice: body.limitPrice,
        reduceOnly: body.reduceOnly,
        postOnly: body.postOnly,
        signature: body.signature,
      });

      const intentId = typeof intent === "object" && intent !== null && "intentId" in intent
        ? (intent as Record<string, unknown>).intentId
        : "unknown";

      return ok(jsonSafe({ intent, streamUrl: `/api/stream/prices/${body.symbol}` }));
    } catch (e) {
      captureTradeError(e, { tool: "trade", symbol: body.symbol, side: body.side, sizeUsdc: body.sizeUsdc, leverage: body.leverage, wallet: body.trader });
      return ok({ error: scrubError(e) });
    }
  });

const closePrepare = route
  .post("/close/prepare")
  .body(
    z.object({
      symbol: zSymbol,
      trader: zAddress,
      side: zSide,
      sizeUsdc: zAmount,
      ttl: zTtl,
    }),
  )
  .meta({
    mcp: {
      title: "Prepare Close Position",
      description:
        "Prepare to close or reduce a forex perp position. Pass your current side (not the opposite). Returns EIP-712 typed data to sign. Then call post__api_trade_execute with reduceOnly=true.",
    },
  })
  .handle(async ({ body }) => {
    try {
      const marketId = resolveMarketId(body.symbol);
      if (!marketId) return ok({ error: `Unknown symbol: ${body.symbol}` });

      const closeSide = body.side === "long" ? "short" : "long";
      const sizeDelta = computeSizeDelta(closeSide, body.sizeUsdc);
      const { deadline, nonce } = generateDeadlineAndNonce(body.ttl);

      const order = {
        chainId: ARC_CHAIN_ID as 5042002,
        marketId,
        trader: body.trader,
        side: closeSide as "long" | "short",
        sizeUsdc: body.sizeUsdc,
        sizeDelta,
        leverage: 1,
        deadline,
        nonce,
        orderType: "market" as const,
        reduceOnly: true,
        postOnly: false,
      };

      return ok(jsonSafe({
        symbol: body.symbol,
        closing: body.side,
        order: {
          digest: hashPerpsOrder(order),
          typedData: withEip712Domain(buildPerpsOrderTypedData(order)),
          deadline,
          nonce,
          reduceOnly: true,
        },
        nextStep: "Sign the order digest, then call post__api_trade_execute with reduceOnly=true.",
      }));
    } catch (e) {
      captureTradeError(e, { tool: "close", symbol: body.symbol, side: body.side, sizeUsdc: body.sizeUsdc, wallet: body.trader });
      return ok({ error: scrubError(e) });
    }
  });

export default new Hyper({ prefix: "/api" }).use([tradePrepare, tradeExecute, closePrepare]);
