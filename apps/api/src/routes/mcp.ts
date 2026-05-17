import { Hono } from "hono";
import { z } from "zod";

import {
  ToolRegistry,
  WorkflowRunner,
  defaultToolDescriptors,
  hashWorkflowAuthorization,
  verifyWorkflowAuthorizationSignature,
} from "@bufi/mcp";
import { buildVenueSpotIntent } from "@bufi/fx-spot";
import { buildPerpsOrderTypedData, hashPerpsOrder } from "@bufi/perps";
import { SPOT_FX_ROUTES } from "@bufi/contracts";

import type { ChainId, WalletSession } from "@bufi/shared-types";

import {
  bentoService,
  errorStatus,
  hermes,
  jsonSafe,
  perpsService,
  receiptStore,
  telaranaService,
  tradingDb,
} from "../services";

const mcpRoutes = new Hono();

const registry = new ToolRegistry();

for (const t of defaultToolDescriptors()) {
  registry.register({
    ...t,
    async canExecute(ctx) {
      if (t.requiresSignature && !ctx.session) return false;
      return true;
    },
    execute: (ctx, input) => executeTool(t.name, ctx.session, input as Record<string, unknown>),
  });
}

const store = tradingDb.workflows;
const runner = new WorkflowRunner({
  registry,
  store,
  buildSignatureDigest({ toolName, input, workflowId, session }) {
    return hashWorkflowAuthorization({
      chainId: session.chainId,
      workflowId,
      toolName,
      input,
      actor: session.address,
    });
  },
  verifySignature({ toolName, input, workflowId, session, digest, signature }) {
    const expected = hashWorkflowAuthorization({
      chainId: session.chainId,
      workflowId,
      toolName,
      input,
      actor: session.address,
    });
    if (expected !== digest) return false;
    return verifyWorkflowAuthorizationSignature({
      chainId: session.chainId,
      workflowId,
      toolName,
      input,
      actor: session.address,
      signature,
    });
  },
});

const startBody = z.object({
  toolName: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
});

const resumeBody = z.object({
  signature: z.string().optional(),
  receiptId: z.string().optional(),
});

mcpRoutes.get("/tools", (c) => c.json({ tools: registry.list() }));

