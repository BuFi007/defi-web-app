import type {
  PerpsIndexedPosition,
  PerpsIndexedPositionEvent,
  PerpsIndexedSettlement,
  PerpsPositionReader,
} from "@bufi/perps";

type RawPonderSettlement = Record<string, unknown>;

export interface PonderPerpsSettlementFilter {
  chainId: number;
  /** Optional — when omitted, matches all markets for the trader. */
  marketId?: string;
  trader: string;
  txHash?: string;
  limit?: number;
}

export interface PonderPerpsPositionEventFilter {
  chainId: number;
  trader: string;
  /** Restrict to `"increased"` / `"decreased"` etc. when set. */
  kind?: string;
  txHash?: string;
  marketId?: string;
  limit?: number;
}

export interface PonderPerpsSettlementReader {
  listSettlements(filter: PonderPerpsSettlementFilter): Promise<PerpsIndexedSettlement[]>;
  listPositionEvents(
    filter: PonderPerpsPositionEventFilter,
  ): Promise<PerpsIndexedPositionEvent[]>;
}

export function createPonderPerpsSettlementReaderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PonderPerpsSettlementReader | null {
  const graphqlUrl = env.ENVIO_GRAPHQL_URL ?? env.ENVIO_URL ?? env.PONDER_GRAPHQL_URL ?? env.PONDER_URL;
  if (!graphqlUrl) return null;
  return createPonderPerpsSettlementReader(graphqlUrl);
}

export function createPonderPerpsSettlementReader(graphqlUrl: string): PonderPerpsSettlementReader {
  return {
    async listSettlements(filter) {
      const rows = await fetchPerpsSettlements(graphqlUrl, filter.limit ?? 200);
      const trader = filter.trader.toLowerCase();
      const marketId = filter.marketId?.toLowerCase();
      const txHash = filter.txHash?.toLowerCase();
      return rows.filter((row) => {
        if (row.chainId !== filter.chainId) return false;
        if (marketId && row.marketId.toLowerCase() !== marketId) return false;
        if (txHash && row.txHash?.toLowerCase() !== txHash) return false;
        return row.maker.toLowerCase() === trader || row.taker.toLowerCase() === trader;
      });
    },
    async listPositionEvents(filter) {
      const rows = await fetchPerpsPositionEvents(graphqlUrl, filter.limit ?? 200);
      const trader = filter.trader.toLowerCase();
      const marketId = filter.marketId?.toLowerCase();
      const txHash = filter.txHash?.toLowerCase();
      return rows.filter((row) => {
        if (row.chainId !== filter.chainId) return false;
        if (row.trader.toLowerCase() !== trader) return false;
        if (filter.kind && row.kind !== filter.kind) return false;
        if (marketId && row.marketId.toLowerCase() !== marketId) return false;
        if (txHash && row.txHash?.toLowerCase() !== txHash) return false;
        return true;
      });
    },
  };
}

export function createPonderPerpsPositionReaderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PerpsPositionReader | null {
  const graphqlUrl = env.ENVIO_GRAPHQL_URL ?? env.ENVIO_URL ?? env.PONDER_GRAPHQL_URL ?? env.PONDER_URL;
  if (!graphqlUrl) return null;
  return createPonderPerpsPositionReader(graphqlUrl);
}

export function createPonderPerpsPositionReader(graphqlUrl: string): PerpsPositionReader {
  return {
    async listOpenPositions(filter) {
      const rows = await fetchPerpsPositions(graphqlUrl);
      const trader = filter.trader.toLowerCase();
      return rows.filter(
        (row) => row.chainId === filter.chainId && row.trader.toLowerCase() === trader,
      );
    },
  };
}

