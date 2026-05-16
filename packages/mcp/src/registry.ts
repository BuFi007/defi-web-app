/**
 * MCP-style tool registry.
 *
 * Tools are just typed handlers with zod-validated I/O, a permission
 * check, optional payment gate, and optional signature gate. They are
 * the unit of work an AI agent can drive — every tool execution is
 * persisted as a `WorkflowState` so callers can resume, audit, and
 * surface progress in the UI.
 */

import type { WalletSession } from "@bufi/shared-types";
import type { z } from "zod";

export interface ToolPermissionContext {
  /** Resolved wallet, if the caller is authenticated. */
  session: WalletSession | null;
  /** Caller-supplied IP / origin for audit logs. */
  origin?: string;
}

export interface ToolDefinition<TInput, TOutput> {
  name: string;
  description: string;
  /** Zod schema for the parsed tool input. */
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  /**
   * Required payment in USDC decimal (e.g. "0.0050") — when set, the
   * caller must hit the x402-gated endpoint and present a receipt.
   */
  requiresPaymentUsdc?: string;
  /**
   * True when the tool's effect requires a wallet signature
   * (EIP-712). The runtime returns a digest to sign before executing.
   */
  requiresSignature?: boolean;
  /** Permission gate — must return true for the call to proceed. */
  canExecute(ctx: ToolPermissionContext, input: TInput): Promise<boolean>;
  /** The actual work. */
  execute(
    ctx: ToolPermissionContext,
    input: TInput,
  ): Promise<TOutput>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();

  register<TIn, TOut>(tool: ToolDefinition<TIn, TOut>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`@bufi/mcp: tool "${tool.name}" already registered`);
    }
    this.tools.set(tool.name, tool as unknown as ToolDefinition<unknown, unknown>);
  }

  list(): Array<{
    name: string;
    description: string;
    requiresPaymentUsdc?: string;
    requiresSignature?: boolean;
  }> {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      requiresPaymentUsdc: t.requiresPaymentUsdc,
      requiresSignature: t.requiresSignature,
    }));
  }

  get(name: string): ToolDefinition<unknown, unknown> | null {
    return this.tools.get(name) ?? null;
  }
}
