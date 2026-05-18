"use client";

// Browser-side Liveblocks client for FX² Arcade rooms. The Liveblocks
// auth endpoint is server-side (`/api/liveblocks/auth`) and uses the
// `authorizeLiveblocksRoom` helper from `@bufi/liveblocks/server` — that
// endpoint isn't owned by this worktree, but the client init is the same
// shape regardless.
//
// Room id format is `bufi:<chainId>:arcade:fx-bento:<roomId>` (see
// `@bufi/liveblocks` → roomIdForArcadeRoom). Components that mount the
// RoomProvider should compose the id with the user's connected chain.

import { createArcadeRoomContext, createLiveblocksBrowserClient } from "@bufi/liveblocks/client";
import { roomIdForArcadeRoom } from "@bufi/liveblocks/rooms";

const DEFAULT_AUTH_ENDPOINT = "/api/liveblocks/auth";

let _client: ReturnType<typeof createLiveblocksBrowserClient> | null = null;
let _arcadeContext: ReturnType<typeof createArcadeRoomContext> | null = null;

export function getBentoLiveblocksClient() {
  if (_client) return _client;
  _client = createLiveblocksBrowserClient({
    authEndpoint: process.env.NEXT_PUBLIC_LIVEBLOCKS_AUTH_ENDPOINT ?? DEFAULT_AUTH_ENDPOINT,
  });
  return _client;
}

export function getBentoArcadeContext() {
  if (_arcadeContext) return _arcadeContext;
  _arcadeContext = createArcadeRoomContext(getBentoLiveblocksClient());
  return _arcadeContext;
}

export function bentoArcadeRoomId(chainId: number, roomId: string): string {
  return roomIdForArcadeRoom(chainId, roomId);
}