async function fetchPerpsPositions(graphqlUrl: string): Promise<PerpsIndexedPosition[]> {
  const query = `
    query PerpsPositions {
      perpsPositions {
        items {
          chainId
          marketId
          trader
          sizeE18
          entryPriceE18
          marginReserved
          lastFundingVersion
          isOpen
          updatedAt
          updatedBlockNumber
          updatedTxHash
        }
      }
    }
  `;
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    throw new Error(`Ponder GraphQL request failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    data?: { perpsPositions?: { items?: unknown[] } };
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message ?? "GraphQL error").join("; "));
  }
  const items = payload.data?.perpsPositions?.items;
  if (!Array.isArray(items)) {
    throw new Error("Ponder GraphQL response invalid: perpsPositions.items must be an array");
  }
  return items.map((row, index) => normalizePositionRow(row, index));
}

function normalizePositionRow(value: unknown, index: number): PerpsIndexedPosition {
  if (!isRecord(value)) {
    throw new Error(`Ponder GraphQL response invalid: position[${index}] must be an object`);
  }
  return {
    chainId: requiredInteger(value, "chainId", index),
    marketId: requiredHex(value, "marketId", index),
    trader: requiredHex(value, "trader", index),
    sizeE18: requiredIntString(value, "sizeE18", index),
    entryPriceE18: requiredUintString(value, "entryPriceE18", index),
    marginReserved: requiredUintString(value, "marginReserved", index),
    lastFundingVersion: optionalUintString(value, "lastFundingVersion", index),
    isOpen: Boolean(value.isOpen),
    updatedAt: optionalUintString(value, "updatedAt", index),
    updatedBlockNumber: optionalUintString(value, "updatedBlockNumber", index),
    updatedTxHash: optionalHex(value, "updatedTxHash", index),
  };
}

function requiredIntString(row: RawPonderSettlement, key: string, index: number): string {
  const value = row[key];
  if (value === undefined || value === null) throw invalidField(index, key, "int string");
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  throw invalidField(index, key, "int string");
}

async function fetchPerpsPositionEvents(
  graphqlUrl: string,
  limit: number,
): Promise<PerpsIndexedPositionEvent[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  const fields = `
    id
    chainId
    marketId
    trader
    kind
    sizeDeltaE18
    resultingSizeE18
    priceE18
    marginAmount
    fee
    pnl
    badDebt
    blockNumber
    blockTimestamp
    txHash
    logIndex
  `;
  const withArgs = `
    query PerpsPositionEvents($limit: Int!) {
      perpsPositionEvents(limit: $limit, orderBy: "blockNumber", orderDirection: "desc") {
        items { ${fields} }
      }
    }
  `;
  const withoutArgs = `
    query PerpsPositionEvents {
      perpsPositionEvents {
        items { ${fields} }
      }
    }
  `;
  try {
    return await postPonderPositionEventQuery(graphqlUrl, withArgs, { limit: boundedLimit });
  } catch (error) {
    if (!isUnsupportedQueryShapeError(error)) throw error;
    return (await postPonderPositionEventQuery(graphqlUrl, withoutArgs, {})).slice(
      0,
      boundedLimit,
    );
  }
}

async function postPonderPositionEventQuery(
  graphqlUrl: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<PerpsIndexedPositionEvent[]> {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`Ponder GraphQL request failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    data?: { perpsPositionEvents?: { items?: unknown[] } };
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message ?? "GraphQL error").join("; "));
  }
  const items = payload.data?.perpsPositionEvents?.items;
  if (!Array.isArray(items)) {
    throw new Error(
      "Ponder GraphQL response invalid: perpsPositionEvents.items must be an array",
    );
  }
  return items.map((row, index) => normalizePositionEventRow(row, index));
}

function normalizePositionEventRow(value: unknown, index: number): PerpsIndexedPositionEvent {
  if (!isRecord(value)) {
    throw new Error(
      `Ponder GraphQL response invalid: positionEvent[${index}] must be an object`,
    );
  }
  return {
    id: optionalString(value, "id", index),
    chainId: requiredInteger(value, "chainId", index),
    marketId: requiredHex(value, "marketId", index),
    trader: requiredHex(value, "trader", index),
    kind: requiredString(value, "kind", index),
    sizeDeltaE18: requiredIntString(value, "sizeDeltaE18", index),
    resultingSizeE18: requiredIntString(value, "resultingSizeE18", index),
    priceE18: requiredUintString(value, "priceE18", index),
    marginAmount: requiredUintString(value, "marginAmount", index),
    fee: optionalUintString(value, "fee", index) ?? null,
    pnl: optionalIntString(value, "pnl", index) ?? null,
    badDebt: optionalUintString(value, "badDebt", index) ?? null,
    blockNumber: optionalUintString(value, "blockNumber", index),
    blockTimestamp: optionalUintString(value, "blockTimestamp", index),
    txHash: optionalHex(value, "txHash", index),
    logIndex: optionalInteger(value, "logIndex", index),
  };
}

