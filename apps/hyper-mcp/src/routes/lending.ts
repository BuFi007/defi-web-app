import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { telaranaService, jsonSafe } from "../services.ts";
import { listMarkets } from "@bufi/fx-telarana";

const lendingMarkets = route
  .get("/lending/markets")
  .meta({
    mcp: {
      title: "Lending Markets",
      description:
        "List available lending/borrowing pools on Arc. Shows supply APY, borrow APY, total supplied, total borrowed, utilization, and collateral requirements. Agents can supply USDC to earn yield or borrow FX tokens against USDC collateral.",
    },
  })
  .handle(async () => {
    const markets = await listMarkets();
    return ok(jsonSafe({ markets }));
  });

const borrowPreview = route
  .post("/lending/borrow/preview")
  .body(
    z.object({
      marketId: z.string().min(1),
      collateralAmount: z.string().regex(/^\d+(\.\d{1,6})?$/),
      borrowAmount: z.string().regex(/^\d+(\.\d{1,6})?$/),
    }),
  )
  .meta({
    mcp: {
      title: "Borrow Preview",
      description:
        "Preview a borrow: see utilization, borrow APY, and health factor before committing. Use to evaluate carry trade economics (borrow low-rate FX, deploy in high-yield perp funding).",
    },
  })
  .handle(async ({ body }) => {
    const preview = await telaranaService.borrowQuote({
      chainId: 5042002,
      marketId: body.marketId,
      collateralAmount: body.collateralAmount,
      borrowAmount: body.borrowAmount,
    });
    return ok(jsonSafe(preview));
  });

const supplyAction = route
  .post("/lending/supply")
  .body(
    z.object({
      marketId: z.string().min(1),
      supplier: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
    }),
  )
  .meta({
    mcp: {
      title: "Supply to Lending Pool",
      description:
        "Supply USDC to a lending pool to earn yield. Returns the market details and EIP-712 intent parameters needed to sign the supply transaction. Agents earn passive yield on idle USDC between trades. x402: $0.001.",
    },
  })
  .handle(async ({ body }) => {
    const markets = await listMarkets();
    const market = markets.find((m) => m.id === body.marketId);
    return ok(jsonSafe({
      action: "supply",
      marketId: body.marketId,
      supplier: body.supplier,
      amount: body.amount,
      market: market ?? null,
      chainId: 5042002,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      nonce: String(Date.now()),
    }));
  });

const borrowAction = route
  .post("/lending/borrow")
  .body(
    z.object({
      marketId: z.string().min(1),
      borrower: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      borrowAmount: z.string().regex(/^\d+(\.\d{1,6})?$/),
      collateralAmount: z.string().regex(/^\d+(\.\d{1,6})?$/),
    }),
  )
  .meta({
    mcp: {
      title: "Borrow Against Collateral",
      description:
        "Borrow FX tokens against USDC collateral. Use bufi_borrow_preview first to check health factor. Returns market details and EIP-712 intent parameters. x402: $0.001.",
    },
  })
  .handle(async ({ body }) => {
    const preview = await telaranaService.borrowQuote({
      chainId: 5042002,
      marketId: body.marketId,
      collateralAmount: body.collateralAmount,
      borrowAmount: body.borrowAmount,
    });
    return ok(jsonSafe({
      action: "borrow",
      marketId: body.marketId,
      borrower: body.borrower,
      borrowAmount: body.borrowAmount,
      collateralAmount: body.collateralAmount,
      preview,
      chainId: 5042002,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      nonce: String(Date.now()),
    }));
  });

const repayAction = route
  .post("/lending/repay")
  .body(
    z.object({
      marketId: z.string().min(1),
      borrower: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
    }),
  )
  .meta({
    mcp: {
      title: "Repay Loan",
      description:
        "Repay a lending pool loan. Reduces borrow balance and improves health factor. Returns EIP-712 intent parameters. x402: $0.001.",
    },
  })
  .handle(async ({ body }) => {
    return ok(jsonSafe({
      action: "repay",
      marketId: body.marketId,
      borrower: body.borrower,
      amount: body.amount,
      chainId: 5042002,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      nonce: String(Date.now()),
    }));
  });

const withdrawAction = route
  .post("/lending/withdraw")
  .body(
    z.object({
      marketId: z.string().min(1),
      supplier: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
    }),
  )
  .meta({
    mcp: {
      title: "Withdraw from Lending Pool",
      description:
        "Withdraw previously supplied USDC from a lending pool. Returns EIP-712 intent parameters. x402: $0.001.",
    },
  })
  .handle(async ({ body }) => {
    return ok(jsonSafe({
      action: "withdraw",
      marketId: body.marketId,
      supplier: body.supplier,
      amount: body.amount,
      chainId: 5042002,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      nonce: String(Date.now()),
    }));
  });

export default new Hyper({ prefix: "/api" }).use([
  lendingMarkets,
  borrowPreview,
  supplyAction,
  borrowAction,
  repayAction,
  withdrawAction,
]);
