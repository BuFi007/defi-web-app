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
  /** Read from the perps clearinghouse quote view, never computed off-chain. */
  fee: string;
  /** Read from on-chain oracle/clearinghouse state. */
  markPrice: string;
  requiredMargin: string;
  maxLeverage: number;
  oracleStaleSeconds: number;
  oracle: {
    source: "pyth" | "onchain";
    timestamp: number;
    maxStaleSeconds: number;
  };
}

export interface PerpIntent {
  intentId: string;
  /** Source partially-filled intent when this order re-enters residual quantity. */
  replacementOf?: string;
  chainId: ChainId;
  trader: Address;
  marketId: string;
  side: PerpSide;
  sizeUsdc: string;
  /** Contract-native signed size delta for FxOrderSettlement.SignedOrder. */
  sizeDelta: string;
  /** Signed cumulative filled size delta. Same sign as `sizeDelta`. */
  filledSizeDelta: string;
  /** Signed remaining size delta. Same sign as `sizeDelta`; zero when fully filled. */
  remainingSizeDelta: string;
  leverage: number;
  orderType: "limit" | "market";
  /** Limit/trigger price in 1e18 fixed point. Zero for market orders. */
  priceE18: string;
  limitPrice?: string;
  reduceOnly: boolean;
  postOnly: boolean;
  /** Contract SignedOrder.flags bitfield: bit0 reduce-only, bit1 post-only. */
  flags: number;
  /** EIP-712 typed-data hash the trader signed. */
  digest: Hash;
  signature: Hex;
  nonce: bigint;
  deadline: number;
  status: "pending" | "partially_filled" | "filled" | "rejected" | "expired";
  createdAt: number;
  updatedAt: number;
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

// ---------- domain events ----------

export interface DomainEvent {
  eventId: string;
  type: string;
  aggregateId: string;
  actor?: string;
  payload: Record<string, unknown>;
  createdAt: number;
}
