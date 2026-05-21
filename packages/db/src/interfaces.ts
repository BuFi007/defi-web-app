import type {
  ArcadeRoom,
  DomainEvent,
  FxLoanPosition,
  MarketRegistryEntry,
  PerpIntent,
  PerpQuote,
  WorkflowState,
  WorkflowStatus,
} from "@bufi/shared-types";

export interface TradingMachineReadStore {
  markets(chainId?: number): Promise<MarketRegistryEntry[]>;
  perpPositions(address: string): Promise<PerpQuote[]>;
  perpIntent(intentId: string): Promise<PerpIntent | null>;
  bentoRooms(status?: ArcadeRoom["status"]): Promise<ArcadeRoom[]>;
  bentoRoom(roomId: string): Promise<ArcadeRoom | null>;
  telaranaPositions(address: string): Promise<FxLoanPosition[]>;
}

export interface WorkflowPersistence {
  create(state: WorkflowState): Promise<void>;
  get(workflowId: string): Promise<WorkflowState | null>;
  put(state: WorkflowState): Promise<void>;
  list(filter?: { actor?: string; status?: WorkflowStatus }): Promise<WorkflowState[]>;
}

export interface PerpsIntentPersistence {
  put(intent: PerpIntent): Promise<void>;
  get(intentId: string): Promise<PerpIntent | null>;
  getByTraderNonce(trader: string, nonce: bigint): Promise<PerpIntent | null>;
  list(filter?: { trader?: string; status?: PerpIntent["status"] }): Promise<PerpIntent[]>;
  updateStatus(intentId: string, status: PerpIntent["status"]): Promise<PerpIntent>;
  recordFill(intentId: string, fillSizeDelta: bigint): Promise<PerpIntent>;
}

export interface PaymentReceiptRecord {
  payer: string;
  amountUsdc: string;
  settlementTx: string;
  network: string;
  receiptId: string;
  paidAtUnixSeconds: number;
}

export interface StoredPaymentReceiptRecord extends PaymentReceiptRecord {
  toolName: string;
}

export interface ReceiptPersistence {
  put(toolName: string, receipt: PaymentReceiptRecord): Promise<void>;
  list(filter: { toolName?: string; payer?: string }): Promise<StoredPaymentReceiptRecord[]>;
  has(receiptId: string): Promise<boolean>;
  get(receiptId: string): Promise<StoredPaymentReceiptRecord | null>;
}

export interface DomainEventPersistence {
  put(event: DomainEvent): Promise<void>;
  get(eventId: string): Promise<DomainEvent | null>;
  list(filter?: {
    type?: string;
    actor?: string;
    aggregateId?: string;
    after?: number;
    limit?: number;
  }): Promise<DomainEvent[]>;
}

export interface TradingMachineDb {
  readonly path: string;
  readonly perpsIntents: PerpsIntentPersistence;
  readonly workflows: WorkflowPersistence;
  readonly receipts: ReceiptPersistence;
  readonly events: DomainEventPersistence;
  readonly readStore: TradingMachineReadStore;
  close(): void;
}

export interface CreateSqliteTradingMachineDbOptions {
  path: string;
}

export interface CreatePostgresTradingMachineDbOptions {
  connectionString: string;
}
