// Browser-side fetch wrapper for the FX² Arcade backend (`@bufi/api`).
// Mirrors the pattern in lib/perps/replacement-agent.ts → `bufxApiBaseUrl`
// so a single env var (NEXT_PUBLIC_API_URL) drives all backend calls.

import { resilientFetch } from "@/lib/api-client";
import { buildBentoDevSessionHeaders } from "./dev-session";

const DEFAULT_API_URL = "http://localhost:3002";

export function bentoApiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_BUFI_API_URL ??
    DEFAULT_API_URL
  );
}

function bentoUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(`/fx-bento${path}`, bentoApiBaseUrl());
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export interface BentoTransactionRequest {
  contractName: string;
  to: `0x${string}`;
  functionName: string;
  args: unknown[];
  data: `0x${string}`;
  value: string;
  chainId: number;
}

export interface BentoTransactionPayload {
  transaction: BentoTransactionRequest;
  safety: {
    simulation: { status: "skipped" | "passed"; reason?: string };
    reconciliation: { status: "skipped" | "passed"; reason?: string };
  };
}

export interface BentoSimulatorRoom {
  id: string;
  liveblocksRoomId: string;
  marketId: string;
  entryFeeUsdc: number;
  minPlayers: number;
  maxPlayers: number;
  rounds: number;
  players: string[];
  status: "lobby" | "active" | "settling" | "settled" | "cancelled";
  createdAt: string;
  startTime: string | null;
  leaderboard: Array<{ player: string; score: number }>;
}

export class BentoApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    body: string,
  ) {
    super(`BENTO API ${endpoint} → ${status}: ${body.slice(0, 200)}`);
    this.name = "BentoApiError";
  }
}

async function jsonFetch<T>(
  url: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<T> {
  // When the BENTO_E2E shim is enabled (dev-only opt-in via env), inject
  // the dev wallet's X-Wallet-* session headers so the /dev/*/join and
  // any other session-gated routes accept the request. Production-route
  // calls don't need them today but it costs nothing to include — the
  // server ignores X-Wallet-* on unauthenticated routes.
  const devSessionHeaders = await buildBentoDevSessionHeaders();
  const res = await resilientFetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(devSessionHeaders ?? {}),
      ...init.headers,
    },
  });
  if (!res.ok) throw new BentoApiError(res.status, new URL(url).pathname, await res.text());
  return (await res.json()) as T;
}

// ---------- prod (calldata-returning) endpoints ----------

export async function listBentoRooms(): Promise<{ rooms: BentoSimulatorRoom[] }> {
  return jsonFetch(bentoUrl("/rooms"));
}

export async function getBentoRoom(roomId: string): Promise<BentoSimulatorRoom> {
  return jsonFetch(bentoUrl(`/rooms/${encodeURIComponent(roomId)}`));
}

export async function prepareJoinRoom(args: {
  roomId: string;
  chainId?: number;
}): Promise<BentoTransactionPayload> {
  return jsonFetch(bentoUrl(`/rooms/${encodeURIComponent(args.roomId)}/join`, { chainId: args.chainId }), {
    method: "POST",
  });
}

export async function prepareLeaveRoom(args: {
  roomId: string;
  chainId?: number;
}): Promise<BentoTransactionPayload> {
  return jsonFetch(bentoUrl(`/rooms/${encodeURIComponent(args.roomId)}/leave`, { chainId: args.chainId }), {
    method: "POST",
  });
}

export async function prepareCommitSelection(args: {
  roomId: string;
  chainId?: number;
  roundIndex: number;
  commitment: `0x${string}`;
}): Promise<BentoTransactionPayload> {
  return jsonFetch(
    bentoUrl(`/rooms/${encodeURIComponent(args.roomId)}/commit`, { chainId: args.chainId }),
    {
      method: "POST",
      body: JSON.stringify({ roundIndex: args.roundIndex, commitment: args.commitment }),
    },
  );
}

