/**
 * In-memory receipt store. Production should swap this for a Postgres-
 * backed implementation — interface is the same so the middleware
 * doesn't change.
 */

import type { PaymentReceipt } from "./types";

export interface ReceiptStore {
  put(toolName: string, receipt: PaymentReceipt): Promise<void>;
  list(filter: { toolName?: string; payer?: string }): Promise<PaymentReceipt[]>;
  has(receiptId: string): Promise<boolean>;
}

export function createInMemoryReceiptStore(): ReceiptStore {
  const byId = new Map<string, PaymentReceipt>();
  const byTool = new Map<string, PaymentReceipt[]>();
  return {
    async put(toolName, receipt) {
      byId.set(receipt.receiptId, receipt);
      const list = byTool.get(toolName) ?? [];
      list.push(receipt);
      byTool.set(toolName, list);
    },
    async list(filter) {
      const all = filter.toolName ? (byTool.get(filter.toolName) ?? []) : [...byId.values()];
      if (!filter.payer) return all;
      return all.filter((r) => r.payer.toLowerCase() === filter.payer!.toLowerCase());
    },
    async has(receiptId) {
      return byId.has(receiptId);
    },
  };
}
