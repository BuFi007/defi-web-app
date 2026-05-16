/**
 * Workflow runner — turns a ToolRegistry + WorkflowStore into a
 * gateable execution surface.
 *
 * Lifecycle:
 *   start(toolName, input)
 *     ↳ inputSchema.parse
 *     ↳ canExecute  → permission denied? fail
 *     ↳ requiresSignature? → pending_signature (caller signs, calls resume)
 *     ↳ requiresPaymentUsdc? → pending_payment (caller pays via x402, calls resume)
 *     ↳ run() → completed
 *
 * AI tools never bypass the gates — `start` and `resume` are the only
 * entry points and they always check the gate flags before executing.
 */

import type { WalletSession, WorkflowState, WorkflowStatus } from "@bufi/shared-types";

import type { ToolRegistry } from "./registry";
import { transition, type WorkflowStore } from "./state";

export interface StartArgs {
  toolName: string;
  input: Record<string, unknown>;
  session: WalletSession | null;
}

export interface RunnerDeps {
  registry: ToolRegistry;
  store: WorkflowStore;
  newWorkflowId?: () => string;
  /** Optional signature digest builder for tools that need EIP-712. */
  buildSignatureDigest?: (toolName: string, input: unknown) => `0x${string}`;
}

export class WorkflowRunner {
  constructor(private readonly deps: RunnerDeps) {}

  private id(): string {
    return (this.deps.newWorkflowId ?? defaultId)();
  }

  async start(args: StartArgs): Promise<WorkflowState> {
    const tool = this.deps.registry.get(args.toolName);
    if (!tool) throw new Error(`unknown tool "${args.toolName}"`);

    const parsed = tool.inputSchema.safeParse(args.input);
    if (!parsed.success) {
      throw new Error(
        `invalid input for ${args.toolName}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    const allowed = await tool.canExecute({ session: args.session }, parsed.data);
    if (!allowed) throw new Error(`permission denied for ${args.toolName}`);

    const now = Math.floor(Date.now() / 1000);
    let state: WorkflowState = {
      workflowId: this.id(),
      toolName: args.toolName,
      session: args.session ?? { address: null, chainId: null },
      status: "draft",
      input: parsed.data as Record<string, unknown>,
      requiredPaymentMicro: undefined,
      requiredSignatureDigest: undefined,
      createdAt: now,
      updatedAt: now,
      audit: [{ at: now, actor: args.session?.address ?? "anon", event: "draft.created" }],
    };
    await this.deps.store.create(state);

    if (tool.requiresSignature && this.deps.buildSignatureDigest) {
      const digest = this.deps.buildSignatureDigest(args.toolName, parsed.data);
      state = transition(
        { ...state, requiredSignatureDigest: digest },
        "pending_signature",
        { actor: "runtime", event: "gate.signature" },
      );
      await this.deps.store.put(state);
      return state;
    }
    if (tool.requiresPaymentUsdc) {
      state = transition(
        { ...state, requiredPaymentMicro: toMicro(tool.requiresPaymentUsdc) },
        "pending_payment",
        { actor: "runtime", event: "gate.payment" },
      );
      await this.deps.store.put(state);
      return state;
    }
    return this.runExecution(state);
  }

  async resume(workflowId: string, signal: { signature?: string; receiptId?: string }) {
    const state = await this.deps.store.get(workflowId);
    if (!state) throw new Error(`unknown workflow ${workflowId}`);
    if (state.status === "pending_signature" && signal.signature) {
      const next = transition(state, "running", {
        actor: "runtime",
        event: "signature.accepted",
        data: { signature: signal.signature },
      });
      await this.deps.store.put(next);
      return this.runExecution(next);
    }
    if (state.status === "pending_payment" && signal.receiptId) {
      const next = transition(state, "running", {
        actor: "runtime",
        event: "payment.accepted",
        data: { receiptId: signal.receiptId },
      });
      await this.deps.store.put(next);
      return this.runExecution(next);
    }
    throw new Error(
      `cannot resume workflow ${workflowId} from status=${state.status} with the provided signal`,
    );
  }

  private async runExecution(state: WorkflowState): Promise<WorkflowState> {
    const tool = this.deps.registry.get(state.toolName);
    if (!tool) throw new Error(`tool disappeared mid-flight: ${state.toolName}`);
    const running =
      state.status === "running" ? state : transition(state, "running", { actor: "runtime", event: "execution.start" });
    if (running !== state) await this.deps.store.put(running);
    try {
      const output = await tool.execute(
        { session: nullableSession(running.session) },
        running.input,
      );
      const completed = transition(running, "completed", {
        actor: "runtime",
        event: "execution.completed",
      });
      const final: WorkflowState = { ...completed, output: output as Record<string, unknown> };
      await this.deps.store.put(final);
      return final;
    } catch (e) {
      const failed = transition(running, "failed", {
        actor: "runtime",
        event: "execution.failed",
        data: { error: (e as Error).message },
      });
      await this.deps.store.put(failed);
      throw e;
    }
  }
}

function defaultId(): string {
  const r = Math.random().toString(36).slice(2, 10);
  return `wf_${Date.now().toString(36)}_${r}`;
}

function toMicro(usdc: string): string {
  const [whole, frac = ""] = usdc.split(".");
  const padded = (frac + "000000").slice(0, 6);
  return (BigInt(whole) * 1_000_000n + BigInt(padded || "0")).toString();
}

function nullableSession(s: WorkflowState["session"]): WalletSession | null {
  if (!s || s.address === null) return null;
  return s as WalletSession;
}

function _statusUnused(_s: WorkflowStatus): void {
  // type-only re-export guard
}
