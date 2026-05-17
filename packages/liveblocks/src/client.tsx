"use client";

import {
  createClient,
  type ClientOptions,
} from "@liveblocks/client";
import { createRoomContext } from "@liveblocks/react";

import type {
  ArcadePresence,
  ArcadeStorage,
  McpPresence,
  PerpsPresence,
} from "./rooms";

/**
 * Browser-side Liveblocks client factory. The consuming app provides an
 * auth endpoint URL — usually `/api/liveblocks/auth` — that POSTs to the
 * server-side `authorizeLiveblocksRoom` helper.
 */
export function createLiveblocksBrowserClient(opts: {
  authEndpoint: string;
  throttle?: ClientOptions["throttle"];
}) {
  return createClient({
    authEndpoint: opts.authEndpoint,
    throttle: opts.throttle ?? 16,
  });
}

/**
 * Per-domain RoomContext factories. Each domain has its own presence +
 * storage shape so consumers get typed hooks (`usePresence`,
 * `useStorage`, ...) without runtime casts.
 */
export function createPerpsRoomContext(client: ReturnType<typeof createLiveblocksBrowserClient>) {
  return createRoomContext<PerpsPresence>(client);
}

export function createArcadeRoomContext(client: ReturnType<typeof createLiveblocksBrowserClient>) {
  return createRoomContext<ArcadePresence, ArcadeStorage>(client);
}

export function createMcpRoomContext(client: ReturnType<typeof createLiveblocksBrowserClient>) {
  return createRoomContext<McpPresence>(client);
}
