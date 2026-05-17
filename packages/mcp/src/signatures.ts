import type { ChainId } from "@bufi/shared-types";
import {
  hashTypedData,
  isAddress,
  keccak256,
  toBytes,
  verifyTypedData,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";

export const MCP_WORKFLOW_DOMAIN = {
  name: "BUFX MCP Workflow",
  version: "1",
} as const;

export const MCP_WORKFLOW_TYPES = {
  WorkflowAuthorization: [
    { name: "workflowId", type: "string" },
    { name: "toolName", type: "string" },
    { name: "inputHash", type: "bytes32" },
    { name: "actor", type: "address" },
  ],
} as const;

export interface WorkflowAuthorizationInput {
  chainId: ChainId;
  workflowId: string;
  toolName: string;
  input: unknown;
  actor: string;
}

export interface WorkflowAuthorizationTypedData {
  domain: TypedDataDomain;
  types: typeof MCP_WORKFLOW_TYPES;
  primaryType: "WorkflowAuthorization";
  message: {
    workflowId: string;
    toolName: string;
    inputHash: Hex;
    actor: Address;
  };
}

export function buildWorkflowAuthorizationTypedData(
  args: WorkflowAuthorizationInput,
): WorkflowAuthorizationTypedData {
  if (!isAddress(args.actor)) throw new Error(`invalid workflow actor address: ${args.actor}`);
  return {
    domain: {
      ...MCP_WORKFLOW_DOMAIN,
      chainId: args.chainId,
    },
    types: MCP_WORKFLOW_TYPES,
    primaryType: "WorkflowAuthorization",
    message: {
      workflowId: args.workflowId,
      toolName: args.toolName,
      inputHash: workflowInputHash(args.input),
      actor: args.actor as Address,
    },
  };
}

export function hashWorkflowAuthorization(args: WorkflowAuthorizationInput): Hex {
  return hashTypedData(buildWorkflowAuthorizationTypedData(args));
}

export async function verifyWorkflowAuthorizationSignature(
  args: WorkflowAuthorizationInput & { signature: Hex },
): Promise<boolean> {
  return verifyTypedData({
    ...buildWorkflowAuthorizationTypedData(args),
    address: args.actor as Address,
    signature: args.signature,
  });
}

export function workflowInputHash(input: unknown): Hex {
  return keccak256(toBytes(stableStringify(input)));
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}
