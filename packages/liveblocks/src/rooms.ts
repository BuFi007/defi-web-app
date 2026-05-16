/**
 * Room naming + per-room shapes.
 *
 * Every room id encodes the chain it lives on so a Liveblocks session
 * minted for Arc Testnet (5042002) cannot access an Avalanche Fuji
 * (43113) perps market room and vice versa.
 *
 * Inspired by @sendero/collaboration's room scheme; the "tenantId" slot
 * is replaced with the chain id since this stack is wallet-scoped, not
 * tenant-scoped.
 */

import type { Address } from "viem";

/** perps trading desk for one market on one chain. */
export function roomIdForPerpsMarket(chainId: number, marketId: string): string {
  return `bufi:${chainId}:perps:${marketId}`;
}

/** FX² Arcade / FX Bento game room. */
export function roomIdForArcadeRoom(chainId: number, roomId: string): string {
  return `bufi:${chainId}:arcade:${roomId}`;
}

/** FX Telaraña lending market room (optional — not all markets need realtime). */
export function roomIdForTelaranaMarket(chainId: number, marketId: string): string {
  return `bufi:${chainId}:telarana:${marketId}`;
}

/** MCP workflow execution room (one room per running workflow). */
export function roomIdForMcpWorkflow(workflowId: string): string {
  return `bufi:mcp:workflow:${workflowId}`;
}

export type ParsedRoom =
  | { kind: "perps"; chainId: number; marketId: string }
  | { kind: "arcade"; chainId: number; roomId: string }
  | { kind: "telarana"; chainId: number; marketId: string }
  | { kind: "mcp"; workflowId: string };

export function parseRoomId(roomId: string): ParsedRoom | null {
  const perps = /^bufi:(\d+):perps:([^:]+)$/.exec(roomId);
  if (perps) return { kind: "perps", chainId: Number(perps[1]), marketId: perps[2] };

  const arcade = /^bufi:(\d+):arcade:([^:]+)$/.exec(roomId);
  if (arcade) return { kind: "arcade", chainId: Number(arcade[1]), roomId: arcade[2] };

  const telarana = /^bufi:(\d+):telarana:([^:]+)$/.exec(roomId);
  if (telarana) {
    return { kind: "telarana", chainId: Number(telarana[1]), marketId: telarana[2] };
  }

  const mcp = /^bufi:mcp:workflow:([^:]+)$/.exec(roomId);
  if (mcp) return { kind: "mcp", workflowId: mcp[1] };

  return null;
}

/**
 * Build the set of rooms a wallet may access given the chain they
 * authenticated on. The user is allowed into MCP workflow rooms only
 * if they own the workflow — callers compose that allowlist server-side.
 */
export function buildRoomPermissions(args: {
  chainId: number;
  marketIds?: string[];
  arcadeRoomIds?: string[];
  telaranaMarketIds?: string[];
  mcpWorkflowIds?: string[];
}): string[] {
  const ids: string[] = [];
  for (const m of args.marketIds ?? []) ids.push(roomIdForPerpsMarket(args.chainId, m));
  for (const r of args.arcadeRoomIds ?? []) ids.push(roomIdForArcadeRoom(args.chainId, r));
  for (const m of args.telaranaMarketIds ?? []) {
    ids.push(roomIdForTelaranaMarket(args.chainId, m));
  }
  for (const w of args.mcpWorkflowIds ?? []) ids.push(roomIdForMcpWorkflow(w));
  return ids;
}

// -------- presence + storage shapes --------

/**
 * Trading desk presence. Liveblocks requires presence values to be
 * JSON-serializable primitives — keep nested objects flat.
 */
export type PerpsPresence = {
  address: Address;
  displayName: string | null;
  /** Tile/side the user is currently hovering. */
  focus: "long" | "short" | "size" | "leverage" | null;
  /** Indicative quote the user is staring at, for "X is about to trade" cues. */
  draftSide: "long" | "short" | null;
  draftSizeUsdc: string | null;
  draftLeverage: number | null;
  [k: string]: string | number | boolean | null;
};

/**
 * Arcade waiting-room + game-board presence.
 */
export type ArcadePresence = {
  address: Address;
  displayName: string | null;
  /** Tile the cursor is over (game board) or null in waiting room. */
  hoverTileId: string | null;
  selectedTileId: string | null;
  chipsRemaining: number | null;
  ready: boolean;
  cursorX: number | null;
  cursorY: number | null;
  [k: string]: string | number | boolean | null;
};

/**
 * MCP workflow presence — useful for human-in-the-loop tool runs where
 * the user can see "agent is at step 3/5".
 */
export type McpPresence = {
  actor: "human" | "agent";
  address: Address | null;
  step: string | null;
  progressBps: number | null;
  [k: string]: string | number | boolean | null;
};

/**
 * Storage is intentionally minimal — Liveblocks is NOT the source of
 * truth for money. Storage holds UX state only (countdown sync,
 * leaderboard preview), reconciled with Ponder after every settled
 * event.
 */
export interface ArcadeStorage {
  countdownEndsAt: number | null;
  /** Optimistic chips-per-tile preview. Authoritative count comes from chain. */
  tilePreview: Record<string, number>;
  /** Last-known leaderboard snapshot from indexer. */
  leaderboard: Array<{ address: Address; score: number; rank: number }>;
}

export const INITIAL_ARCADE_STORAGE: ArcadeStorage = {
  countdownEndsAt: null,
  tilePreview: {},
  leaderboard: [],
};
