"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type BentoClaim,
  type BentoSimulatorRoom,
  type BentoTransactionPayload,
  getBentoClaim,
  getBentoLeaderboard,
  getBentoRoom,
  listBentoRooms,
  prepareCommitSelection,
  prepareJoinRoom,
  prepareLeaveRoom,
  prepareRevealSelection,
} from "./client";

// Poll cadence chosen to feel live without exhausting the dev API. Liveblocks
// presence updates handle the sub-second UI; HTTP is for authoritative state.
const ROOMS_POLL_MS = 3_000;
const ROOM_POLL_MS = 2_000;
const LEADERBOARD_POLL_MS = 2_500;

type RequestState<T> = {
  data: T | null;
  error: Error | null;
  loading: boolean;
};

function useInterval(callback: () => void, ms: number, enabled: boolean) {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    if (!enabled) return;
    ref.current();
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [enabled, ms]);
}

export function useBentoRooms(): RequestState<BentoSimulatorRoom[]> & { refetch: () => void } {
  const [state, setState] = useState<RequestState<BentoSimulatorRoom[]>>({
    data: null,
    error: null,
    loading: true,
  });

  const fetchRooms = useCallback(async () => {
    try {
      const res = await listBentoRooms();
      setState({ data: res.rooms, error: null, loading: false });
    } catch (err) {
      setState({ data: null, error: err as Error, loading: false });
    }
  }, []);

  useInterval(fetchRooms, ROOMS_POLL_MS, true);

  return { ...state, refetch: fetchRooms };
}

export function useBentoRoom(roomId: string | null): RequestState<BentoSimulatorRoom> & {
  refetch: () => void;
} {
  const [state, setState] = useState<RequestState<BentoSimulatorRoom>>({
    data: null,
    error: null,
    loading: !!roomId,
  });

  const fetchRoom = useCallback(async () => {
    if (!roomId) return;
    try {
      const room = await getBentoRoom(roomId);
      setState({ data: room, error: null, loading: false });
    } catch (err) {
      setState((prev) => ({ data: prev.data, error: err as Error, loading: false }));
    }
  }, [roomId]);

  useInterval(fetchRoom, ROOM_POLL_MS, !!roomId);

  return { ...state, refetch: fetchRoom };
}

export function useBentoLeaderboard(roomId: string | null) {
  const [state, setState] = useState<
    RequestState<Array<{ player: string; score: number }>>
  >({ data: null, error: null, loading: !!roomId });

  const fetch = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await getBentoLeaderboard(roomId);
      setState({ data: res.leaderboard, error: null, loading: false });
    } catch (err) {
      setState((prev) => ({ data: prev.data, error: err as Error, loading: false }));
    }
  }, [roomId]);

  useInterval(fetch, LEADERBOARD_POLL_MS, !!roomId);

  return { ...state, refetch: fetch };
}

// ---------- transaction-prep hooks ----------
// Each hook returns a callable that fetches calldata; the caller wires
// wagmi `useSendTransaction` / `useWriteContract` and pipes the tx hash.

export function useJoinRoomPrepare() {
  const [loading, setLoading] = useState(false);
  const prepare = useCallback(
    async (args: { roomId: string; chainId?: number }): Promise<BentoTransactionPayload> => {
      setLoading(true);
      try {
        return await prepareJoinRoom(args);
      } finally {
        setLoading(false);
      }
    },
    [],
  );
  return useMemo(() => ({ prepare, loading }), [prepare, loading]);
}

export function useLeaveRoomPrepare() {
  const [loading, setLoading] = useState(false);
  const prepare = useCallback(
    async (args: { roomId: string; chainId?: number }): Promise<BentoTransactionPayload> => {
      setLoading(true);
      try {
        return await prepareLeaveRoom(args);
      } finally {
        setLoading(false);
      }
    },
    [],
  );
  return useMemo(() => ({ prepare, loading }), [prepare, loading]);
}

export function useCommitSelectionPrepare() {
  const [loading, setLoading] = useState(false);
  const prepare = useCallback(
    async (args: {
      roomId: string;
      chainId?: number;
      roundIndex: number;
      commitment: `0x${string}`;
    }): Promise<BentoTransactionPayload> => {
      setLoading(true);
      try {
        return await prepareCommitSelection(args);
      } finally {
        setLoading(false);
      }
    },
    [],
  );
  return useMemo(() => ({ prepare, loading }), [prepare, loading]);
}

/**
 * Poll the API for the player's claim proof. Only enabled after the room
 * finalises — pass `enabled=false` during play to avoid a thundering herd
 * of 404s while the settlement merkle tree is still being built.
 *
 * Cadence is slow on purpose; settlement is a once-per-room event so we
 * trade latency for backend load.
 */
const CLAIM_POLL_MS = 5_000;

export function useBentoClaim(args: {
  roomId: string | null;
  address: `0x${string}` | undefined;
  chainId?: number;
  enabled?: boolean;
}) {
  const enabled = !!(args.enabled && args.roomId && args.address);
  const [state, setState] = useState<RequestState<BentoClaim>>({
    data: null,
    error: null,
    loading: enabled,
  });

  const fetch = useCallback(async () => {
    if (!args.roomId || !args.address) return;
    try {
      const claim = await getBentoClaim({
        roomId: args.roomId,
        address: args.address,
        chainId: args.chainId,
      });
      setState({ data: claim, error: null, loading: false });
    } catch (err) {
      setState((prev) => ({ data: prev.data, error: err as Error, loading: false }));
    }
  }, [args.roomId, args.address, args.chainId]);

  useInterval(fetch, CLAIM_POLL_MS, enabled);

  return { ...state, refetch: fetch };
}

export function useRevealSelectionPrepare() {
  const [loading, setLoading] = useState(false);
  const prepare = useCallback(
    async (args: {
      roomId: string;
      chainId?: number;
      roundIndex: number;
      selection: {
        rows: number[];
        cols: number[];
        chipCount: number;
        clientStateHash: `0x${string}`;
      };
      nonce: `0x${string}`;
    }): Promise<BentoTransactionPayload> => {
      setLoading(true);
      try {
        return await prepareRevealSelection(args);
      } finally {
        setLoading(false);
      }
    },
    [],
  );
  return useMemo(() => ({ prepare, loading }), [prepare, loading]);
}
