"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FlagPair, fmtUSD, type Market } from "./data";
import { Hint } from "./hint";
import { LeaderboardPanel, type Player } from "./multiplayer";

interface ChipDef {
  id: string;
  emoji: string;
  label: string;
}

const CHIPS: ChipDef[] = [
  { id: "flower", emoji: "🌸", label: "Flower" },
  { id: "heart", emoji: "💛", label: "Heart" },
  { id: "honey", emoji: "🍯", label: "Honey" },
  { id: "star", emoji: "✦", label: "Star" },
  { id: "leaf", emoji: "🍃", label: "Leaf" },
  { id: "sparkle", emoji: "✨", label: "Sparkle" },
];

const STAKES = [1, 5, 10, 25, 50];

const ROUND_LENS: { sec: number | null; label: string; glyph?: string }[] = [
  { sec: 20, label: "20s" },
  { sec: 45, label: "45s" },
  { sec: 90, label: "1m 30s" },
  { sec: null, label: "Free play", glyph: "∞" },
];

export interface PlacedChip {
  id: number;
  col: number;
  row: number;
  chipId: string;
  stake: number;
  status: "pending" | "hit" | "missed";
  spawnedAt: number;
  playerId?: string | null;
  earlyEnded?: boolean;
  score?: number;
}

interface RoundState {
  startedAt: number;
  endsAt: number | null;
  lockedAtPrice: number;
  isFree: boolean;
}

interface FrozenPath {
  points: { t: number; p: number }[];
  startedAt: number;
  endedAt: number;
  anchorPrice: number;
  isTimed: boolean;
}

interface Explosion {
  id: number;
  col: number;
  row: number;
  amt: number;
  bornAt: number;
  emoji: string;
}

export interface ArcadeSession {
  you: Player;
  players: Player[];
  chipBudget: number;
  chipsLeft: number;
  currentRound: number;
  totalRounds: number;
  duration: number;
  /**
   * Fired once the round timer expires and the board has settled every
   * chip. The commit-reveal flow in `multiplayer.tsx` needs the FULL set
   * of "my placements" (hits + misses) — that's what was signed in the
   * commitment, so it's what must be revealed. `myHits` is kept for the
   * scoring overlay.
   */
  onRoundComplete: (
    settled: PlacedChip[],
    myHits: PlacedChip[],
    myPlacements: PlacedChip[],
  ) => void;
}

function streakCursor(streak: number) {
  if (streak >= 15) return "💜";
  if (streak >= 10) return "🦋";
  if (streak >= 7) return "🍯";
  if (streak >= 5) return "🌼";
  if (streak >= 3) return "💛";
  if (streak >= 1) return "🌸";
  return "";
}

