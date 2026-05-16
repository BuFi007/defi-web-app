/**
 * Workflow state machine.
 *
 *   draft → pending_signature ↘
 *         ↘ pending_payment    → running → (completed | failed)
 *         ↘ running           ↗
 *   any state → cancelled (caller abort)
 *
 * No transition shortcuts: the runtime sets `pending_*` exactly when a
 * gate is unresolved, then advances to `running` once the gate is
 * cleared.
 */

import type { WorkflowAuditEntry, WorkflowState, WorkflowStatus } from "@bufi/shared-types";

const allowed: Record<WorkflowStatus, WorkflowStatus[]> = {
  draft: ["pending_signature", "pending_payment", "running", "cancelled"],
  pending_signature: ["pending_payment", "running", "failed", "cancelled"],
  pending_payment: ["running", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return allowed[from].includes(to);
}

export function transition(
  state: WorkflowState,
  to: WorkflowStatus,
  audit: Omit<WorkflowAuditEntry, "at"> & { at?: number },
): WorkflowState {
  if (!canTransition(state.status, to)) {
    throw new Error(
      `@bufi/mcp: illegal transition ${state.status} → ${to} on workflow ${state.workflowId}`,
    );
  }
  const at = audit.at ?? Math.floor(Date.now() / 1000);
  return {
    ...state,
    status: to,
    updatedAt: at,
    audit: [...state.audit, { ...audit, at }],
  };
}

export interface WorkflowStore {
  create(state: WorkflowState): Promise<void>;
  get(workflowId: string): Promise<WorkflowState | null>;
  put(state: WorkflowState): Promise<void>;
  list(filter?: { actor?: string; status?: WorkflowStatus }): Promise<WorkflowState[]>;
}

export function createInMemoryWorkflowStore(): WorkflowStore {
  const map = new Map<string, WorkflowState>();
  return {
    async create(state) {
      if (map.has(state.workflowId)) {
        throw new Error(`workflow ${state.workflowId} already exists`);
      }
      map.set(state.workflowId, state);
    },
    async get(id) {
      return map.get(id) ?? null;
    },
    async put(state) {
      if (!map.has(state.workflowId)) {
        throw new Error(`workflow ${state.workflowId} does not exist`);
      }
      map.set(state.workflowId, state);
    },
    async list(filter) {
      const all = [...map.values()];
      return all.filter((w) => {
        if (filter?.status && w.status !== filter.status) return false;
        if (filter?.actor && w.session?.address?.toLowerCase() !== filter.actor.toLowerCase()) {
          return false;
        }
        return true;
      });
    },
  };
}
