import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { telaranaService, jsonSafe } from "../services.ts";
import { listMarkets } from "@bufi/fx-telarana";
import { ARC_CHAIN_ID, zAddress, zAmount, generateDeadlineAndNonce } from "../shared.ts";

const zMarketId = z.string().min(1);

const lendingMarkets = route
  .get("/lending/markets")
  .meta({
    mcp: {
      title: "Lending Markets",
      description:
        "List available lending/borrowing pools on Arc. Shows supply APY, borrow APY, total supplied, total borrowed, utilization, and collateral requirements.",
    },
  })
  .handle(async () => {
    const markets = await listMarkets();
    return ok(jsonSafe({ markets }));
  });

const borrowPreview = route
  .post("/lending/borrow/preview")
  .body(z.object({ marketId: zMarketId, collateralAmount: zAmount, borrowAmount: zAmount }))
  .meta({
    mcp: {
      title: "Borrow Preview",
      description:
        "Preview a borrow: see utilization, borrow APY, and health factor before committing.",
    },
  })
  .handle(async ({ body }) => {
    try {
      const preview = await telaranaService.borrowQuote({
        chainId: ARC_CHAIN_ID,
        marketId: body.marketId,
        collateralAmount: body.collateralAmount,
        borrowAmount: body.borrowAmount,
      });
      return ok(jsonSafe(preview));
    } catch {
      return ok({
        error: "borrow preview unavailable",
        note: "On-chain quote reader not configured. Use GET /api/lending/markets for APY data.",
        marketId: body.marketId,
      });
    }
  });

const supplyAction = route
  .post("/lending/supply")
  .body(z.object({ marketId: zMarketId, supplier: zAddress, amount: zAmount }))
  .meta({
    mcp: {
      title: "Supply to Lending Pool",
      description:
        "Supply USDC to a lending pool to earn yield. Returns market details and EIP-712 intent parameters. x402: $0.001.",
    },
  })
  .handle(async ({ body }) => {
    const markets = await listMarkets();
    const market = markets.find((m) => m.id === body.marketId);
    const { deadline, nonce } = generateDeadlineAndNonce();
    return ok(jsonSafe({
      action: "supply",
      marketId: body.marketId,
      supplier: body.supplier,
      amount: body.amount,
      market: market ?? null,
      chainId: ARC_CHAIN_ID,
      deadline,
      nonce,
    }));
  });

const borrowAction = route
  .post("/lending/borrow")
  .body(z.object({ marketId: zMarketId, borrower: zAddress, borrowAmount: zAmount, collateralAmount: zAmount }))
  .meta({
    mcp: {
      title: "Borrow Against Collateral",
      description:
        "Borrow FX tokens against USDC collateral. Use bufi_borrow_preview first to check health factor. x402: $0.001.",
    },
  })
  .handle(async ({ body }) => {
    const preview = await telaranaService.borrowQuote({
      chainId: ARC_CHAIN_ID,
      marketId: body.marketId,
      collateralAmount: body.collateralAmount,
      borrowAmount: body.borrowAmount,
    });
    const { deadline, nonce } = generateDeadlineAndNonce();
    return ok(jsonSafe({
      action: "borrow",
      ...body,
      preview,
      chainId: ARC_CHAIN_ID,
      deadline,
      nonce,
    }));
  });

const repayAction = route
  .post("/lending/repay")
  .body(z.object({ marketId: zMarketId, borrower: zAddress, amount: zAmount }))
  .meta({
    mcp: {
      title: "Repay Loan",
      description: "Repay a lending pool loan. Improves health factor. x402: $0.001.",
    },
  })
  .handle(async ({ body }) => {
    const { deadline, nonce } = generateDeadlineAndNonce();
    return ok(jsonSafe({ action: "repay", ...body, chainId: ARC_CHAIN_ID, deadline, nonce }));
  });

const withdrawAction = route
  .post("/lending/withdraw")
  .body(z.object({ marketId: zMarketId, supplier: zAddress, amount: zAmount }))
  .meta({
    mcp: {
      title: "Withdraw from Lending Pool",
      description: "Withdraw previously supplied USDC from a lending pool. x402: $0.001.",
    },
  })
  .handle(async ({ body }) => {
    const { deadline, nonce } = generateDeadlineAndNonce();
    return ok(jsonSafe({ action: "withdraw", ...body, chainId: ARC_CHAIN_ID, deadline, nonce }));
  });

export default new Hyper({ prefix: "/api" }).use([
  lendingMarkets, borrowPreview, supplyAction, borrowAction, repayAction, withdrawAction,
]);