async function fetchPerpsSettlements(
  graphqlUrl: string,
  limit: number,
): Promise<PerpsIndexedSettlement[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  const withArgs = `
    query PerpsSettlements($limit: Int!) {
      perpsSettlements(limit: $limit, orderBy: "blockNumber", orderDirection: "desc") {
        items {
          id
          chainId
          marketId
          maker
          taker
          fillSizeE18
          fillPriceE18
          blockNumber
          blockTimestamp
          txHash
          logIndex
        }
      }
    }
  `;
  const withoutArgs = `
    query PerpsSettlements {
      perpsSettlements {
        items {
          id
          chainId
          marketId
          maker
          taker
          fillSizeE18
          fillPriceE18
          blockNumber
          blockTimestamp
          txHash
          logIndex
        }
      }
    }
  `;

  try {
    return await postPonderQuery(graphqlUrl, withArgs, { limit: boundedLimit });
  } catch (error) {
    if (!isUnsupportedQueryShapeError(error)) throw error;
    return (await postPonderQuery(graphqlUrl, withoutArgs, {})).slice(0, boundedLimit);
  }
}

async function postPonderQuery(
  graphqlUrl: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<PerpsIndexedSettlement[]> {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`Ponder GraphQL request failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    data?: { perpsSettlements?: { items?: PerpsIndexedSettlement[] } };
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message ?? "GraphQL error").join("; "));
  }
  return normalizeSettlementRows(payload.data?.perpsSettlements?.items);
}

function normalizeSettlementRows(value: unknown): PerpsIndexedSettlement[] {
  if (!Array.isArray(value)) {
    throw new Error("Ponder GraphQL response invalid: perpsSettlements.items must be an array");
  }
  return value.map((row, index) => normalizeSettlementRow(row, index));
}

function normalizeSettlementRow(value: unknown, index: number): PerpsIndexedSettlement {
  if (!isRecord(value)) {
    throw new Error(`Ponder GraphQL response invalid: settlement[${index}] must be an object`);
  }
  return {
    id: optionalString(value, "id", index),
    chainId: requiredInteger(value, "chainId", index),
    marketId: requiredHex(value, "marketId", index),
    maker: requiredHex(value, "maker", index),
    taker: requiredHex(value, "taker", index),
    fillSizeE18: requiredUintString(value, "fillSizeE18", index),
    fillPriceE18: requiredUintString(value, "fillPriceE18", index),
    blockNumber: optionalUintString(value, "blockNumber", index),
    blockTimestamp: optionalUintString(value, "blockTimestamp", index),
    txHash: optionalHex(value, "txHash", index),
    logIndex: optionalInteger(value, "logIndex", index),
  };
}

function isRecord(value: unknown): value is RawPonderSettlement {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(row: RawPonderSettlement, key: string, index: number): string | undefined {
  const value = row[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  throw invalidField(index, key, "string");
}

function requiredString(row: RawPonderSettlement, key: string, index: number): string {
  const value = optionalString(row, key, index);
  if (value === undefined) throw invalidField(index, key, "string");
  return value;
}

function optionalIntString(
  row: RawPonderSettlement,
  key: string,
  index: number,
): string | undefined {
  const value = row[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  throw invalidField(index, key, "int string");
}

function requiredHex(row: RawPonderSettlement, key: string, index: number): string {
  const value = optionalHex(row, key, index);
  if (!value) throw invalidField(index, key, "hex string");
  return value;
}

function optionalHex(row: RawPonderSettlement, key: string, index: number): string | undefined {
  const value = row[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && /^0x[a-fA-F0-9]+$/.test(value)) return value;
  throw invalidField(index, key, "hex string");
}

function requiredUintString(row: RawPonderSettlement, key: string, index: number): string {
  const value = optionalUintString(row, key, index);
  if (value === undefined) throw invalidField(index, key, "uint string");
  return value;
}

function optionalUintString(
  row: RawPonderSettlement,
  key: string,
  index: number,
): string | undefined {
  const value = row[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  throw invalidField(index, key, "uint string");
}

function requiredInteger(row: RawPonderSettlement, key: string, index: number): number {
  const value = optionalInteger(row, key, index);
  if (value === undefined) throw invalidField(index, key, "integer");
  return value;
}

function optionalInteger(row: RawPonderSettlement, key: string, index: number): number | undefined {
  const value = row[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw invalidField(index, key, "integer");
}

function invalidField(index: number, key: string, expected: string): Error {
  return new Error(`Ponder GraphQL response invalid: settlement[${index}].${key} must be ${expected}`);
}

function isUnsupportedQueryShapeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Unknown argument") ||
    message.includes("Cannot query field") ||
    message.includes("orderBy") ||
    message.includes("orderDirection") ||
    message.includes("limit")
  );
}
