/**
 * Workflow runner — turns a ToolRegistry + WorkflowStore into a
 * gateable execution surface.
 *
 * Lifecycle:
 *   start(toolName, input)
 *     ↳ inputSchema.parse
 *     ↳ canExecute  → permission denied? fail
 *     ↳ requiresSignature? → pending_signature (caller signs, resume verifies)
 *     ↳ requiresPaymentUsdc? → pending_payment (caller pays via x402, calls resume)
 *     ↳ run() → completed
 *
 * AI tools never bypass the gates — `start` and `resume` are the only
 * entry points and they always check the gate flags before executing.
 */

import type { WalletSession, WorkflowState, WorkflowStatus } from "@bufi/shared-types";
import type { Hex } from "viem";

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
  buildSignatureDigest?: (args: SignatureDigestArgs) => Hex;
  /** Verifies the supplied wallet signature before a signature-gated tool can run. */
  verifySignature?: (args: SignatureVerificationArgs) => boolean | Promise<boolean>;
}

export interface SignatureDigestArgs {
  toolName: string;
  input: unknown;
  workflowId: string;
  session: WalletSession;
}

export interface SignatureVerificationArgs extends SignatureDigestArgs {
  digest: Hex;
  signature: Hex;
  workflow: WorkflowState;
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
    if (tool.requiresSignature && !args.session) {
      throw new Error(`tool ${args.toolName} requires a wallet session for its signature gate`);
    }
    if (tool.requiresSignature && (!this.deps.buildSignatureDigest || !this.deps.verifySignature)) {
      throw new Error(`tool ${args.toolName} requires a signature gate but signature verification is not configured`);
    }

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

    if (tool.requiresSignature && this.deps.buildSignatureDigest && args.session) {
      const digest = this.deps.buildSignatureDigest({
        toolName: args.toolName,
        input: parsed.data,
        workflowId: state.workflowId,
        session: args.session,
      });
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
      const tool = this.deps.registry.get(state.toolName);
      if (!tool) throw new Error(`unknown tool "${state.toolName}"`);
      const session = nullableSession(state.session);
      if (!session) throw new Error(`workflow ${workflowId} has no wallet session for signature verification`);
      if (!state.requiredSignatureDigest) {
        throw new Error(`workflow ${workflowId} is missing its required signature digest`);
      }
      if (!this.deps.verifySignature) {
        throw new Error(`workflow ${workflowId} requires signature verification but no verifier is configured`);
      }
      const signature = signal.signature as Hex;
      const verified = await this.deps.verifySignature({
        toolName: state.toolName,
        input: state.input,
        workflowId: state.workflowId,
        session,
        workflow: state,
        digest: state.requiredSignatureDigest,
        signature,
      });
      if (!verified) throw new Error(`invalid workflow signature for ${workflowId}`);
      if (tool.requiresPaymentUsdc) {
        const payment = transition(
          {
            ...state,
            requiredPaymentMicro: state.requiredPaymentMicro ?? toMicro(tool.requiresPaymentUsdc),
          },
          "pending_payment",
          {
            actor: "runtime",
            event: "signature.accepted",
            data: { digest: state.requiredSignatureDigest, signature: redactSignature(signature), nextGate: "payment" },
          },
        );
        await this.deps.store.put(payment);
        return payment;
      }
      const signed = transition(state, "running", {
        actor: "runtime",
        event: "signature.accepted",
        data: { digest: state.requiredSignatureDigest, signature: redactSignature(signature) },
      });
      await this.deps.store.put(signed);
      return this.runExecution(signed);
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

function redactSignature(signature: Hex): string {
  return `${signature.slice(0, 10)}...${signature.slice(-8)}`;
}

function _statusUnused(_s: WorkflowStatus): void {
  // type-only re-export guard
}