export async function prepareRevealSelection(args: {
  roomId: string;
  chainId?: number;
  roundIndex: number;
  selection: { rows: number[]; cols: number[]; chipCount: number; clientStateHash: `0x${string}` };
  nonce: `0x${string}`;
}): Promise<BentoTransactionPayload> {
  return jsonFetch(
    bentoUrl(`/rooms/${encodeURIComponent(args.roomId)}/reveal`, { chainId: args.chainId }),
    {
      method: "POST",
      body: JSON.stringify({
        roundIndex: args.roundIndex,
        selection: args.selection,
        nonce: args.nonce,
      }),
    },
  );
}

export async function getBentoLeaderboard(roomId: string): Promise<{
  leaderboard: Array<{ player: string; score: number }>;
  source: string;
}> {
  return jsonFetch(bentoUrl(`/rooms/${encodeURIComponent(roomId)}/leaderboard`));
}

export interface BentoClaim {
  roomId: string;
  address: string;
  claimable: boolean;
  claimed: boolean;
  amount: string;
  proof: `0x${string}`[];
  proofReady: boolean;
  settlementRoot: `0x${string}` | null;
  source: string;
}

export async function getBentoClaim(args: {
  roomId: string;
  address: `0x${string}`;
  chainId?: number;
}): Promise<BentoClaim> {
  return jsonFetch(
    bentoUrl(`/rooms/${encodeURIComponent(args.roomId)}/claims/${args.address}`, {
      chainId: args.chainId,
    }),
  );
}

// ---------- dev/simulator endpoints (used by the lobby UI in non-prod) ----------

export async function createDevRoom(input: {
  marketId: string;
  entryFeeUsdc?: number;
  minPlayers?: number;
  maxPlayers?: number;
  rounds?: number;
}): Promise<BentoSimulatorRoom> {
  return jsonFetch(bentoUrl(`/dev/rooms`), { method: "POST", body: JSON.stringify(input) });
}

export async function devJoinRoom(args: {
  roomId: string;
  player: `0x${string}`;
}): Promise<{ roomId: string; player: `0x${string}`; liveblocksRoomId: string }> {
  return jsonFetch(bentoUrl(`/dev/rooms/${encodeURIComponent(args.roomId)}/join`), {
    method: "POST",
    body: JSON.stringify({ player: args.player }),
  });
}

// dev simulator commit/reveal/settle — used by the BENTO_E2E shim in
// multiplayer.tsx to drive the commit-reveal lifecycle without wagmi
// broadcast. Same wire shape as scripts/smoke-bento.ts uses.

export async function devCommitSelection(args: {
  roomId: string;
  player: `0x${string}`;
  roundIndex: number;
  commitment: `0x${string}`;
}): Promise<unknown> {
  return jsonFetch(bentoUrl(`/dev/rooms/${encodeURIComponent(args.roomId)}/commit`), {
    method: "POST",
    body: JSON.stringify({
      player: args.player,
      roundIndex: args.roundIndex,
      commitment: args.commitment,
    }),
  });
}

export async function devRevealSelection(args: {
  roomId: string;
  player: `0x${string}`;
  roundIndex: number;
  rows: number[];
  cols: number[];
  nonce: `0x${string}`;
}): Promise<unknown> {
  return jsonFetch(bentoUrl(`/dev/rooms/${encodeURIComponent(args.roomId)}/reveal`), {
    method: "POST",
    body: JSON.stringify({
      player: args.player,
      roundIndex: args.roundIndex,
      rows: args.rows,
      cols: args.cols,
      nonce: args.nonce,
    }),
  });
}

export async function devSettleRoom(args: {
  roomId: string;
  resultsRoot: `0x${string}`;
}): Promise<{ id?: string; status: string }> {
  return jsonFetch(bentoUrl(`/dev/rooms/${encodeURIComponent(args.roomId)}/settle`), {
    method: "POST",
    body: JSON.stringify({ resultsRoot: args.resultsRoot }),
  });
}
