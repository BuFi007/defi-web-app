import { Hono } from "hono";
import { z } from "zod";

import {
  ToolRegistry,
  WorkflowRunner,
  createInMemoryWorkflowStore,
  defaultToolDescriptors,
} from "@bufi/mcp";

import type { WalletSession } from "@bufi/shared-types";

const mcpRoutes = new Hono();

// Build a runtime singleton. Tools register no-op `execute` handlers
// here — wire real handlers in apps/api/src/wiring.ts as each domain
// lands.
const registry = new ToolRegistry();
for (const t of defaultToolDescriptors()) {
  registry.register({
    ...t,
    async canExecute() {
      return true;
    },
    async execute() {
      throw new Error(`tool ${t.name} not wired — implement in apps/api`);
    },
  });
}

const runner = new WorkflowRunner({
  registry,
  store: createInMemoryWorkflowStore(),
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
    const state = await runner.start({
      toolName: parsed.data.toolName,
      input: parsed.data.input,
      session,
    });
    return c.json({ workflow: state });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

mcpRoutes.get("/workflows/:id", async (_c) => {
  // TODO: persistent store lookup; the in-memory runner doesn't expose `store.get` yet here.
  return _c.json({ error: "not implemented in scaffold" }, 501);
});

mcpRoutes.post("/workflows/:id/run", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = resumeBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body", issues: parsed.error.issues }, 400);
  try {
    const state = await runner.resume(c.req.param("id"), parsed.data);
    return c.json({ workflow: state });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

export { mcpRoutes };
