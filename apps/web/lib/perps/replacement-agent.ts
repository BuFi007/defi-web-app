import type { Hex } from "viem";

// Session-signing primitives now live in @bufi/wallet -- a single
// canonical source for the typed-data builder, plain-text fallback,
// localStorage cache, and HTTP-header serialiser. The three signing
// surfaces in this app (useEnsureSession, useSessionSigner in perps/
// hooks, ensureSession in telarana/hooks) ALL route through them, so a
// session signed via the perps replacement agent is reused by the next
// useEnsureSession() call and vice versa. Re-exported here so every
// existing import from `@/lib/perps/replacement-agent` keeps working
// without a sweeping rename.
export {
  buildWalletSessionMessage,
  buildWalletSessionTypedData,
  walletSessionHeaders,
  serializeWalletSessionTypedData,
  readCachedWalletSession,
  writeCachedWalletSession,
  clearCachedWalletSession,
  type WalletSessionHeaders,
  type WalletSessionProof,
  type WalletSessionTypedData,
} from "@bufi/wallet/session";

const DEFAULT_API_URL = "http://localhost:3002";
const HANDLED_LIMIT = 200;

import type { WalletSessionHeaders } from "@bufi/wallet/session";

export interface PerpsReplacementNeededEvent {
  eventId: string;
  type: "bufx.perps.replacement_needed";
  aggregateId: string;
  actor?: string;
  createdAt: number;
  payload: {
    intentId: string;
    remainingSizeDelta: string;
    prepareApiPath: string;
    mcpToolName: "bufx.intent.perp.replace";
    marketId?: string;
    settlementTx?: string;
    [key: string]: unknown;
  };
}

export interface PerpsReplacementPrepareResponse {
  originalIntentId: string;
  replacementOf: string;
  remainingSizeDelta: string;
  digest: Hex;
  typedData: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: `0x${string}`;
    };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  };
}

export function bufxApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_BUFI_API_URL ?? DEFAULT_API_URL;
}

export function bufxApiUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(path, bufxApiBaseUrl());
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

// (Session builders + cache moved to @bufi/wallet/session — re-exported
// from the top of this file. The body lived here from the
// before-@bufi/wallet era; deleted to keep one source of truth.)

export function freshReplacementNonce(): string {
  const random = new Uint32Array(1);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(random);
  } else {
    random[0] = Math.floor(Math.random() * 2 ** 32);
  }
  return (BigInt(Date.now()) * 1_000_000n + BigInt(random[0]! % 1_000_000)).toString();
}

export function replacementDeadline(ttlSeconds = 15 * 60): number {
  return Math.floor(Date.now() / 1000) + ttlSeconds;
}

export async function fetchReplacementNeededEvents(args: {
  headers: WalletSessionHeaders;
  after?: number;
  limit?: number;
  signal?: AbortSignal;
}): Promise<PerpsReplacementNeededEvent[]> {
  const res = await fetch(
    bufxApiUrl("/perps/replacement-needed", {
      after: args.after,
      limit: args.limit,
    }),
    {
      method: "GET",
      headers: {
        accept: "application/json",
        ...args.headers,
      },
      signal: args.signal,
    },
  );
  if (!res.ok) throw await responseError(res, "/perps/replacement-needed");
  const body = (await res.json()) as { events: PerpsReplacementNeededEvent[] };
  return body.events;
}

export async function prepareReplacementOrder(args: {
  event: PerpsReplacementNeededEvent;
  headers: WalletSessionHeaders;
  nonce: string;
  deadline: number;
  signal?: AbortSignal;
}): Promise<PerpsReplacementPrepareResponse> {
  const path = args.event.payload.prepareApiPath;
  const res = await fetch(bufxApiUrl(path), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...args.headers,
    },
    body: JSON.stringify({ nonce: args.nonce, deadline: args.deadline }),
    signal: args.signal,
  });
  if (!res.ok) throw await responseError(res, path);
  return (await res.json()) as PerpsReplacementPrepareResponse;
}

export async function submitReplacementOrder(args: {
  event: PerpsReplacementNeededEvent;
  headers: WalletSessionHeaders;
  nonce: string;
  deadline: number;
  signature: Hex;
}): Promise<unknown> {
  const submitPath = args.event.payload.prepareApiPath.replace(/\/prepare$/, "");
  const res = await fetch(bufxApiUrl(submitPath), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...args.headers,
    },
    body: JSON.stringify({
      nonce: args.nonce,
      deadline: args.deadline,
      signature: args.signature,
    }),
  });
  if (!res.ok) throw await responseError(res, submitPath);
  return res.json();
}

export function normalizeReplacementTypedData(
  value: PerpsReplacementPrepareResponse | PerpsReplacementPrepareResponse["typedData"],
) {
  const typedData = "typedData" in value ? value.typedData : value;
  return {
    ...typedData,
    message: {
      ...typedData.message,
      sizeDeltaE18: BigInt(String(typedData.message.sizeDeltaE18)),
      priceE18: BigInt(String(typedData.message.priceE18)),
      nonce: BigInt(String(typedData.message.nonce)),
      deadline: BigInt(String(typedData.message.deadline)),
    },
  };
}

export function readReplacementCursor(address: string): number | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(replacementCursorKey(address));
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function writeReplacementCursor(address: string, cursor: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(replacementCursorKey(address), String(cursor));
}

export function readHandledReplacementEvents(address: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  const raw = window.localStorage.getItem(replacementHandledKey(address));
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

export function markReplacementEventHandled(address: string, eventId: string): void {
  if (typeof window === "undefined") return;
  const current = [...readHandledReplacementEvents(address), eventId].slice(-HANDLED_LIMIT);
  window.localStorage.setItem(replacementHandledKey(address), JSON.stringify([...new Set(current)]));
}

async function responseError(res: Response, path: string): Promise<Error> {
  const text = await res.text();
  const message = safeErrorMessage(text);
  return new Error(`BUFX API ${path} -> ${res.status}: ${message}`);
}

function safeErrorMessage(text: string): string {
  try {
    const json = JSON.parse(text) as { error?: unknown };
    return typeof json.error === "string" ? json.error : text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

function replacementCursorKey(address: string): string {
  return `bufx.perps.replacement-agent.cursor:${address.toLowerCase()}`;
}

function replacementHandledKey(address: string): string {
  return `bufx.perps.replacement-agent.handled:${address.toLowerCase()}`;
}
