"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useAccount, useChainId, useSendTransaction, useSwitchChain } from "wagmi";

import { useToast } from "@/components/ui/use-toast";
import {
  type BentoSimulatorRoom,
  createDevRoom,
  devJoinRoom,
} from "@/lib/bento/client";
import {
  useBentoLeaderboard,
  useBentoRoom,
  useBentoRooms,
  useCommitSelectionPrepare,
  useJoinRoomPrepare,
  useRevealSelectionPrepare,
} from "@/lib/bento/hooks";

import { ALL_MARKETS, fmtUSD, type Market } from "./data";
import { Hint } from "./hint";
import { ArcadeBoard, type ArcadeSession, type PlacedChip } from "./arcade";

export interface Player {
  id: string;
  name: string;
  emoji: string;
  color: string;
  ink: string;
  soft: string;
  score: number;
  chipsUsedThisRound: number;
  lastDelta: number;
  address?: `0x${string}`;
}

export interface Room {
  id: string;
  name: string;
  fee: number;
  pool: number;
  players: { current: number; min: number; max: number };
  rounds: number;
  chipBudget: number;
  duration: number;
  desc: string;
  market: string;
  tag: string;
  badge: string;
}

const PLAYER_PALETTE: Omit<Player, "score" | "chipsUsedThisRound" | "lastDelta" | "address">[] = [
  { id: "you", name: "You", emoji: "🌸", color: "#6b5bff", ink: "#4233c4", soft: "#ebe5ff" },
  { id: "p2", name: "sakura.eth", emoji: "💛", color: "#e0b052", ink: "#a07320", soft: "#fef3d4" },
  { id: "p3", name: "mintwhale", emoji: "🍯", color: "#34c08a", ink: "#1f7a4d", soft: "#d5f5e3" },
  { id: "p4", name: "lavender42", emoji: "✨", color: "#a89ce8", ink: "#5e4eb2", soft: "#ece6ff" },
  { id: "p5", name: "koi.btc", emoji: "🍃", color: "#3fb8d4", ink: "#1e6b80", soft: "#d8edf3" },
  { id: "p6", name: "pinkslip", emoji: "✦", color: "#ec5b8c", ink: "#a8245e", soft: "#feadec" },
];

const DEFAULT_CHIP_BUDGET = 10;
const DEFAULT_DURATION_SEC = 45;
const BENTO_CHAIN_ID = 43113;

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function roomBadgeFor(market: string): string {
  if (market.startsWith("USDC/EUR")) return "💶";
  if (market.startsWith("USDC/JPY")) return "💴";
  if (market.startsWith("USDC/MXN")) return "🪙";
  return "🎴";
}

function roomTagFor(room: BentoSimulatorRoom): string {
  if (room.status === "active") return "Live";
  if (room.players.length >= room.maxPlayers - 1) return "Hot";
  return "Open";
}

function bentoRoomToRoom(bento: BentoSimulatorRoom): Room {
  return {
    id: bento.id,
    name: bento.id.replace(/^room_/, "Room "),
    fee: bento.entryFeeUsdc,
    pool: bento.entryFeeUsdc * bento.players.length,
    players: {
      current: bento.players.length,
      min: bento.minPlayers,
      max: bento.maxPlayers,
    },
    rounds: bento.rounds,
    chipBudget: DEFAULT_CHIP_BUDGET,
    duration: DEFAULT_DURATION_SEC,
    desc: `${bento.marketId} · ${bento.rounds} rounds · entry ${fmtUSD(bento.entryFeeUsdc)}`,
    market: bento.marketId,
    tag: roomTagFor(bento),
    badge: roomBadgeFor(bento.marketId),
  };
}

function paletteFor(index: number) {
  return PLAYER_PALETTE[index % PLAYER_PALETTE.length] ?? PLAYER_PALETTE[1]!;
}

