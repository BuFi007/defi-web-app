/**
 * Cross-package types for the BUFI / FX Telaraña / Perps / FX² Arcade stack.
 *
 * Types only — no runtime, no zod. zod schemas live in the consuming packages
 * so each domain can extend the shape.
 */

import type { Address, Hash, Hex } from "viem";

// ---------- chains ----------

/** Wagmi-supported chain IDs in the current frontend config. */
export type ChainId = 43113 | 919 | 5042002;

// ---------- identity ----------

/**
 * Wallet-based session. Replaces sendero's `tenantId` model.
 * `chainId` is included so the same wallet on Avalanche Fuji is a
 * different scope than the same wallet on Arc Testnet — Liveblocks rooms
 * and MCP workflows are scoped per chain.
 */
export interface WalletSession {
  address: Address;
  chainId: ChainId;
  /** Signed-message proof of ownership. Verified server-side. */
  proof: {
    message: string;
    signature: Hex;
    /** Issuance time as unix seconds. */
    iat: number;
    /** Expiry as unix seconds. */
    exp: number;
  };
}

// ---------- markets ----------

export type FxQuoteSymbol =
  | "USDC/EURC"
  | "USDC/MXNB"
  | "USDC/BRL"
  | "USDC/JPYC"
  | "USDC/QCAD";

export interface MarketRegistryEntry {
  marketId: string;
  symbol: FxQuoteSymbol | string;
  baseAsset: Address;
  quoteAsset: Address;
  /** Oracle / pool source. */
  source: "uniswap-v4" | "pyth" | "chainlink" | "internal";
  chainId: ChainId;
  enabled: boolean;
}

// ---------- perps ----------

export type PerpSide = "long" | "short";

export interface PerpQuote {
  marketId: string;
  side: PerpSide;
  sizeUsdc: string;
  leverage: number;
  /** Indicative entry price (1e18-scaled stringified). */
  indicativePrice: string;
  estimatedFundingBps: number;
  /** Oracle snapshot used to build this quote. */
  oracle: {
    source: MarketRegistryEntry["source"];
    timestamp: number;
    /** Caller may reject quotes older than this. */
    maxStaleSeconds: number;
  };
}

export interface PerpIntent {
  intentId: string;
  trader: Address;
  marketId: string;
  side: PerpSide;
  sizeUsdc: string;
  leverage: number;
  /** EIP-712 typed-data hash the trader signed. */
  digest: Hash;
  signature: Hex;
  nonce: bigint;
  deadline: number;
  status: "pending" | "filled" | "rejected" | "expired";
}

// ---------- fx-bento (arcade) ----------

export type RoomStatus =
  | "waiting"
  | "running"
  | "settling"
  | "settled"
  | "refunded"
  | "cancelled";

export interface ArcadeRoom {
  roomId: string;
  chainId: ChainId;
  marketId: string;
  entryFeeUsdc: string;
  chipsPerPlayer: number;
  maxPlayers: number;
  status: RoomStatus;
  startsAt: number;
  endsAt: number;
  /** Capped prize pool (player-funded). Protocol never tops up. */
  prizePoolUsdc: string;
  /** Bps the protocol keeps as rake. */
  rakeBps: number;
}

export interface PlayerChipPlacement {
  player: Address;
  tileId: string;
  chips: number;
  /** Commitment hash for blind placement. */
  commitment?: Hash;
  /** Reveal salt. Stored after reveal. */
  revealSalt?: Hex;
}

// ---------- fx-telarana (lending) ----------

export type LoanStatus =
  | "open"
  | "repaid"
  | "liquidated"
  | "closed";

export interface FxLoanPosition {
  positionId: string;
  borrower: Address;
  marketId: string;
  collateralAsset: Address;
  collateralAmount: string;
  borrowAsset: Address;
  borrowAmount: string;
  /** 1e4-scaled health factor. <1.0 (=10_000) is liquidatable. */
  healthFactorBps: number;
  status: LoanStatus;
}

// ---------- mcp workflows ----------

export type WorkflowStatus =
  | "draft"
  | "pending_signature"
  | "pending_payment"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface WorkflowAuditEntry {
  at: number;
  actor: string;
  event: string;
  data?: Record<string, unknown>;
}

export interface WorkflowState {
  workflowId: string;
  toolName: string;
  session: WalletSession | { address: null; chainId: null };
  status: WorkflowStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  /** USDC atomic units (6 dp). */
  requiredPaymentMicro?: string;
  /** EIP-712 typed-data digest the user must sign. */
  requiredSignatureDigest?: Hash;
  createdAt: number;
  updatedAt: number;
  audit: WorkflowAuditEntry[];
}