function makeCursor(emoji: string) {
  if (!emoji) return "auto";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><text x='20' y='28' font-size='26' text-anchor='middle'>${emoji}</text></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 20 20, auto`;
}

const COLS = 25;
const ROWS = 10;
const LOCK_BUFFER_COLS = 3;

export function ArcadeBoard({
  market,
  onClose,
  session,
  onRoundEnd: _onRoundEnd,
}: {
  market: Market;
  onClose: () => void;
  session?: ArcadeSession;
  onRoundEnd?: () => void;
}) {
  const decimals = market.price < 10 ? 4 : market.price < 1000 ? 2 : 1;
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const isMP = !!session;
  const chipBudget = session?.chipBudget ?? 9999;

  const [chipId, setChipId] = useState("flower");
  const [stake, setStake] = useState(5);
  const [roundLen, setRoundLen] = useState<number | null>(45);
  const [chips, setChips] = useState<PlacedChip[]>([]);
  const [round, setRound] = useState<RoundState | null>(null);
  const roundRef = useRef<RoundState | null>(null);
  const [streak, setStreak] = useState(2);
  const [balance, setBalance] = useState(125420.5);
  const [pnlToday, setPnlToday] = useState(316.14);
  const [explosions, setExplosions] = useState<Explosion[]>([]);
  const [hovered, setHovered] = useState<{ col: number; row: number } | null>(null);
  const [frozenPath, setFrozenPath] = useState<FrozenPath | null>(null);

  const [now, setNow] = useState(Date.now());
  const [price, setPrice] = useState(market.price);
  const priceRef = useRef(market.price);
  const historyRef = useRef<{ t: number; p: number }[]>([]);

  const anchor = round?.lockedAtPrice ?? frozenPath?.anchorPrice ?? market.price;
  const volPerRow = useMemo(() => {
    if (market.price < 10) return 0.0006;
    if (market.price < 1000) return 0.15;
    return 50;
  }, [market.sym]);
  const priceMin = anchor - volPerRow * (ROWS / 2);
  const priceMax = anchor + volPerRow * (ROWS / 2);

  const round_total_ms = roundLen ? roundLen * 1000 : null;

  useEffect(() => {
    document.body.style.cursor = makeCursor(streakCursor(streak));
    return () => {
      document.body.style.cursor = "auto";
    };
  }, [streak]);

  useEffect(() => {
    let raf = 0;
    let lastPriceUpdate = Date.now();
    const loop = () => {
      const t = Date.now();
      setNow(t);
      if (t - lastPriceUpdate > 120) {
        lastPriceUpdate = t;
        const drift = (Math.random() - 0.5) * volPerRow * 0.35;
        priceRef.current = priceRef.current + drift;
        if (round) {
          priceRef.current += (anchor - priceRef.current) * 0.05;
        }
        priceRef.current = Math.max(
          priceMin + volPerRow * 0.2,
          Math.min(priceMax - volPerRow * 0.2, priceRef.current)
        );
        setPrice(priceRef.current);
        historyRef.current.push({ t, p: priceRef.current });
        if (round) {
          if (round.endsAt != null) {
            historyRef.current = historyRef.current.filter((h) => h.t >= round.startedAt);
          } else {
            historyRef.current = historyRef.current.slice(-200);
          }
        } else {
          historyRef.current = historyRef.current.slice(-200);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [round, anchor, volPerRow, priceMin, priceMax]);

  useEffect(() => {
    priceRef.current = market.price;
    setPrice(market.price);
    historyRef.current = [];
  }, [market.sym, market.price]);

  useEffect(() => {
    if (!round) return;
    if (round.endsAt == null) return;
    if (now < round.endsAt) return;
    setFrozenPath({
      points: [...historyRef.current],
      startedAt: round.startedAt,
      endedAt: round.endsAt,
      anchorPrice: round.lockedAtPrice,
      isTimed: true,
    });
    setChips((prev) => {
      const settled = prev.map((c) => (c.status === "pending" ? { ...c, status: "missed" as const } : c));
      const wonCount = settled.filter((c) => c.status === "hit").length;
      const lostCount = settled.filter((c) => c.status === "missed").length;
      if (wonCount > 0 && lostCount === 0) setStreak((s) => s + 1);
      else if (wonCount === 0 && lostCount > 0) setStreak(0);
      if (isMP && session?.onRoundComplete) {
        const myPlacements = settled.filter((c) => c.playerId === "you");
        const myHits = myPlacements
          .filter((c) => c.status === "hit")
          .map((c) => ({ ...c, score: 20 * payoutForCell(c.col, c.row, 0) }));
        setTimeout(
          () => session.onRoundComplete(settled, myHits, myPlacements),
          800,
        );
      }
      return settled;
    });
    roundRef.current = null;
    setRound(null);
  }, [round, now]);

  useEffect(() => {
    if (!round) return;
    setChips((prev) => {
      let changed = false;
      const elapsed = now - round.startedAt;
      const totalMs = roundLen ? roundLen * 1000 : 1;
      const liveCol = roundLen ? Math.floor((elapsed / totalMs) * COLS) : null;
      const liveRow = priceToRow(price);
      const next = prev.map((c) => {
        if (c.status !== "pending") return c;
        if (roundLen) {
          if (liveCol === c.col && liveRow === c.row) {
            changed = true;
            setTimeout(() => {
              setExplosions((ex) => [
                ...ex,
                {
                  id: Math.random(),
                  col: c.col,
                  row: c.row,
                  amt: c.stake * payoutForCell(c.col, c.row),
                  bornAt: Date.now(),
                  emoji: CHIPS.find((ch) => ch.id === c.chipId)?.emoji || "✦",
                },
              ]);
              setBalance((b) => b + c.stake * (payoutForCell(c.col, c.row) - 1));
              setPnlToday((p) => p + c.stake * (payoutForCell(c.col, c.row) - 1));
            }, 0);
            return { ...c, status: "hit" as const };
          }
          if (liveCol !== null && liveCol > c.col) {
            changed = true;
            return { ...c, status: "missed" as const };
          }
        } else {
          if (liveRow === c.row) {
            changed = true;
            setTimeout(() => {
              setExplosions((ex) => [
                ...ex,
                {
                  id: Math.random(),
                  col: c.col,
                  row: c.row,
                  amt: c.stake * payoutForCell(c.col, c.row),
                  bornAt: Date.now(),
                  emoji: CHIPS.find((ch) => ch.id === c.chipId)?.emoji || "✦",
                },
              ]);
              setBalance((b) => b + c.stake * (payoutForCell(c.col, c.row) - 1));
              setPnlToday((p) => p + c.stake * (payoutForCell(c.col, c.row) - 1));
            }, 0);
            return { ...c, status: "hit" as const };
          }
        }
        return c;
      });
      return changed ? next : prev;
    });
  }, [now, round, price, roundLen]);

  useEffect(() => {
    if (!explosions.length) return;
    const id = setInterval(() => {
      setExplosions((ex) => ex.filter((e) => Date.now() - e.bornAt < 1400));
    }, 200);
    return () => clearInterval(id);
  }, [explosions.length]);

  function priceToRow(p: number) {
    const r = Math.floor(((priceMax - p) / (priceMax - priceMin)) * ROWS);
    return Math.max(0, Math.min(ROWS - 1, r));
  }

  function payoutForCell(col: number, row: number, liveColParam?: number) {
    const anchorRow = ROWS / 2 - 0.5;
    const dY = Math.abs(row - anchorRow);
    const lc = typeof liveColParam === "number" ? liveColParam : 0;
    const dX = Math.max(0, col - lc);
    return +(1.15 + dY * 0.22 + dX * 0.18).toFixed(2);
  }

  const placeChip = (col: number, row: number) => {
    const curRound = roundRef.current;
    if (curRound && curRound.endsAt != null && Date.now() >= curRound.endsAt) return;
    if (isMP) {
      const myChips = chips.filter((c) => c.playerId === "you");
      if (myChips.length >= chipBudget) return;
      if (myChips.length >= 5) return;
      const inSameRow = myChips.filter((c) => c.row === row).length;
      if (inSameRow >= 2) return;
      const adjacent = myChips.filter((c) => c.row === row && Math.abs(c.col - col) === 1).length;
      if (adjacent >= 2) return;
    } else {
      if (balance < stake) return;
    }
    if (curRound && curRound.endsAt != null) {
      const totalMs = curRound.endsAt - curRound.startedAt;
      const elapsed = Date.now() - curRound.startedAt;
      const lc = Math.floor((elapsed / totalMs) * COLS);
      if (col < lc + LOCK_BUFFER_COLS) return;
    }
    const existing = chips.find((c) => c.col === col && c.row === row && c.status === "pending");
    if (existing) return;
    if (!curRound) {
      const startedAt = Date.now();
      const newRound: RoundState = {
        startedAt,
        endsAt: roundLen ? startedAt + roundLen * 1000 : null,
        lockedAtPrice: priceRef.current,
        isFree: roundLen == null,
      };
      roundRef.current = newRound;
      setRound(newRound);
      setFrozenPath(null);
      historyRef.current = [{ t: startedAt, p: priceRef.current }];
      setChips([{ id: Math.random(), col, row, chipId, stake, status: "pending", spawnedAt: startedAt }]);
      setBalance((b) => b - stake);
      return;
    }
    setChips((prev) => [
      ...prev,
      {
        id: Math.random(),
        col,
        row,
        chipId,
        stake: isMP ? 1 : stake,
        status: "pending",
        spawnedAt: Date.now(),
        playerId: isMP ? "you" : null,
      },
    ]);
    if (!isMP) setBalance((b) => b - stake);
  };

  const endRound = () => {
    const curRound = roundRef.current;
    if (!curRound) return;
    setFrozenPath({
      points: [...historyRef.current],
      startedAt: curRound.startedAt,
      endedAt: Date.now(),
      anchorPrice: curRound.lockedAtPrice,
      isTimed: curRound.endsAt != null,
    });
    setChips((prev) => {
      const settled = prev.map((c) => {
        if (c.status !== "pending") return c;
        setTimeout(() => setBalance((b) => b + c.stake * 0.85), 0);
        return { ...c, status: "missed" as const, earlyEnded: true };
      });
      return settled;
    });
    roundRef.current = null;
    setRound(null);
  };

  const playAnother = () => {
    setChips([]);
    setFrozenPath(null);
    historyRef.current = [];
    roundRef.current = null;
    setRound(null);
  };

  const reclaimChip = (chipKey: number) => {
    setChips((prev) => {
      const target = prev.find((c) => c.id === chipKey);
      if (!target || target.status !== "pending") return prev;
      if (round && round.endsAt != null && round_total_ms) {
        const elapsed = now - round.startedAt;
        const liveCol = Math.floor((elapsed / round_total_ms) * COLS);
        if (liveCol > target.col) return prev;
      }
      setBalance((b) => b + target.stake * 0.85);
      return prev.filter((c) => c.id !== chipKey);
    });
  };

  const pendingChips = chips.filter((c) => c.status === "pending");
  const hitChips = chips.filter((c) => c.status === "hit");
  const missedChips = chips.filter((c) => c.status === "missed");
  const totalStaked = pendingChips.reduce((s, c) => s + c.stake, 0);
  const realizedWin = hitChips.reduce((s, c) => s + c.stake * (payoutForCell(c.col, c.row) - 1), 0);
  const hasSettled = !round && (hitChips.length > 0 || missedChips.length > 0);
  const remainingSec = round && round.endsAt != null ? Math.max(0, Math.ceil((round.endsAt - now) / 1000)) : null;
  const roundProgress = round && round.endsAt != null && round_total_ms ? Math.min(1, (now - round.startedAt) / round_total_ms) : 0;

  const cellW = 100 / COLS;
  const cellH = 100 / ROWS;

  const isTimedActive = !!(round && round.endsAt != null);
  const cursorX = isTimedActive ? roundProgress * 100 : 0;
  const elapsedNow = isTimedActive && round ? now - round.startedAt : 0;
  const liveColComp = isTimedActive && round_total_ms ? Math.floor((elapsedNow / round_total_ms) * COLS) : 0;
  const lockUntilColComp = isTimedActive ? Math.min(COLS, liveColComp + LOCK_BUFFER_COLS) : 0;
  const lockZoneEndX = isTimedActive ? (lockUntilColComp / COLS) * 100 : 0;

  const pricePath = useMemo(() => {
    if (frozenPath && !round) {
      const points = frozenPath.points;
      if (points.length < 2) return "";
      if (frozenPath.isTimed) {
        const totalMs = frozenPath.endedAt - frozenPath.startedAt;
        const xOf = (t: number) => Math.min(100, ((t - frozenPath.startedAt) / totalMs) * 100);
        const yOf = (p: number) => ((priceMax - p) / (priceMax - priceMin)) * 100;
        return points.map((p, i) => (i === 0 ? "M" : "L") + xOf(p.t).toFixed(2) + "," + yOf(p.p).toFixed(2)).join(" ");
      }
      const xOf = (i: number, n: number) => (i / Math.max(1, n - 1)) * 100;
      const yOf = (p: number) => ((priceMax - p) / (priceMax - priceMin)) * 100;
      return points
        .map((p, i) => (i === 0 ? "M" : "L") + xOf(i, points.length).toFixed(2) + "," + yOf(p.p).toFixed(2))
        .join(" ");
    }
    if (!round) return "";
    const points = historyRef.current;
    if (points.length < 2) return "";
    if (round.endsAt != null && round_total_ms) {
      const xOf = (t: number) => ((t - round.startedAt) / round_total_ms) * 100;
      const yOf = (p: number) => ((priceMax - p) / (priceMax - priceMin)) * 100;
      return points.map((p, i) => (i === 0 ? "M" : "L") + xOf(p.t).toFixed(2) + "," + yOf(p.p).toFixed(2)).join(" ");
    }
    const xOf = (i: number, n: number) => (i / Math.max(1, n - 1)) * 100;
    const yOf = (p: number) => ((priceMax - p) / (priceMax - priceMin)) * 100;
    return points
      .map((p, i) => (i === 0 ? "M" : "L") + xOf(i, points.length).toFixed(2) + "," + yOf(p.p).toFixed(2))
      .join(" ");
  }, [now, round, frozenPath, priceMin, priceMax, round_total_ms]);

  const idleRibbon = useMemo(() => {
    if (round || frozenPath) return "";
    const points = historyRef.current.slice(-60);
    if (points.length < 2) return "";
    const lo = Math.min(...points.map((p) => p.p));
    const hi = Math.max(...points.map((p) => p.p));
    const xOf = (i: number, n: number) => (i / (n - 1)) * 100;
    const yOf = (p: number) => ((hi - p) / Math.max(hi - lo, 0.0001)) * 100;
    return points
      .map((p, i) => (i === 0 ? "M" : "L") + xOf(i, points.length).toFixed(2) + "," + yOf(p.p).toFixed(2))
      .join(" ");
  }, [round, frozenPath, price]);

  const chipEmojiNow = CHIPS.find((c) => c.id === chipId)?.emoji || "✦";

  return (
    <div className={"arcade2 " + (hasSettled ? "settled " : "") + (isMP ? "mp " : "")}>
      {isMP && session && session.players && (
        <LeaderboardPanel
          players={session.players}
          currentRound={session.currentRound}
          totalRounds={session.totalRounds}
          chipsLeft={session.chipsLeft}
          chipBudget={session.chipBudget}
          you={session.you}
        />
      )}
      <div className="arcade2-bar">
        <div className="bar-left">
          <FlagPair a={market.flagA} b={market.flagB} size={24} />
          <div className="bar-sym-block">
            <span className="bar-sym">{market.sym}</span>
            <span className="mono bar-spot-price">{price.toFixed(decimals)}</span>
          </div>
        </div>

        <div className="bar-center">
          {round && round.endsAt != null && (
            <div className="round-timer">
              <span className="round-time mono">{remainingSec}s</span>
              <div className="round-progress">
                <div style={{ width: `${roundProgress * 100}%` }} />
              </div>
            </div>
          )}
          {round && round.endsAt == null && (
            <div className="round-timer free-play">
              <span className="round-time mono">∞</span>
              <button className="end-round-btn" onClick={endRound}>
                End
              </button>
            </div>
          )}
          {!round && hasSettled && (
            <div className="round-result">
              <div className="rr-stats">
                <span className="rr-pip won">{hitChips.length}</span>
                <span className="rr-pip lost">{missedChips.length}</span>
                <span className={"rr-amt mono " + (realizedWin >= 0 ? "profit" : "loss")}>
                  {realizedWin >= 0 ? "+" : ""}
                  {fmtUSD(realizedWin)}
                </span>
              </div>
              <button className="play-again-btn" onClick={playAnother}>
                <span className="pa-spark">✦</span>
                <span>Play again</span>
              </button>
            </div>
          )}
          {!round && !hasSettled && <div className="round-idle">Tap a tile to play</div>}
        </div>

        <div className="bar-right">
          <div className="streak-pill2">
            <span className="streak-emoji">{streakCursor(streak) || "🎮"}</span>
            <span className="mono streak-count">{streak}</span>
          </div>
          <button className="exit-pro" onClick={onClose} title="Back to Pro">
            <span className="mode-glyph">⊞</span>
            <span>Pro</span>
          </button>
        </div>
      </div>

      <div className="arcade2-canvas" ref={wrapRef}>
        <svg className="grid-svg grid-svg-bg" viewBox="0 0 100 100" preserveAspectRatio="none">
          {Array.from({ length: COLS + 1 }, (_, i) => (
            <line key={"v" + i} x1={i * cellW} y1="0" x2={i * cellW} y2="100" className="grid-line" />
          ))}
          {Array.from({ length: ROWS + 1 }, (_, i) => (
            <line key={"h" + i} x1="0" y1={i * cellH} x2="100" y2={i * cellH} className="grid-line" />
          ))}
          <line x1="0" y1={50} x2="100" y2={50} className="anchor-line" />
        </svg>

        {hovered &&
          (() => {
            const passed = isTimedActive && hovered.col < liveColComp;
            const locked = isTimedActive && !passed && hovered.col < lockUntilColComp;
            return (
              <div
                className={"hover-cell " + (locked ? "hover-locked" : "") + (passed ? " hover-past" : "")}
                style={{
                  left: `${hovered.col * cellW}%`,
                  top: `${hovered.row * cellH}%`,
                  width: `${cellW}%`,
                  height: `${cellH}%`,
                }}
              >
                {locked || passed ? (
                  <div className="hover-info hover-info-locked">{locked ? "LOCKED" : "PAST"}</div>
                ) : (
                  <>
                    <span className="hover-ghost-emoji">{chipEmojiNow}</span>
                    <div className="hover-info mono">×{payoutForCell(hovered.col, hovered.row, liveColComp)}</div>
                  </>
                )}
              </div>
            );
          })()}

        <div
          className="cell-grid"
          style={{
            gridTemplateColumns: `repeat(${COLS}, 1fr)`,
            gridTemplateRows: `repeat(${ROWS}, 1fr)`,
          }}
        >
          {Array.from({ length: COLS * ROWS }, (_, i) => {
            const col = i % COLS;
            const row = Math.floor(i / COLS);
            const elapsed = isTimedActive && round ? now - round.startedAt : 0;
            const liveCol = isTimedActive && round_total_ms ? Math.floor((elapsed / round_total_ms) * COLS) : 0;
            const lockUntilCol = isTimedActive ? liveCol + LOCK_BUFFER_COLS : 0;
            const passed = isTimedActive && col < liveCol;
            const locked = isTimedActive && !passed && col < lockUntilCol;
            const chip = chips.find((c) => c.col === col && c.row === row);
            const chipDef = chip ? CHIPS.find((cc) => cc.id === chip.chipId) : null;
            const clickable = !passed && !locked;
            return (
              <div
                key={i}
                className={
                  "cell " +
                  (passed ? "past " : "") +
                  (locked && !chip ? "locked " : "") +
                  (chip ? "painted state-" + chip.status + " " : "")
                }
                onMouseEnter={() => setHovered({ col, row })}
                onMouseLeave={() => setHovered((h) => (h?.col === col && h?.row === row ? null : h))}
                onClick={() => {
                  if (passed) return;
                  if (chip && chip.status === "pending") {
                    reclaimChip(chip.id);
                    return;
                  }
                  if (!chip && clickable) placeChip(col, row);
                }}
              >
                {chip && (
                  <>
                    <span className="cell-emoji">{chipDef?.emoji}</span>
                    <span className="cell-stake mono">
                      {chip.status === "hit"
                        ? "+$" + (chip.stake * (payoutForCell(chip.col, chip.row, liveCol) - 1)).toFixed(0)
                        : chip.status === "missed"
                        ? "−$" + chip.stake
                        : "$" + chip.stake}
                    </span>
                    {chip.status === "hit" && <span className="cell-mark hit-mark">✓</span>}
                    {chip.status === "missed" && <span className="cell-mark miss-mark">×</span>}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {chips.length === 0 && !round && (
          <div className="canvas-empty-hint">
            <span className="hint-emoji">{chipEmojiNow}</span>
            <span>Tap a tile to place a chip</span>
          </div>
        )}

        <svg className="grid-svg grid-svg-fg" viewBox="0 0 100 100" preserveAspectRatio="none">
          {!round && idleRibbon && <path d={idleRibbon} className="idle-path" />}
          {pricePath && (
            <>
              <path d={pricePath} className="price-path-glow" />
              <path d={pricePath} className="price-path" />
            </>
          )}
          {isTimedActive && (
            <>
              <rect
                x={cursorX}
                y="0"
                width={Math.max(0, lockZoneEndX - cursorX)}
                height="100"
                className="lock-zone"
              />
              <line x1={cursorX} y1="0" x2={cursorX} y2="100" className="sweep-line" />
              <line x1={lockZoneEndX} y1="0" x2={lockZoneEndX} y2="100" className="commit-line" />
              <rect x="0" y="0" width={cursorX} height="100" className="past-fade" />
            </>
          )}
        </svg>

        <div className="explosions">
          {explosions.map((e) => {
            const x = e.col * cellW + cellW / 2;
            const y = e.row * cellH + cellH / 2;
            return (
              <div key={e.id} className="explosion" style={{ left: `${x}%`, top: `${y}%` }}>
                <div className="boom-ring" />
                <div className="boom-ring boom-ring-2" />
                {["🌸", "💛", "✨", "🍯", e.emoji].map((em, i) => (
                  <span
                    key={i}
                    className={"spark spark-" + i}
                    style={{ "--ang": `${i * 72}deg` } as CSSProperties}
                  >
                    {em}
                  </span>
                ))}
                <div className="boom-amt mono">+${e.amt.toFixed(2)}</div>
              </div>
            );
          })}
        </div>

        <div className="price-axis">
          <span className="px-label mono">{priceMax.toFixed(decimals)}</span>
          <span className="px-label mono anchor-tag">{anchor.toFixed(decimals)} ◂ anchor</span>
          <span className="px-label mono">{priceMin.toFixed(decimals)}</span>
        </div>
      </div>

      <div className="arcade2-dock">
        <div className="dock-section">
          <div className="dock-label">
            Chip <Hint w={240}>Your "stamp" on the board. Just a visual — pick a favorite.</Hint>
          </div>
          <div className="chip-picker">
            {CHIPS.map((c) => (
              <button
                key={c.id}
                className={"chip-pick " + (chipId === c.id ? "active" : "")}
                onClick={() => setChipId(c.id)}
                title={c.label}
              >
                {c.emoji}
              </button>
            ))}
          </div>
        </div>
        <div className="dock-section">
          <div className="dock-label">
            Stake <Hint w={260}>How much each chip risks. Tile payouts scale with distance from the anchor.</Hint>
          </div>
          <div className="stake-picker">
            {STAKES.map((s) => (
              <button
                key={s}
                className={"stake-pick " + (stake === s ? "active" : "")}
                onClick={() => setStake(s)}
              >
                ${s}
              </button>
            ))}
          </div>
        </div>
        <div className="dock-section">
          <div className="dock-label">
            Round{" "}
            <Hint w={280}>
              How long this round runs. Chips placed before time&apos;s up are evaluated when the price line crosses them.
            </Hint>
          </div>
          <div className="round-picker">
            {ROUND_LENS.map((r) => (
              <button
                key={r.label}
                className={"round-pick " + (roundLen === r.sec ? "active" : "")}
                onClick={() => !round && setRoundLen(r.sec)}
                disabled={!!round}
                title={r.sec ? `Round lasts ${r.label}` : "No timer — place chips at your own pace"}
              >
                {r.glyph && <span style={{ fontSize: 14, marginRight: 3 }}>{r.glyph}</span>}
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="dock-stats">
          <div className="dstat">
            <span className="apy-l">
              In play <Hint w={220}>Total stake riding on the board right now.</Hint>
            </span>
            <span className="mono dstat-v">{fmtUSD(totalStaked)}</span>
          </div>
          <div className="dstat">
            <span className="apy-l">
              Today <Hint w={200}>Net winnings or losses since midnight.</Hint>
            </span>
            <span className={"mono dstat-v " + (pnlToday >= 0 ? "profit" : "loss")}>
              {pnlToday >= 0 ? "+" : ""}
              {fmtUSD(pnlToday)}
            </span>
          </div>
          <div className="dstat">
            <span className="apy-l">
              Wallet{" "}
              <Hint w={220} side="left">
                Cash available to stake. Tops up between rounds.
              </Hint>
            </span>
            <span className="mono dstat-v">{fmtUSD(balance)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