function buildPlayers(
  bentoRoom: BentoSimulatorRoom,
  myAddress: `0x${string}` | undefined,
  leaderboard: Array<{ player: string; score: number }> | null,
): Player[] {
  const scoreFor = (addr: string) =>
    leaderboard?.find((e) => e.player.toLowerCase() === addr.toLowerCase())?.score ?? 0;
  const lowerMe = myAddress?.toLowerCase();
  const sorted = [...bentoRoom.players].sort((a, b) => {
    if (a.toLowerCase() === lowerMe) return -1;
    if (b.toLowerCase() === lowerMe) return 1;
    return 0;
  });
  return sorted.map((address, index) => {
    const isMe = address.toLowerCase() === lowerMe;
    const palette = isMe ? PLAYER_PALETTE[0]! : paletteFor(index + 1);
    return {
      ...palette,
      id: isMe ? "you" : address.toLowerCase(),
      name: isMe ? "You" : truncateAddress(address),
      score: scoreFor(address),
      chipsUsedThisRound: 0,
      lastDelta: 0,
      address: address as `0x${string}`,
    };
  });
}

// ---------- screens ----------

export function LobbyScreen({
  onJoin,
  onClose,
  wallet,
  rooms,
  loading,
  onCreateRoom,
}: {
  onJoin: (r: Room) => void;
  onClose: () => void;
  wallet: number;
  rooms: Room[];
  loading: boolean;
  onCreateRoom?: () => void;
}) {
  return (
    <div className="lobby">
      <header className="lobby-head">
        <div className="lobby-title">
          <span className="lobby-eyebrow">ARCADE</span>
          <h2>
            Pick a room{" "}
            <Hint w={280}>
              Each room is a short, multi-round chip game on a live FX market. Join by paying the entry fee.
            </Hint>
          </h2>
        </div>
        <div className="lobby-wallet">
          <span className="apy-l">
            Wallet <Hint w={220}>Your balance available for entry fees and stakes.</Hint>
          </span>
          <span className="mono lobby-wallet-amt">{fmtUSD(wallet)} USDC</span>
        </div>
        <button className="exit-pro" onClick={onClose} title="Back to the regular trading view">
          <span className="mode-glyph">⊞</span>
          <span>Pro</span>
        </button>
      </header>
      <div className="lobby-grid">
        {loading && rooms.length === 0 && (
          <div className="room-card" style={{ opacity: 0.6 }}>
            <div className="room-meta mono">Loading rooms…</div>
          </div>
        )}
        {!loading && rooms.length === 0 && (
          <div className="room-card" style={{ opacity: 0.85 }}>
            <div className="room-meta">
              <span className="lobby-eyebrow">No live rooms</span>
              <div className="room-name-row" style={{ marginTop: 6 }}>
                <span className="room-name">Spin one up</span>
              </div>
              <div className="room-market mono" style={{ marginTop: 4 }}>
                Dev mode · in-memory simulator
              </div>
            </div>
            {onCreateRoom && (
              <button
                className="room-join"
                onClick={onCreateRoom}
                title="Create a new room via the dev simulator"
                style={{ marginTop: 12 }}
              >
                <span>Create room</span>
                <span className="rj-arrow">+</span>
              </button>
            )}
          </div>
        )}
        {rooms.map((r) => {
          const filling = r.players.current / r.players.max;
          return (
            <div key={r.id} className="room-card" title={r.desc}>
              <div className="room-head">
                <div className="room-badge">{r.badge}</div>
                <div className="room-meta">
                  <div className="room-name-row">
                    <span className="room-name">{r.name}</span>
                    <span
                      className={"pill " + (r.tag === "Hot" ? "loss" : r.tag === "Live" ? "profit" : "muted")}
                      title={
                        r.tag === "Hot"
                          ? "Lots of players joining right now"
                          : r.tag === "Live"
                          ? "A round is currently in progress"
                          : "Room has slots open"
                      }
                    >
                      {r.tag}
                    </span>
                  </div>
                  <div className="room-market mono" title="Market this room plays on">
                    {r.market}
                  </div>
                </div>
                <div className="room-fee" title="Entry fee — added to the prize pool">
                  <span className="mono room-fee-amt">{fmtUSD(r.fee)}</span>
                </div>
              </div>

              <div
                className="room-spec mono"
                title={`${r.rounds} rounds, ${r.duration}s each, ${r.chipBudget} chips per round`}
              >
                {r.rounds}r · {r.duration}s · {r.chipBudget} chips
              </div>

              <div className="room-fill">
                <div className="rfill-bar">
                  <div style={{ width: `${filling * 100}%` }} />
                </div>
                <div className="rfill-row">
                  <span
                    className="mono"
                    style={{ fontWeight: 800, fontSize: 11 }}
                    title="Players currently joined / room capacity"
                  >
                    {r.players.current}/{r.players.max}
                  </span>
                  <span
                    className="mono"
                    style={{ fontWeight: 800, fontSize: 11, color: "var(--primary-ink)" }}
                    title="Total prize pool — split among the top finishers"
                  >
                    {fmtUSD(r.pool)} pool
                  </span>
                </div>
              </div>

              <button
                className="room-join"
                onClick={() => onJoin(r)}
                title="Pay the entry fee and join this room's next round"
              >
                <span>Join · {fmtUSD(r.fee)}</span>
                <span className="rj-arrow">→</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CountdownIntro({ room, count }: { room: Room; count: number }) {
  return (
    <div className="countdown-intro">
      <div className="ci-meta">
        <span className="lobby-eyebrow">{room.name}</span>
        <span className="ci-market mono">{room.market}</span>
      </div>
      <div className="ci-number-wrap">
        <div key={count} className={"ci-number " + (count === 0 ? "go" : "")}>
          {count === 0 ? "GO" : count}
        </div>
      </div>
    </div>
  );
}

export function LeaderboardPanel({
  players,
  currentRound,
  totalRounds,
  chipsLeft,
  chipBudget,
  you,
}: {
  players: Player[];
  currentRound: number;
  totalRounds: number;
  chipsLeft: number;
  chipBudget: number;
  you: Player;
}) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return (
    <aside className="leaderboard-panel">
      <div className="lb-head">
        <span className="lobby-eyebrow">ROUND</span>
        <div className="lb-round mono" title={`Round ${currentRound} of ${totalRounds}`}>
          {currentRound}
          <span style={{ opacity: 0.5 }}>/{totalRounds}</span>
        </div>
      </div>
      <div
        className="lb-budget"
        style={{ "--player-color": you.color, "--player-soft": you.soft } as CSSProperties}
      >
        <div className="lb-budget-emoji">{you.emoji}</div>
        <div className="lb-budget-info">
          <span className="apy-l">
            Your chips <Hint w={240}>Chips left to spend this round. Resets each round.</Hint>
          </span>
          <div className="lb-budget-bar">
            <div style={{ width: `${(chipsLeft / chipBudget) * 100}%` }} />
          </div>
          <span className="mono lb-budget-count">
            {chipsLeft}
            <span style={{ color: "var(--ink-3)" }}>/{chipBudget}</span>
          </span>
        </div>
      </div>
      <div className="lb-list">
        {sorted.map((p, i) => (
          <div
            key={p.id}
            className={"lb-row " + (p.id === "you" ? "you" : "") + (i === 0 ? " top" : "")}
            style={
              {
                "--player-color": p.color,
                "--player-soft": p.soft,
                "--player-ink": p.ink,
              } as CSSProperties
            }
          >
            <div className="lb-rank">{i + 1}</div>
            <div className="lb-avatar">{p.emoji}</div>
            <div className="lb-name">{p.id === "you" ? "You" : p.name}</div>
            <div className="mono lb-score">{p.score}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}

export function RoundEndOverlay({
  players,
  roundNum,
  totalRounds: _totalRounds,
  isFinal,
  onNext,
}: {
  players: Player[];
  roundNum: number;
  totalRounds: number;
  isFinal: boolean;
  onNext: () => void;
}) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return (
    <div className="round-end">
      <div className="re-card">
        <span className="lobby-eyebrow">{isFinal ? "FINAL RESULTS" : `Round ${roundNum} complete`}</span>
        <h2 className="re-title">{isFinal ? (sorted[0]?.id === "you" ? "✨ You won!" : "GG") : "Round done"}</h2>
        <div className="re-list">
          {sorted.map((p, i) => (
            <div
              key={p.id}
              className={"re-row " + (i === 0 ? "top" : "") + (p.id === "you" ? " you" : "")}
              style={
                {
                  "--player-color": p.color,
                  "--player-soft": p.soft,
                  "--player-ink": p.ink,
                } as CSSProperties
              }
            >
              <div className="re-rank">{i + 1}</div>
              <div className="re-avatar">{p.emoji}</div>
              <div className="re-name">{p.id === "you" ? "You" : p.name}</div>
              <div className="re-prize mono">
                {isFinal
                  ? i === 0
                    ? "+$48"
                    : i === 1
                    ? "+$20"
                    : i === 2
                    ? "+$8"
                    : "—"
                  : `Δ +${p.lastDelta || 0}`}
              </div>
              <div className="mono re-score">{p.score}</div>
            </div>
          ))}
        </div>
        <button className="play-again-btn" onClick={onNext}>
          <span className="pa-spark">✦</span>
          <span>{isFinal ? "Back to lobby" : `Round ${roundNum + 1} →`}</span>
        </button>
      </div>
    </div>
  );
}

// ---------- top-level component ----------

export function ArcadeRoom({ market, onClose }: { market: Market; onClose: () => void }) {
  type Phase = "lobby" | "countdown" | "playing" | "roundEnd" | "final";
  const [phase, setPhase] = useState<Phase>("lobby");
  const [joinedRoomId, setJoinedRoomId] = useState<string | null>(null);
  const [round, setRound] = useState(1);
  const [countNum, setCountNum] = useState(3);
  // Wallet balance display is opaque for now; the real entry fee leaves wagmi
  // when the tx is sent. Will read from useBalance(USDC) once token wiring lands.
  const [wallet, setWallet] = useState(125420.5);

  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const { toast } = useToast();

  const { data: roomsData, loading: roomsLoading, refetch: refetchRooms } = useBentoRooms();
  const { data: roomData } = useBentoRoom(joinedRoomId);
  const { data: leaderboard } = useBentoLeaderboard(joinedRoomId);

  const { prepare: prepareJoin } = useJoinRoomPrepare();
  const { prepare: prepareCommit } = useCommitSelectionPrepare();
  const { prepare: prepareReveal } = useRevealSelectionPrepare();

  const rooms = useMemo(() => (roomsData ?? []).map(bentoRoomToRoom), [roomsData]);

  const players = useMemo<Player[]>(() => {
    if (!roomData) return [];
    return buildPlayers(roomData, address, leaderboard);
  }, [roomData, address, leaderboard]);

  const room = useMemo(() => (roomData ? bentoRoomToRoom(roomData) : null), [roomData]);
  const you = players.find((p) => p.id === "you");
  const chipsLeft = you
    ? Math.max(0, (room?.chipBudget || DEFAULT_CHIP_BUDGET) - (you.chipsUsedThisRound || 0))
    : 0;

  const ensureChain = useCallback(async () => {
    if (chainId === BENTO_CHAIN_ID) return;
    await switchChainAsync({ chainId: BENTO_CHAIN_ID });
  }, [chainId, switchChainAsync]);

  const sendPrepared = useCallback(
    async (payload: { transaction: { to: `0x${string}`; data: `0x${string}`; value: string } }) => {
      return sendTransactionAsync({
        to: payload.transaction.to,
        data: payload.transaction.data,
        value: BigInt(payload.transaction.value),
      });
    },
    [sendTransactionAsync],
  );

  const join = useCallback(
    async (r: Room) => {
      if (!address) {
        toast({ title: "Connect a wallet", description: "Join the arcade after connecting." });
        return;
      }
      if (wallet < r.fee) {
        toast({ title: "Insufficient balance", description: `Need ${fmtUSD(r.fee)} USDC.` });
        return;
      }
      try {
        await ensureChain();
        const payload = await prepareJoin({ roomId: r.id, chainId: BENTO_CHAIN_ID });
        const hash = await sendPrepared(payload);
        toast({
          title: "Joining room",
          description: `Tx ${truncateAddress(hash)} broadcast.`,
        });
        setWallet((w) => w - r.fee);
        setJoinedRoomId(r.id);
        setRound(1);
        setCountNum(3);
        setPhase("countdown");
        // Refetch lobby list — the join changed `players.length` upstream.
        setTimeout(refetchRooms, 800);
      } catch (err) {
        toast({
          title: "Join failed",
          description: (err as Error).message,
          variant: "destructive",
        });
      }
    },
    [address, wallet, ensureChain, prepareJoin, sendPrepared, toast, refetchRooms],
  );

  const handleCreateRoom = useCallback(async () => {
    try {
      const created = await createDevRoom({
        marketId: market.sym?.includes("/") ? market.sym : "USDC/EURC",
        entryFeeUsdc: 5,
        minPlayers: 2,
        maxPlayers: 6,
        rounds: 3,
      });
      if (address) {
        await devJoinRoom({ roomId: created.id, player: address }).catch(() => undefined);
      }
      refetchRooms();
      toast({ title: "Room created", description: `Spun up ${created.id}.` });
    } catch (err) {
      toast({
        title: "Create failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  }, [market.sym, address, refetchRooms, toast]);

  useEffect(() => {
    if (phase !== "countdown") return;
    const id = setInterval(() => {
      setCountNum((n) => {
        if (n <= 0) {
          clearInterval(id);
          setPhase("playing");
          return 3;
        }
        return n - 1;
      });
    }, 800);
    return () => clearInterval(id);
  }, [phase, round]);

  const finishRound = useCallback(
    async (_settled: PlacedChip[], myHits: PlacedChip[]) => {
      // Player-side scoring is advisory — the contract attestor computes the
      // authoritative score from the Pyth snapshot at lock + settle time. We
      // commit the local placement hash so the contract can verify the reveal.
      const delta = myHits.reduce(
        (s, c) => s + Math.round((c as PlacedChip & { score?: number }).score ?? 0),
        0,
      );
      if (joinedRoomId && delta > 0 && room) {
        try {
          // Build a placeholder commitment so the round-end overlay shows progress.
          // Real commit-reveal needs a per-round nonce + selected-tiles hash —
          // wiring that to the board UI is the next step.
          const commitmentSeed = `0x${(delta + round)
            .toString(16)
            .padStart(64, "0")}` as `0x${string}`;
          await prepareCommit({
            roomId: joinedRoomId,
            chainId: BENTO_CHAIN_ID,
            roundIndex: round - 1,
            commitment: commitmentSeed,
          }).catch(() => undefined);
        } catch {
          // Non-fatal: commit prep failure should not block the round-end UI.
        }
      }
      setPhase("roundEnd");
    },
    [joinedRoomId, room, round, prepareCommit],
  );

  const nextRound = useCallback(() => {
    if (!room) return;
    if (round >= room.rounds) {
      setPhase("final");
      const sorted = [...players].sort((a, b) => b.score - a.score);
      if (sorted[0]?.id === "you") setWallet((w) => w + room.pool * 0.7);
      else if (sorted[1]?.id === "you") setWallet((w) => w + room.pool * 0.25);
    } else {
      setRound((r) => r + 1);
      setCountNum(3);
      setPhase("countdown");
    }
  }, [room, round, players]);

  const backToLobby = useCallback(() => {
    setPhase("lobby");
    setJoinedRoomId(null);
    setRound(1);
  }, []);

  // Reveal helper exposed for future board wiring (no-op until UI calls it).
  // Keeping the prepareReveal hook reachable so devs grepping for the verb
  // find the integration point.
  void prepareReveal;

  if (phase === "lobby") {
    return (
      <LobbyScreen
        onJoin={join}
        onClose={onClose}
        wallet={wallet}
        rooms={rooms}
        loading={roomsLoading}
        onCreateRoom={handleCreateRoom}
      />
    );
  }
  if (phase === "countdown" && room) {
    return <CountdownIntro room={room} count={countNum} />;
  }
  const isFinal = phase === "final";
  const roomMarket = ALL_MARKETS.find((m) => m.sym === room?.market) || market;
  if (!room || !you) {
    return <LobbyScreen onJoin={join} onClose={onClose} wallet={wallet} rooms={rooms} loading={false} />;
  }
  const session: ArcadeSession = {
    you,
    players,
    chipBudget: room.chipBudget || DEFAULT_CHIP_BUDGET,
    chipsLeft,
    currentRound: round,
    totalRounds: room.rounds || 1,
    duration: room.duration || DEFAULT_DURATION_SEC,
    onRoundComplete: finishRound,
  };
  return (
    <div className="arcade-mp-wrap">
      <ArcadeBoard market={roomMarket} onClose={backToLobby} session={session} />
      {(phase === "roundEnd" || phase === "final") && room && (
        <RoundEndOverlay
          players={players}
          roundNum={round}
          totalRounds={room.rounds}
          isFinal={isFinal}
          onNext={isFinal ? backToLobby : nextRound}
        />
      )}
    </div>
  );
}
