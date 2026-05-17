"use client";

import { useEffect, useState, type CSSProperties } from "react";
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

const PLAYER_PALETTE: Omit<Player, "score" | "chipsUsedThisRound" | "lastDelta">[] = [
  { id: "you", name: "You", emoji: "🌸", color: "#6b5bff", ink: "#4233c4", soft: "#ebe5ff" },
  { id: "p2", name: "sakura.eth", emoji: "💛", color: "#e0b052", ink: "#a07320", soft: "#fef3d4" },
  { id: "p3", name: "mintwhale", emoji: "🍯", color: "#34c08a", ink: "#1f7a4d", soft: "#d5f5e3" },
  { id: "p4", name: "lavender42", emoji: "✨", color: "#a89ce8", ink: "#5e4eb2", soft: "#ece6ff" },
  { id: "p5", name: "koi.btc", emoji: "🍃", color: "#3fb8d4", ink: "#1e6b80", soft: "#d8edf3" },
  { id: "p6", name: "pinkslip", emoji: "✦", color: "#ec5b8c", ink: "#a8245e", soft: "#feadec" },
];

export const ROOMS: Room[] = [
  {
    id: "quick",
    name: "Quick Play",
    fee: 5,
    pool: 80,
    players: { current: 4, min: 4, max: 6 },
    rounds: 3,
    chipBudget: 10,
    duration: 45,
    desc: "Beginner-friendly. Fixed budget, 3 rounds, top 2 win.",
    market: "EUR/USD",
    tag: "Live",
    badge: "⚡",
  },
  {
    id: "royale",
    name: "Grid Royale",
    fee: 25,
    pool: 480,
    players: { current: 16, min: 12, max: 20 },
    rounds: 5,
    chipBudget: 8,
    duration: 60,
    desc: "Elimination format. Lowest scorer drops each round.",
    market: "BTC-PERP",
    tag: "Hot",
    badge: "⚔️",
  },
  {
    id: "zen",
    name: "Zen Lounge",
    fee: 1,
    pool: 12,
    players: { current: 8, min: 4, max: 10 },
    rounds: 5,
    chipBudget: 15,
    duration: 90,
    desc: "Low-stakes, long rounds. Chat-friendly.",
    market: "USD/JPY",
    tag: "Open",
    badge: "🍵",
  },
];

export function LobbyScreen({
  onJoin,
  onClose,
  wallet,
}: {
  onJoin: (r: Room) => void;
  onClose: () => void;
  wallet: number;
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
        {ROOMS.map((r) => {
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
        <h2 className="re-title">{isFinal ? (sorted[0].id === "you" ? "✨ You won!" : "GG") : "Round done"}</h2>
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

export function ArcadeRoom({ market, onClose }: { market: Market; onClose: () => void }) {
  type Phase = "lobby" | "countdown" | "playing" | "roundEnd" | "final";
  const [phase, setPhase] = useState<Phase>("lobby");
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [round, setRound] = useState(1);
  const [countNum, setCountNum] = useState(3);
  const [wallet, setWallet] = useState(125420.5);

  const you = players.find((p) => p.id === "you");
  const chipsLeft = you ? Math.max(0, (room?.chipBudget || 0) - (you.chipsUsedThisRound || 0)) : 0;

  const join = (r: Room) => {
    if (wallet < r.fee) return;
    setWallet((w) => w - r.fee);
    setRoom(r);
    const roster: Player[] = PLAYER_PALETTE.slice(0, r.players.current).map((p) => ({
      ...p,
      score: 0,
      chipsUsedThisRound: 0,
      lastDelta: 0,
    }));
    setPlayers(roster);
    setRound(1);
    setCountNum(3);
    setPhase("countdown");
  };

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

  const finishRound = (_myPlacedChips: PlacedChip[], myHits: PlacedChip[]) => {
    const updated = players.map((p) => {
      if (p.id === "you") {
        const delta = myHits.reduce((s, c) => s + Math.round((c as PlacedChip & { score?: number }).score ?? 0), 0);
        return { ...p, score: p.score + delta, lastDelta: delta, chipsUsedThisRound: 0 };
      }
      const delta = Math.round(Math.random() * 30 + Math.random() * 15);
      return { ...p, score: p.score + delta, lastDelta: delta, chipsUsedThisRound: 0 };
    });
    setPlayers(updated);
    setPhase("roundEnd");
  };

  const nextRound = () => {
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
  };

  const backToLobby = () => {
    setPhase("lobby");
    setRoom(null);
    setPlayers([]);
    setRound(1);
  };

  if (phase === "lobby") {
    return <LobbyScreen onJoin={join} onClose={onClose} wallet={wallet} />;
  }
  if (phase === "countdown" && room) {
    return <CountdownIntro room={room} count={countNum} />;
  }
  const isFinal = phase === "final";
  const roomMarket = ALL_MARKETS.find((m) => m.sym === room?.market) || market;
  const session: ArcadeSession = {
    you: you!,
    players,
    chipBudget: room?.chipBudget || 10,
    chipsLeft,
    currentRound: round,
    totalRounds: room?.rounds || 1,
    duration: room?.duration || 45,
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