mcpRoutes.post("/workflows", async (c) => {
  const session = c.get("walletSession") as WalletSession | null;
  const raw = await c.req.json().catch(() => ({}));
  const parsed = startBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  try {
    return c.json({
      workflow: await runner.start({
        toolName: parsed.data.toolName,
        input: parsed.data.input,
        session,
      }),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

mcpRoutes.get("/workflows/:id", async (c) => {
  const workflow = await store.get(c.req.param("id"));
  if (!workflow) return c.json({ error: "workflow not found" }, 404);
  return c.json(jsonSafe({ workflow }));
});

mcpRoutes.post("/workflows/:id/run", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = resumeBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  try {
    if (parsed.data.receiptId) {
      const workflow = await store.get(c.req.param("id"));
      if (!workflow) return c.json({ error: "workflow not found" }, 404);
      const receipt = await receiptStore.get(parsed.data.receiptId);
      if (!receipt) return c.json({ error: "payment receipt not found or not verified" }, 402);
      if (receipt.toolName !== workflow.toolName) {
        return c.json({ error: "payment receipt is not scoped to this workflow tool" }, 402);
      }
      const actor = workflow.session.address;
      if (actor && receipt.payer.toLowerCase() !== actor.toLowerCase()) {
        return c.json({ error: "payment receipt payer does not match workflow actor" }, 402);
      }
      if (
        workflow.requiredPaymentMicro &&
        BigInt(receipt.amountUsdc) < BigInt(workflow.requiredPaymentMicro)
      ) {
        return c.json({ error: "payment receipt amount is below workflow requirement" }, 402);
      }
    }
    return c.json(jsonSafe({ workflow: await runner.resume(c.req.param("id"), parsed.data) }));
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

async function executeTool(
  toolName: string,
  session: WalletSession | null,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (toolName) {
    case "bufx.quote.spot": {
      const symbol = input.symbol as keyof typeof SPOT_FX_ROUTES;
      const route = SPOT_FX_ROUTES[symbol];
      const latest = await hermes.latestPriceUpdates([route.pythFeedId]);
      const price = latest.prices[0];
      return {
        symbol,
        routeId: route.routeId,
        price: price?.price.price ?? null,
        minAmountOut: null,
        oracleStaleSeconds: price ? Math.floor(Date.now() / 1000) - price.price.publish_time : null,
      };
    }
    case "bufx.quote.perp":
      return perpsService.quote(input as never) as never;
    case "bufx.preview.borrow":
      return telaranaService.borrowQuote(input as never) as never;
    case "bufx.intent.spot": {
      assertSessionOwnsAddress(session, String(input.trader), "trader");
      const built = buildVenueSpotIntent({
        symbol: input.symbol as "EURC" | "JPYC" | "MXNB" | "CHFC",
        trader: String(input.trader),
        amountIn: String(input.amountInAtomic),
        minAmountOut: String(input.minAmountOutAtomic),
        deadline: Number(input.deadline),
        nonce: String(input.nonce),
      });
      return jsonSafe({ digest: built.digest, typedData: built.typedData, calldata: built.calldata });
    }
    case "bufx.intent.perp.open": {
      assertSessionOwnsAddress(session, String(input.trader), "trader");
      const order = {
        chainId: Number(input.chainId) as ChainId,
        marketId: String(input.marketId),
        side: input.side as "long" | "short",
        sizeUsdc: String(input.sizeUsdc),
        sizeDelta: input.sizeDelta ? String(input.sizeDelta) : undefined,
        leverage: Number(input.leverage),
        trader: String(input.trader),
        deadline: Number(input.deadline),
        nonce: String(input.nonce),
        orderType: (input.orderType ?? "limit") as "limit" | "market",
        limitPrice: input.limitPrice ? String(input.limitPrice) : undefined,
        priceE18: input.priceE18 ? String(input.priceE18) : undefined,
        reduceOnly: Boolean(input.reduceOnly ?? false),
        postOnly: Boolean(input.postOnly ?? false),
      };
      return jsonSafe({
        digest: hashPerpsOrder(order),
        typedData: buildPerpsOrderTypedData(order),
      });
    }
    case "bufx.intent.perp.replace": {
      const originalIntentId = String(input.originalIntentId);
      const original = await perpsService.getIntent(originalIntentId);
      if (!original) throw new Error(`perps intent not found: ${originalIntentId}`);
      assertSessionOwnsAddress(session, original.trader, "trader");
      return jsonSafe(
        await perpsService.prepareReplacementIntent({
          originalIntentId,
          deadline: Number(input.deadline),
          nonce: String(input.nonce),
          sizeUsdc: input.sizeUsdc ? String(input.sizeUsdc) : undefined,
          orderType: input.orderType ? (input.orderType as "limit" | "market") : undefined,
          limitPrice: input.limitPrice ? String(input.limitPrice) : undefined,
          priceE18: input.priceE18 ? String(input.priceE18) : undefined,
          reduceOnly: input.reduceOnly === undefined ? undefined : Boolean(input.reduceOnly),
          postOnly: input.postOnly === undefined ? undefined : Boolean(input.postOnly),
        }),
      );
    }
    case "bufx.bento.room.create": {
      const room = await bentoService.createRoom({
        ...input,
        rakeBps: Number(input.rakeBps ?? 500),
      } as never);
      return {
        roomId: room.roomId,
        entryUrl: `/fx-bento/${room.roomId}`,
      };
    }
    case "bufx.inspect.position":
      if (!session || String(input.address).toLowerCase() !== session.address.toLowerCase()) {
        throw new Error("wallet signature required for private position inspection");
      }
      return { source: "reconciled", positions: await perpsService.listPositions(String(input.address)) };
    case "bufx.inspect.liquidatable":
      return { candidates: await perpsService.liquidationCandidates(Number(input.chainId)) };
    case "bufx.inspect.oracle":
      return { stale: true, lastUpdate: null, staleSeconds: null, confidence: null };
    case "bufx.indexer.sync":
      return { triggeredAt: Math.floor(Date.now() / 1000) };
    default:
      throw new Error(`tool ${toolName} is not registered`);
  }
}

function assertSessionOwnsAddress(
  session: WalletSession | null,
  address: string,
  label: string,
): void {
  if (!session) throw new Error("wallet signature required");
  if (session.address.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`${label} must match session address`);
  }
}

export { mcpRoutes };
