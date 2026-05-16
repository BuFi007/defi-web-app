/**
 * Server-side Liveblocks helpers.
 *
 * Wallet-based identity: the user id is `wallet:0x...` (lowercased), the
 * chain id flows through the room id, and each room on the allowlist is
 * verified to belong to the same chain the session was issued for. A
 * misconfigured caller cannot mint cross-chain access tokens.
 *
 * Adapted from sendero's @sendero/collaboration package — tenant model
 * stripped out, replaced with chain-scoped wallet sessions.
 */

import { Liveblocks } from "@liveblocks/node";
import { getAddress, isAddress, type Address } from "viem";

import {
  parseRoomId,
  roomIdForArcadeRoom,
  roomIdForMcpWorkflow,
  roomIdForPerpsMarket,
  roomIdForTelaranaMarket,
} from "./rooms";

let _client: Liveblocks | null | undefined;

function getClient(): Liveblocks | null {
  if (_client !== undefined) return _client;
  const secret = process.env.LIVEBLOCKS_SECRET_KEY || null;
  if (!secret) {
    _client = null;
    return null;
  }
  _client = new Liveblocks({ secret });
  return _client;
}

export function createLiveblocksClient(): Liveblocks | null {
  return getClient();
}

export function getUserLiveblocksIdentity(address: Address): string {
  return `wallet:${getAddress(address).toLowerCase()}`;
}

export interface IssueSessionArgs {
  address: Address;
  chainId: number;
  displayName?: string | null;
  avatarUrl?: string | null;
  /** Logical role inside this stack — drives presence color + permissions. */
  role?: "trader" | "player" | "borrower" | "agent" | "spectator";
  /** Room ids the user may access. Build via `buildRoomPermissions`. */
  roomIds: string[];
}

export interface IssuedSession {
  token: string;
}

/**
 * Mint a room-scoped Liveblocks access token. Every room in `roomIds`
 * is parsed and checked: rooms with a chainId slot must match
 * `args.chainId`. MCP workflow rooms have no chain scope — caller's
 * responsibility to authorize.
 */
export async function authorizeLiveblocksRoom(
  args: IssueSessionArgs,
): Promise<IssuedSession> {
  const client = getClient();
  if (!client) {
    throw new Error(
      "@bufi/liveblocks: LIVEBLOCKS_SECRET_KEY is not set — cannot issue session",
    );
  }
  if (!isAddress(args.address)) {
    throw new Error(`@bufi/liveblocks: invalid wallet address ${String(args.address)}`);
  }

  for (const rid of args.roomIds) {
    const parsed = parseRoomId(rid);
    if (!parsed) {
      throw new Error(`@bufi/liveblocks: unrecognized room id "${rid}"`);
    }
    if (parsed.kind !== "mcp" && parsed.chainId !== args.chainId) {
      throw new Error(
        `@bufi/liveblocks: room ${rid} chain=${parsed.chainId} does not match session chain=${args.chainId}`,
      );
    }
  }

  const userId = getUserLiveblocksIdentity(args.address);
  const session = client.prepareSession(userId, {
    userInfo: {
      name: args.displayName ?? truncateAddress(args.address),
      avatar: args.avatarUrl ?? undefined,
      color: colorForAddress(args.address),
      role: args.role ?? "spectator",
      chainId: args.chainId,
      kind: "human",
    },
  });

  for (const rid of args.roomIds) session.allow(rid, session.FULL_ACCESS);

  const response = await session.authorize();
  if (response.status !== 200) {
    throw new Error(`Liveblocks session authorize failed: ${response.status}`);
  }
  return { token: JSON.parse(response.body).token };
}

/**
 * Mint an ID token for project-level features (inbox notifications, etc).
 * No room scope. Use for wallets that aren't yet in any specific room.
 */
export async function identifyWallet(args: {
  address: Address;
  chainId: number;
  displayName?: string | null;
  avatarUrl?: string | null;
}): Promise<IssuedSession> {
  const client = getClient();
  if (!client) {
    throw new Error("@bufi/liveblocks: LIVEBLOCKS_SECRET_KEY is not set");
  }
  const userId = getUserLiveblocksIdentity(args.address);
  const response = await client.identifyUser(
    {
      userId,
      groupIds: [`chain:${args.chainId}`],
    },
    {
      userInfo: {
        name: args.displayName ?? truncateAddress(args.address),
        avatar: args.avatarUrl ?? undefined,
        color: colorForAddress(args.address),
        chainId: args.chainId,
        kind: "human",
      },
    },
  );
  if (response.status !== 200) {
    throw new Error(`Liveblocks identify failed: ${response.status}`);
  }
  return { token: JSON.parse(response.body).token };
}

// -------- ensure-room helpers (idempotent) --------

export async function ensurePerpsRoom(args: {
  chainId: number;
  marketId: string;
  title?: string;
}): Promise<void> {
  const client = getClient();
  if (!client) return;
  await client.getOrCreateRoom(roomIdForPerpsMarket(args.chainId, args.marketId), {
    defaultAccesses: [],
    metadata: {
      chainId: String(args.chainId),
      kind: "perps",
      marketId: args.marketId,
      title: args.title ?? `Perps ${args.marketId}`,
    },
  });
}

export async function ensureArcadeRoom(args: {
  chainId: number;
  roomId: string;
  title?: string;
}): Promise<void> {
  const client = getClient();
  if (!client) return;
  await client.getOrCreateRoom(roomIdForArcadeRoom(args.chainId, args.roomId), {
    defaultAccesses: [],
    metadata: {
      chainId: String(args.chainId),
      kind: "arcade",
      roomId: args.roomId,
      title: args.title ?? `Arcade ${args.roomId.slice(0, 8)}`,
    },
  });
}

export async function ensureTelaranaRoom(args: {
  chainId: number;
  marketId: string;
}): Promise<void> {
  const client = getClient();
  if (!client) return;
  await client.getOrCreateRoom(roomIdForTelaranaMarket(args.chainId, args.marketId), {
    defaultAccesses: [],
    metadata: {
      chainId: String(args.chainId),
      kind: "telarana",
      marketId: args.marketId,
    },
  });
}

export async function ensureMcpWorkflowRoom(args: {
  workflowId: string;
}): Promise<void> {
  const client = getClient();
  if (!client) return;
  await client.getOrCreateRoom(roomIdForMcpWorkflow(args.workflowId), {
    defaultAccesses: [],
    metadata: { kind: "mcp", workflowId: args.workflowId },
  });
}

// -------- helpers --------

function truncateAddress(addr: Address): string {
  const a = String(addr);
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function colorForAddress(addr: Address): string {
  const palette = [
    "#6954cf", // purpleDanis
    "#e2d0fd", // borderFine
    "#cc4b37",
    "#1f7a69",
    "#7c5c2e",
    "#9a3f72",
  ];
  const s = String(addr);
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

export {
  parseRoomId,
  roomIdForArcadeRoom,
  roomIdForMcpWorkflow,
  roomIdForPerpsMarket,
  roomIdForTelaranaMarket,
};
export { buildRoomPermissions } from "./rooms";
