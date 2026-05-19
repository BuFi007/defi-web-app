"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { useChainId, useSendTransaction, useSwitchChain } from "wagmi";

import {
  buildSelectedTilesHash,
  buildSelectionCommitment,
  prepareClaimPrizeTransaction,
} from "@bufi/fx-bento";

import { useToast } from "@/components/ui/use-toast";
import {
  type BentoSimulatorRoom,
  createDevRoom,
  devCommitSelection,
  devJoinRoom,
  devRevealSelection,
} from "@/lib/bento/client";
import { useDevWallet } from "@/lib/dev-wallet";
import { useBufiAddress, useBufiIsDevMock } from "@/lib/session";
import { truncateAddress } from "@/utils";
import {
  useBentoClaim,
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

// Deterministic ghost player used to satisfy minPlayers=2 in the dev
// simulator when the BENTO_E2E shim is driving the lobby with a single
// mock wallet. The simulator only reads this as an address string (it
// never signs as the ghost), so any well-formed hex works — the
// `deadbeef...` byte pattern keeps it obviously fake in logs.
const BENTO_E2E_GHOST_PLAYER =
  "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as const;

// Production room ids are uint256 strings; the dev simulator returns
// human-readable `room_<hex8>` ids that BigInt() can't parse. The on-chain
// commitment hash uses the room id for domain separation, but for the dev
// simulator path the API only verifies commit==reveal (not against an
// on-chain bytes32), so a deterministic fallback of 0n keeps both sides
// consistent and the lifecycle works end-to-end without contract reads.
function safeRoomIdBigInt(roomId: string): bigint {
  try {
    return BigInt(roomId);
  } catch {
    return 0n;
  }
}

// Perps markets use ISO pairs (EUR/USD), Bento dev rooms only accept the
// stablecoin pairs declared in packages/fx-bento/src/schemas.ts:42. Map the
// quoted currency to the matching stablecoin market; fall back to USDC/EURC.
function mapPerpsSymToBentoMarket(sym: string | undefined): string {
  const base = sym?.split("/")[0]?.toUpperCase() ?? "";
  switch (base) {
    case "EUR":
      return "USDC/EURC";
    case "JPY":
      return "USDC/JPYC";
    case "MXN":
      return "USDC/MXNB";
    case "CAD":
      return "USDC/QCAD";
    case "BRL":
      return "USDC/BRL";
    default:
      return "USDC/EURC";
  }
}

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

function truncateHex(hex: string, head = 10, tail = 8): string {
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/**
 * Generate a cryptographically-random 32-byte nonce. Used as the
 * unguessable salt in the commit-reveal hash so an opponent who sees the
 * commitment cannot reconstruct your tile selection.
 */
function generateNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as Hex;
}

/**
 * Convert this round's placed chips to the on-chain TileSelection shape.
 * The contract expects parallel `rows[]`/`cols[]` arrays (one entry per
 * placed chip, NOT a set of unique rows + set of unique cols — that
 * loses position info). chipCount mirrors `rows.length`.
 *
 * `clientStateHash` binds the placement metadata that doesn't live in
 * the row/col arrays (chipId emoji + stake) so the keeper can replay the
 * placement deterministically.
 */
function selectionFromPlacements(placements: PlacedChip[]): {
  rows: number[];
  cols: number[];
  chipCount: number;
  clientStateHash: Hex;
} | null {
  if (placements.length === 0) return null;
  // The on-chain TileSelectionSchema rejects rows[]/cols[] longer than 5.
  // The arcade board already caps "my chips per round" at 5, but be
  // defensive in case that limit shifts.
  const capped = placements.slice(0, 5);
  const rows = capped.map((c) => c.row);
  const cols = capped.map((c) => c.col);
  const meta = capped.map((c) => ({
    chipId: c.chipId,
    stake: BigInt(Math.max(0, Math.round(c.stake))),
  }));
  const clientStateHash = keccak256(
    encodeAbiParameters(
      [
        { name: "version", type: "string" },
        { name: "rows", type: "uint8[]" },
        { name: "cols", type: "uint8[]" },
        { name: "chipIds", type: "string[]" },
        { name: "stakes", type: "uint256[]" },
      ],
      [
        "bento-arcade-client-v1",
        rows,
        cols,
        meta.map((m) => m.chipId),
        meta.map((m) => m.stake),
      ],
    ),
  );
  return { rows, cols, chipCount: capped.length, clientStateHash };
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
        {/* lobby-wallet + exit-pro removed 2026-05-18. The wallet pill
            lives in the global header now (StablecoinBalances) and the
            "back to Pro" pivot is the header's Arcade toggle, which
            already shows on every tab. */}
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

export interface ClaimPanelState {
  /** True if the API has finalised settlement and produced a proof. */
  ready: boolean;
  /** True while waiting for the indexer to publish the settlement root. */
  pending: boolean;
  /** Already claimed on-chain. */
  claimed: boolean;
  /** Wei amount as a string (avoid losing precision through JS numbers). */
  amount: string | null;
  /** Sibling hashes the contract uses to walk to the merkle root. */
  proof: Hex[];
  /** keccak256(roomId, player, amount) — the player's row in the tree. */
  leaf: Hex | null;
  /** Root the contract verifies the leaf against. */
  settlementRoot: Hex | null;
  /** True while the wallet is broadcasting / waiting for confirmation. */
  submitting: boolean;
  /** Last on-chain tx hash if the claim succeeded. */
  txHash: `0x${string}` | null;
  /** Surfaced API/RPC error, if any. */
  error: string | null;
}

export function RoundEndOverlay({
  players,
  roundNum,
  totalRounds: _totalRounds,
  isFinal,
  onNext,
  onClaim,
  claim,
}: {
  players: Player[];
  roundNum: number;
  totalRounds: number;
  isFinal: boolean;
  onNext: () => void;
  /** Async — broadcasts the claim tx through wagmi. */
  onClaim?: () => Promise<void> | void;
  claim?: ClaimPanelState;
}) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const showClaim = isFinal && !!claim;
  const youWonOnchain = !!claim?.amount && claim.amount !== "0";
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

        {showClaim && claim && (
          <div className="re-claim">
            <div className="re-claim-head">
              <span className="lobby-eyebrow">
                CLAIM{" "}
                <Hint w={280}>
                  Your prize is unlocked via a Merkle proof. The contract verifies the
                  proof against the on-chain settlement root before releasing USDC.
                </Hint>
              </span>
              <span
                className={
                  "mono re-claim-amt " + (youWonOnchain ? "profit" : "")
                }
              >
                {claim.amount ? `${claim.amount} wei` : "—"}
              </span>
            </div>
            {(claim.settlementRoot || (claim.proof && claim.proof.length > 0) || claim.leaf) && (
              <div className="re-claim-proof mono" aria-label="Merkle proof inputs">
                {claim.settlementRoot && (
                  <div className="re-claim-row">
                    <span className="re-claim-label">root</span>
                    <span className="re-claim-val" title={claim.settlementRoot}>
                      {truncateHex(claim.settlementRoot)}
                    </span>
                  </div>
                )}
                {claim.leaf && (
                  <div className="re-claim-row">
                    <span className="re-claim-label">leaf</span>
                    <span className="re-claim-val" title={claim.leaf}>
                      {truncateHex(claim.leaf)}
                    </span>
                  </div>
                )}
                {claim.proof?.map((p, idx) => (
                  <div className="re-claim-row" key={`${idx}-${p}`}>
                    <span className="re-claim-label">proof[{idx}]</span>
                    <span className="re-claim-val" title={p}>
                      {truncateHex(p)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {claim.error && (
              <div className="re-claim-error" role="alert">
                {claim.error}
              </div>
            )}
            {!claim.ready && claim.pending && (
              <div className="re-claim-status apy-l">
                Waiting for settlement proof…
              </div>
            )}
            {claim.claimed && (
              <div className="re-claim-status apy-l">Already claimed.</div>
            )}
            {claim.txHash && (
              <div className="re-claim-status apy-l mono" title={claim.txHash}>
                tx {truncateHex(claim.txHash)}
              </div>
            )}
            {onClaim && (
              <button
                className="play-again-btn"
                onClick={() => {
                  void onClaim();
                }}
                disabled={
                  !claim.ready ||
                  claim.claimed ||
                  claim.submitting ||
                  !youWonOnchain
                }
                title={
                  !claim.ready
                    ? "Proof not ready yet"
                    : claim.claimed
                      ? "Already claimed"
                      : !youWonOnchain
                        ? "No prize to claim"
                        : "Broadcast claim transaction"
                }
              >
                <span className="pa-spark">✦</span>
                <span>
                  {claim.submitting
                    ? "Claiming…"
                    : claim.claimed
                      ? "Claimed"
                      : claim.ready && youWonOnchain
                        ? "Claim prize"
                        : "No prize"}
                </span>
              </button>
            )}
          </div>
        )}

        <button className="play-again-btn" onClick={onNext}>
          <span className="pa-spark">✦</span>
          <span>{isFinal ? "Back to lobby" : `Round ${roundNum + 1} →`}</span>
        </button>
      </div>
    </div>
  );
}

// ---------- top-level component ----------

export type ArcadePhase =
  | "lobby"
  | "countdown"
  | "playing"
  | "roundEnd"
  | "final";

export function ArcadeRoom({
  market,
  onClose,
  onPhaseChange,
}: {
  market: Market;
  onClose: () => void;
  /** Optional listener — TradeIsland reads this to morph the outer
   *  dynamic-island width per arcade phase. */
  onPhaseChange?: (phase: ArcadePhase) => void;
}) {
  const [phase, setPhase] = useState<ArcadePhase>("lobby");
  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);
  const [joinedRoomId, setJoinedRoomId] = useState<string | null>(null);
  const [round, setRound] = useState(1);
  const [countNum, setCountNum] = useState(3);
  // Wallet balance display is opaque for now; the real entry fee leaves wagmi
  // when the tx is sent. Will read from useBalance(USDC) once token wiring lands.
  const [wallet, setWallet] = useState(125420.5);

  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const { toast } = useToast();

  // Single source of truth — store collapses wagmi + Dynamic + dev-mock
  // into one identity. `useBufiIsDevMock()` returns true iff the active
  // identity came from the dev-wallet shim; that's the gate the commit /
  // reveal / join paths use to bypass wagmi broadcast.
  //
  // Fall back to devWallet.address directly when the store hasn't been
  // populated yet: SessionBridge writes from a useEffect that fires after
  // first paint, so on initial render `useBufiAddress()` returns null
  // even when the dev wallet is present. The fallback eliminates a
  // microsecond race where a Join click could short-circuit on null.
  const storeAddress = useBufiAddress();
  const isDevWalletActive = useBufiIsDevMock();
  const devWallet = useDevWallet();
  const address = storeAddress ?? devWallet?.address ?? undefined;

  // Per-round nonces keyed by `roundIndex`. The same nonce must be used at
  // commit AND reveal time — losing it means the contract rejects the
  // reveal as `commitment_mismatch`. Stored in a ref so re-renders during
  // the round don't fire generation again.
  const nonceCacheRef = useRef<Map<number, Hex>>(new Map());

  // Claim flow state — populated when the room reaches `final` phase and
  // the indexer publishes a settlement root we can verify against.
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [claimTxHash, setClaimTxHash] = useState<`0x${string}` | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  // Local "claimed" tracker — the API's `claimed` field is best-effort
  // until the indexer picks up the event, so we mirror the success
  // optimistically in component state to keep the button disabled.
  const [claimedLocal, setClaimedLocal] = useState(false);

  const { data: roomsData, loading: roomsLoading, refetch: refetchRooms } = useBentoRooms();
  const { data: roomData } = useBentoRoom(joinedRoomId);
  const { data: leaderboard } = useBentoLeaderboard(joinedRoomId);

  const { prepare: prepareJoin } = useJoinRoomPrepare();
  const { prepare: prepareCommit } = useCommitSelectionPrepare();
  const { prepare: prepareReveal } = useRevealSelectionPrepare();

  const claimEnabled = phase === "final" && !!joinedRoomId && !!address;
  const { data: claimData, refetch: refetchClaim } = useBentoClaim({
    roomId: joinedRoomId,
    address,
    chainId: BENTO_CHAIN_ID,
    enabled: claimEnabled,
  });

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
        // Single actionable toast. The earlier two-branch version
        // ("Wallet warming up" vs "Connect a wallet") tried to be
        // helpful but misfired in the common case where Dynamic
        // had a stale cached `useIsLoggedIn` from a previous tab
        // — the user saw "warming up" forever and had no clear
        // action. Pointing them at the Dynamic widget always works.
        toast({
          title: "Connect a wallet",
          description: "Sign in via the wallet button (top right) to join the arcade.",
        });
        return;
      }
      if (wallet < r.fee) {
        toast({ title: "Insufficient balance", description: `Need ${fmtUSD(r.fee)} USDC.` });
        return;
      }
      try {
        if (isDevWalletActive) {
          // BENTO_E2E shim path: skip wagmi broadcast. devJoinRoom is
          // idempotent if the player already joined via the lobby's
          // Create button.
          await devJoinRoom({
            roomId: r.id,
            player: address as `0x${string}`,
          }).catch(() => undefined);
          toast({ title: "Joining room", description: `Joined ${r.id} (dev sim).` });
        } else {
          await ensureChain();
          const payload = await prepareJoin({ roomId: r.id, chainId: BENTO_CHAIN_ID });
          const hash = await sendPrepared(payload);
          toast({
            title: "Joining room",
            description: `Tx ${truncateAddress(hash)} broadcast.`,
          });
        }
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
    [
      address,
      wallet,
      ensureChain,
      prepareJoin,
      sendPrepared,
      isDevWalletActive,
      toast,
      refetchRooms,
    ],
  );

  const handleCreateRoom = useCallback(async () => {
    try {
      const created = await createDevRoom({
        marketId: mapPerpsSymToBentoMarket(market.sym),
        entryFeeUsdc: 5,
        minPlayers: 2,
        maxPlayers: 6,
        rounds: 3,
      });
      if (address) {
        await devJoinRoom({ roomId: created.id, player: address }).catch(() => undefined);
      }
      if (isDevWalletActive && address) {
        // Bento schema floor is minPlayers=2. Auto-join a deterministic
        // ghost player so the room activates and our subsequent commits
        // don't trip `room_not_active`. The dev wallet's session header
        // authorizes the call; the simulator doesn't require session
        // address to match the body's `player`.
        await devJoinRoom({
          roomId: created.id,
          player: BENTO_E2E_GHOST_PLAYER,
        }).catch(() => undefined);
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
  }, [market.sym, address, isDevWalletActive, refetchRooms, toast]);

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
    async (
      _settled: PlacedChip[],
      _myHits: PlacedChip[],
      myPlacements: PlacedChip[],
    ) => {
      // Move the UI forward optimistically — chain confirmation latency
      // shouldn't gate the leaderboard overlay.
      setPhase("roundEnd");

      if (!joinedRoomId || !room || !address) return;
      const selection = selectionFromPlacements(myPlacements);
      if (!selection) return;

      const roundIndex = round - 1;
      let nonce = nonceCacheRef.current.get(roundIndex);
      if (!nonce) {
        nonce = generateNonce();
        nonceCacheRef.current.set(roundIndex, nonce);
      }

      try {
        // Build the canonical commitment that binds (chainId, roomId,
        // roundIndex, player, selectedTilesHash, nonce). The same helpers
        // run on the contract side, so a mismatch here surfaces as a
        // CommitmentManager revert at reveal time.
        const selectedTilesHash = buildSelectedTilesHash(selection);
        const commitment = buildSelectionCommitment({
          chainId: BENTO_CHAIN_ID,
          roomId: safeRoomIdBigInt(joinedRoomId),
          roundIndex,
          player: address,
          selectedTilesHash,
          nonce,
        });

        if (isDevWalletActive) {
          // BENTO_E2E shim path: skip wagmi broadcast and POST directly to
          // the dev simulator endpoints. Same wire shape as
          // scripts/smoke-bento.ts. The X-Wallet-* session headers ride
          // along automatically via jsonFetch.
          await devCommitSelection({
            roomId: joinedRoomId,
            player: address as `0x${string}`,
            roundIndex,
            commitment,
          });
          await devRevealSelection({
            roomId: joinedRoomId,
            player: address as `0x${string}`,
            roundIndex,
            rows: selection.rows,
            cols: selection.cols,
            nonce,
          });
        } else {
          const commitPayload = await prepareCommit({
            roomId: joinedRoomId,
            chainId: BENTO_CHAIN_ID,
            roundIndex,
            commitment,
          });
          await sendPrepared(commitPayload);

          // Reveal in the same flow. In the production keeper-flow the
          // reveal is gated server-side until the lock window closes — for
          // now the API accepts immediate reveals and the simulator records
          // them; an out-of-order reveal becomes a no-op on chain.
          const revealPayload = await prepareReveal({
            roomId: joinedRoomId,
            chainId: BENTO_CHAIN_ID,
            roundIndex,
            selection,
            nonce,
          });
          await sendPrepared(revealPayload);
        }
      } catch (err) {
        // Non-fatal: surface a toast so devs see why the chain didn't
        // pick up the round, but never block the UI.
        toast({
          title: "Commit/reveal failed",
          description: (err as Error).message,
          variant: "destructive",
        });
      }
    },
    [
      joinedRoomId,
      room,
      address,
      round,
      prepareCommit,
      prepareReveal,
      sendPrepared,
      isDevWalletActive,
      toast,
    ],
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
    setClaimedLocal(false);
    setClaimTxHash(null);
    setClaimError(null);
    nonceCacheRef.current.clear();
  }, []);

  // Compute the merkle leaf locally so the UI can render it BEFORE the
  // claim tx is broadcast — this is what the user is being asked to
  // approve, so they (or a script) can verify it matches the on-chain
  // settlement root.
  const claimLeaf = useMemo<Hex | null>(() => {
    if (!claimData || !address || !claimData.amount || claimData.amount === "0") {
      return null;
    }
    try {
      const amount = BigInt(claimData.amount);
      // Match buildPrizeLeaf in @bufi/fx-bento — keccak256 over
      // (roomId, player, amount) packed via abi.encode.
      const roomIdBig = (() => {
        try {
          return BigInt(claimData.roomId);
        } catch {
          // Dev simulator uses string ids like `room_xxx`; the API
          // returns them unchanged and the contract-side path is not
          // wired to those. Fall back to 0 so the UI still renders a
          // recognisable placeholder.
          return 0n;
        }
      })();
      return keccak256(
        encodeAbiParameters(
          [
            { name: "roomId", type: "uint256" },
            { name: "player", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          [roomIdBig, address, amount],
        ),
      );
    } catch {
      return null;
    }
  }, [claimData, address]);

  const claimState = useMemo<ClaimPanelState | undefined>(() => {
    if (phase !== "final" || !joinedRoomId) return undefined;
    return {
      ready: !!claimData?.claimable && !!claimData?.proofReady,
      pending: !!claimData && !claimData.claimable,
      claimed: !!claimData?.claimed || claimedLocal,
      amount: claimData?.amount ?? null,
      proof: claimData?.proof ?? [],
      leaf: claimLeaf,
      settlementRoot: claimData?.settlementRoot ?? null,
      submitting: claimSubmitting,
      txHash: claimTxHash,
      error: claimError,
    };
  }, [
    phase,
    joinedRoomId,
    claimData,
    claimLeaf,
    claimedLocal,
    claimSubmitting,
    claimTxHash,
    claimError,
  ]);

  const handleClaim = useCallback(async () => {
    if (!claimData || !joinedRoomId || !address) return;
    if (!claimData.claimable || !claimData.proofReady) {
      toast({ title: "Proof not ready", description: "Try again in a moment." });
      return;
    }
    if (claimData.amount === "0") return;
    try {
      setClaimSubmitting(true);
      setClaimError(null);
      await ensureChain();
      const request = prepareClaimPrizeTransaction(
        { chainId: BENTO_CHAIN_ID },
        {
          roomId: claimData.roomId,
          amount: claimData.amount,
          proof: claimData.proof,
        },
      );
      const hash = await sendTransactionAsync({
        to: request.to,
        data: request.data,
        value: BigInt(request.value),
      });
      setClaimTxHash(hash);
      setClaimedLocal(true);
      toast({
        title: "Claim broadcast",
        description: `Tx ${truncateAddress(hash)}`,
      });
      // Re-fetch so `claimed` flips once the indexer catches up.
      setTimeout(() => refetchClaim(), 4_000);
    } catch (err) {
      const message = (err as Error).message ?? "claim failed";
      setClaimError(message);
      toast({
        title: "Claim failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setClaimSubmitting(false);
    }
  }, [claimData, joinedRoomId, address, ensureChain, sendTransactionAsync, toast, refetchClaim]);

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
          claim={claimState}
          onClaim={isFinal ? handleClaim : undefined}
        />
      )}
    </div>
  );
}
