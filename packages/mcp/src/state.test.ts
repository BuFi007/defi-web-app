import { describe, expect, test } from "bun:test";

import type { WorkflowState } from "@bufi/shared-types";
import { canTransition, transition } from "./state";

const base: WorkflowState = {
  workflowId: "wf_1",
  toolName: "perps.quote",
  session: { address: null, chainId: null },
  status: "draft",
  input: {},
  createdAt: 0,
  updatedAt: 0,
  audit: [],
};

describe("workflow state machine", () => {
  test("allows draft → pending_payment → running → completed", () => {
    expect(canTransition("draft", "pending_payment")).toBe(true);
    expect(canTransition("pending_payment", "running")).toBe(true);
    expect(canTransition("running", "completed")).toBe(true);
  });

  test("disallows completed → anything", () => {
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("completed", "failed")).toBe(false);
    expect(canTransition("completed", "cancelled")).toBe(false);
  });

  test("disallows skipping running", () => {
    expect(canTransition("draft", "completed")).toBe(false);
    expect(canTransition("pending_payment", "completed")).toBe(false);
  });

  test("transition() appends audit entry", () => {
    const next = transition(base, "pending_payment", {
      actor: "runtime",
      event: "gate.payment",
      at: 100,
    });
    expect(next.status).toBe("pending_payment");
    expect(next.updatedAt).toBe(100);
    expect(next.audit).toEqual([{ at: 100, actor: "runtime", event: "gate.payment" }]);
  });

  test("transition() throws on illegal transition", () => {
    expect(() => transition(base, "completed", { actor: "runtime", event: "bad" })).toThrow();
  });
});
