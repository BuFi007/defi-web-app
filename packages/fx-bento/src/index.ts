/**
 * @bufi/fx-bento — domain layer for the FX² Arcade backend.
 *
 * Money model the contracts enforce:
 *   prize_pool    = sum(entry_fees)
 *   protocol_take = prize_pool * rakeBps / 10_000
 *   payouts       = prize_pool - protocol_take
 *
 *   Protocol NEVER tops up the prize pool. No refunds unless the room
 *   failed to start. Settlement is commit-reveal — players commit to a
 *   chip placement hash during play, then reveal salt + tiles at end.
 *
 * This package ports the canonical engine + tx builders from the fx-bento
 * monorepo (`@bufinance/fx-bento-game`) into the defi-web-app workspace.
 * The on-chain ABI registry + address book lives in `@bufi/contracts/bento`.
 */

import {
  BENTO_ABIS,
  getBentoAddress,
  type BentoContractAddresses,
  type BentoContractName,
  type BentoChainContractAddresses,
} from "@bufi/contracts/bento";
import {
  concat,
  createPublicClient,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  type Abi,
} from "viem";
import { z } from "zod";

import {
  AddressSchema,
  Hex32Schema,
  HexSchema,
  OnchainRoomConfigSchema,
  PrizeAllocationSchema,
  SettlementEvidenceSchema,
  SettlementPayoutRootSchema,
  TileSelectionSchema,
  type Address,
  type Hex,
  type PrizeAllocation,
  type SettlementEvidence,
} from "./schemas";
import { assertValidTilePattern } from "./service";

export * from "./schemas";
export * from "./service";
export * from "./results";

// ---------- engine types ----------

export interface FxBentoContractEngineConfig {
  chainId: number;
  /**
   * Either a flat `{ ContractName: 0x... }` map, a `{ "<chainId>": { ... } }`
   * map (matching the source `ChainContractAddresses` shape), or undefined
   * to fall back to `@bufi/contracts/bento` deployments. Caller picks.
   */
  addresses?: BentoContractAddresses | BentoChainContractAddresses;
}

export interface FxBentoTransactionRequest {
  contractName: BentoContractName;
  to: Address;
  functionName: string;
  args: unknown[];
  data: Hex;
  value: "0";
  chainId: number;
}

export interface FxBentoSimulationClient {
  simulateContract: (args: {
    account?: Address;
    address: Address;
    abi: Abi;
    functionName: string;
    args: unknown[];
    value?: bigint;
  }) => Promise<{ request?: unknown; result?: unknown }>;
  readContract: (args: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: unknown[];
  }) => Promise<unknown>;
}

export interface FxBentoSafetyCheck {
  simulation: { status: "skipped" | "passed"; reason?: string; result?: unknown };
  reconciliation: {
    status: "skipped" | "passed";
    reason?: string;
    indexedStatus?: string | null;
    contractStatus?: string | null;
  };
}

export interface FxBentoIndexedRoomSummary {
  status?: string | null;
  playerCount?: number | null;
}

export interface MerkleAllocation {
  roomId: bigint;
  player: Address;
  amount: bigint;
  score: bigint;
  rank: number;
  leaf: Hex;
  proof: Hex[];
}

export interface SettlementResultTree {
  roomId: bigint;
  root: Hex;
  totalPrizePayouts: bigint;
  allocations: MerkleAllocation[];
}

// ---------- transaction builders ----------

export function prepareCreateRoomTransaction(
  engine: FxBentoContractEngineConfig,
  input: z.input<typeof OnchainRoomConfigSchema>,
): FxBentoTransactionRequest {
  const config = OnchainRoomConfigSchema.parse(input);
  if (config.minPlayers > config.maxPlayers) throw new Error("bad_player_limits");
  if (config.payoutBps.reduce((total, value) => total + value, 0) !== 10_000) {
    throw new Error("bad_payout_split");
  }
  return contractTransaction(engine, "FXBentoRoomFactory", "createRoom", [config]);
}

export function prepareJoinRoomTransaction(
  engine: FxBentoContractEngineConfig,
  roomId: bigint | number | string,
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoomEscrow", "joinRoom", [BigInt(roomId)]);
}

export function prepareLeaveRoomTransaction(
  engine: FxBentoContractEngineConfig,
  roomId: bigint | number | string,
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoomEscrow", "leaveRoom", [BigInt(roomId)]);
}

export function prepareLockRoomTransaction(
  engine: FxBentoContractEngineConfig,
  roomId: bigint | number | string,
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoomEscrow", "lockRoom", [BigInt(roomId)]);
}

export function prepareRefundTransaction(
  engine: FxBentoContractEngineConfig,
  roomId: bigint | number | string,
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoomEscrow", "refund", [BigInt(roomId)]);
}

export function prepareStartRoundTransaction(
  engine: FxBentoContractEngineConfig,
  input: {
    roomId: bigint | number | string;
    roundIndex: number;
    startTime: bigint | number | string;
    endTime: bigint | number | string;
    lockTime: bigint | number | string;
    gridConfigHash: Hex;
  },
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoundManager", "startRound", [
    BigInt(input.roomId),
    input.roundIndex,
    BigInt(input.startTime),
    BigInt(input.endTime),
    BigInt(input.lockTime),
    Hex32Schema.parse(input.gridConfigHash),
  ]);
}

export function prepareRecordAnchorTransaction(
  engine: FxBentoContractEngineConfig,
  input: { roomId: bigint | number | string; roundIndex: number; price: bigint | number | string },
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoundManager", "recordAnchor", [
    BigInt(input.roomId),
    input.roundIndex,
    BigInt(input.price),
  ]);
}

export function prepareRecordSettlementTransaction(
  engine: FxBentoContractEngineConfig,
  input: { roomId: bigint | number | string; roundIndex: number },
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoundManager", "recordSettlement", [
    BigInt(input.roomId),
    input.roundIndex,
  ]);
}

export function prepareCommitSelectionTransaction(
  engine: FxBentoContractEngineConfig,
  input: { roomId: bigint | number | string; roundIndex: number; commitment: Hex },
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoCommitmentManager", "commitSelection", [
    BigInt(input.roomId),
    input.roundIndex,
    Hex32Schema.parse(input.commitment),
  ]);
}

export function prepareBatchedCommitSelectionTransaction(
  engine: FxBentoContractEngineConfig,
  input: {
    roomId: bigint | number | string;
    roundIndex: number;
    player: Address;
    commitment: Hex;
    signature: Hex;
  },
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoCommitmentManager", "commitSelectionFor", [
    BigInt(input.roomId),
    input.roundIndex,
    AddressSchema.parse(input.player),
    Hex32Schema.parse(input.commitment),
    HexSchema.parse(input.signature),
  ]);
}

export function prepareRevealSelectionTransaction(
  engine: FxBentoContractEngineConfig,
  input: {
    roomId: bigint | number | string;
    roundIndex: number;
    selection: z.input<typeof TileSelectionSchema>;
    nonce: Hex;
  },
): FxBentoTransactionRequest {
  const selection = TileSelectionSchema.parse(input.selection);
  assertValidTilePattern(selection.rows, selection.cols);
  return contractTransaction(engine, "FXBentoCommitmentManager", "revealSelection", [
    BigInt(input.roomId),
    input.roundIndex,
    selection,
    Hex32Schema.parse(input.nonce),
  ]);
}

export function prepareClaimPrizeTransaction(
  engine: FxBentoContractEngineConfig,
  input: { roomId: bigint | number | string; amount: bigint | number | string; proof: Hex[] },
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoRoomEscrow", "claimPrize", [
    BigInt(input.roomId),
    BigInt(input.amount),
    input.proof.map((proofItem) => Hex32Schema.parse(proofItem)),
  ]);
}

export function prepareSubmitResultsTransaction(
  engine: FxBentoContractEngineConfig,
  input: {
    roomId: bigint | number | string;
    resultsRoot?: Hex;
    metadataURI: string;
    payout: z.input<typeof SettlementPayoutRootSchema>;
    attestation?: Hex;
  },
): FxBentoTransactionRequest {
  const payout = SettlementPayoutRootSchema.parse({
    ...input.payout,
    winnerRoot: input.payout.winnerRoot ?? input.resultsRoot,
    metadataHash:
      input.payout.metadataHash ?? keccak256(new TextEncoder().encode(input.metadataURI)),
  });
  return contractTransaction(engine, "FXBentoSettlementManager", "submitResults", [
    BigInt(input.roomId),
    {
      roomId: BigInt(input.roomId),
      winnerRoot: payout.winnerRoot,
      rosterHash: payout.rosterHash,
      leaderboardHash: payout.leaderboardHash,
      scoreRoot: payout.scoreRoot,
      settlementPriceRoot: payout.settlementPriceRoot,
      payoutTotal: payout.payoutTotal,
      protocolFee: payout.protocolFee,
      metadataHash: payout.metadataHash,
    },
    input.metadataURI,
    input.attestation ?? "0x",
  ]);
}

export function prepareFinalizeResultsTransaction(
  engine: FxBentoContractEngineConfig,
  roomId: bigint | number | string,
): FxBentoTransactionRequest {
  return contractTransaction(engine, "FXBentoSettlementManager", "finalizeResults", [
    BigInt(roomId),
  ]);
}

// ---------- commitment hashing ----------

export function buildSelectedTilesHash(
  selectionInput: z.input<typeof TileSelectionSchema>,
): Hex {
  const selection = TileSelectionSchema.parse(selectionInput);
  return keccak256(
    encodeAbiParameters(
      [
        { name: "rows", type: "uint8[]" },
        { name: "cols", type: "uint8[]" },
        { name: "chipCount", type: "uint8" },
        { name: "clientStateHash", type: "bytes32" },
      ],
      [selection.rows, selection.cols, selection.chipCount, selection.clientStateHash],
    ),
  );
}

export function buildSelectionCommitment(input: {
  chainId: number;
  roomId: bigint | number | string;
  roundIndex: number;
  player: Address;
  selectedTilesHash: Hex;
  nonce: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { name: "chainId", type: "uint256" },
        { name: "roomId", type: "uint256" },
        { name: "roundIndex", type: "uint16" },
        { name: "player", type: "address" },
        { name: "selectedTilesHash", type: "bytes32" },
        { name: "nonce", type: "bytes32" },
      ],
      [
        BigInt(input.chainId),
        BigInt(input.roomId),
        input.roundIndex,
        AddressSchema.parse(input.player),
        Hex32Schema.parse(input.selectedTilesHash),
        Hex32Schema.parse(input.nonce),
      ],
    ),
  );
}

// ---------- settlement merkle tree ----------

export function buildPrizeLeaf(input: z.input<typeof PrizeAllocationSchema>): Hex {
  const allocation = PrizeAllocationSchema.parse(input);
  return keccak256(
    encodeAbiParameters(
      [
        { name: "roomId", type: "uint256" },
        { name: "player", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      [allocation.roomId, allocation.player, allocation.amount],
    ),
  );
}

export function buildSettlementResultTree(
  roomIdInput: bigint | number | string,
  allocationsInput: Array<z.input<typeof PrizeAllocationSchema>>,
  escrowedAmount?: bigint | number | string,
  protocolFee: bigint | number | string = 0n,
): SettlementResultTree {
  const roomId = BigInt(roomIdInput);
  const allocations: PrizeAllocation[] = allocationsInput
    .map((item) => PrizeAllocationSchema.parse({ ...item, roomId }))
    .sort((a, b) => a.player.toLowerCase().localeCompare(b.player.toLowerCase()));
  const leaves = allocations.map((allocation) => buildPrizeLeaf(allocation));
  const root = buildMerkleRoot(leaves);
  const proofs = leaves.map((_, index) => buildMerkleProof(leaves, index));
  const totalPrizePayouts = allocations.reduce((total, allocation) => total + allocation.amount, 0n);
  if (
    escrowedAmount !== undefined &&
    totalPrizePayouts + BigInt(protocolFee) > BigInt(escrowedAmount)
  ) {
    throw new Error("payout_exceeds_escrow");
  }
  return {
    roomId,
    root,
    totalPrizePayouts,
    allocations: allocations.map((allocation, index) => ({
      roomId,
      player: allocation.player,
      amount: allocation.amount,
      score: allocation.score,
      rank: allocation.rank,
      leaf: leaves[index] ?? (`0x${"00".repeat(32)}` as Hex),
      proof: proofs[index] ?? [],
    })),
  };
}

export function buildSettlementEvidence(
  input: z.input<typeof SettlementEvidenceSchema>,
): SettlementEvidence {
  const evidence = SettlementEvidenceSchema.parse(input);
  const payoutTotal = evidence.allocations.reduce(
    (total, allocation) => total + allocation.amount,
    0n,
  );
  if (payoutTotal !== evidence.totalPrizePayouts) {
    throw new Error("settlement_evidence_payout_mismatch");
  }
  return evidence;
}

// ---------- serialization + simulation helpers ----------

export function serializeTransactionRequest(request: FxBentoTransactionRequest) {
  return normalizeForJson(request) as Omit<FxBentoTransactionRequest, "args" | "value"> & {
    args: unknown[];
    value: string;
  };
}

export function createFxBentoPublicClient(args: {
  chainId: number;
  rpcUrl: string;
}): FxBentoSimulationClient {
  return createPublicClient({
    chain: defineChain({
      id: args.chainId,
      name: `fx-bento-${args.chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [args.rpcUrl] } },
    }),
    transport: http(args.rpcUrl),
  }) as unknown as FxBentoSimulationClient;
}

export async function simulateFxBentoTransaction(
  request: FxBentoTransactionRequest,
  options: { client?: FxBentoSimulationClient; account?: Address } = {},
): Promise<FxBentoSafetyCheck["simulation"]> {
  if (!options.client) return { status: "skipped", reason: "rpc_not_configured" };
  const result = await options.client.simulateContract({
    account: options.account,
    address: request.to,
    abi: BENTO_ABIS[request.contractName],
    functionName: request.functionName,
    args: request.args,
    value: BigInt(request.value),
  });
  return { status: "passed", result: normalizeForJson(result.result) };
}

export async function reconcileFxBentoRoomState(args: {
  engine: FxBentoContractEngineConfig;
  roomId?: bigint | number | string;
  functionName: string;
  indexedRoom?: FxBentoIndexedRoomSummary | null;
  client?: FxBentoSimulationClient;
}): Promise<FxBentoSafetyCheck["reconciliation"]> {
  const expectedStatuses = expectedStatusesForAction(args.functionName);
  if (!args.roomId || expectedStatuses.length === 0) {
    return { status: "skipped", reason: "no_room_reconciliation_required" };
  }
  const indexedStatus = args.indexedRoom?.status ?? null;
  if (indexedStatus && !expectedStatuses.includes(indexedStatus)) {
    throw new Error("indexed_room_state_mismatch");
  }
  if (!args.client) {
    return { status: "skipped", reason: "rpc_not_configured", indexedStatus };
  }
  const factory = resolveAddress(args.engine, "FXBentoRoomFactory");
  if (!factory) throw new Error("missing_contract_address:FXBentoRoomFactory");
  const room = await args.client.readContract({
    address: factory,
    abi: BENTO_ABIS.FXBentoRoomFactory,
    functionName: "getRoom",
    args: [BigInt(args.roomId)],
  });
  const contractStatus = contractRoomStatus(room);
  if (contractStatus && !expectedStatuses.includes(contractStatus)) {
    throw new Error("contract_room_state_mismatch");
  }
  return { status: "passed", indexedStatus, contractStatus };
}

export async function safetyCheckFxBentoTransaction(args: {
  engine: FxBentoContractEngineConfig;
  request: FxBentoTransactionRequest;
  roomId?: bigint | number | string;
  indexedRoom?: FxBentoIndexedRoomSummary | null;
  client?: FxBentoSimulationClient;
  account?: Address;
}): Promise<FxBentoSafetyCheck> {
  const reconciliation = await reconcileFxBentoRoomState({
    engine: args.engine,
    roomId: args.roomId,
    functionName: args.request.functionName,
    indexedRoom: args.indexedRoom,
    client: args.client,
  });
  const simulation = await simulateFxBentoTransaction(args.request, {
    client: args.client,
    account: args.account,
  });
  return { simulation, reconciliation };
}

// ---------- internals ----------

function contractTransaction(
  engine: FxBentoContractEngineConfig,
  contractName: BentoContractName,
  functionName: string,
  args: unknown[],
): FxBentoTransactionRequest {
  const to = resolveAddress(engine, contractName);
  if (!to) throw new Error(`missing_contract_address:${contractName}`);
  const abi = BENTO_ABIS[contractName];
  const data = encodeFunctionData({
    abi: abi as Abi,
    functionName,
    args,
  } as never);
  return {
    contractName,
    to,
    functionName,
    args,
    data,
    value: "0",
    chainId: engine.chainId,
  };
}

function resolveAddress(
  engine: FxBentoContractEngineConfig,
  name: BentoContractName,
): Address | null {
  const addresses = engine.addresses;
  if (addresses) {
    if (String(engine.chainId) in (addresses as BentoChainContractAddresses)) {
      const byChain = (addresses as BentoChainContractAddresses)[String(engine.chainId)];
      if (byChain?.[name]) return byChain[name] ?? null;
    }
    const flat = (addresses as BentoContractAddresses)[name];
    if (flat) return flat;
  }
  return getBentoAddress(engine.chainId, name);
}

function expectedStatusesForAction(functionName: string): string[] {
  switch (functionName) {
    case "joinRoom":
    case "leaveRoom":
      return ["lobby"];
    case "lockRoom":
      return ["lobby", "active"];
    case "refund":
      return ["cancelled"];
    case "startRound":
    case "recordAnchor":
    case "recordSettlement":
      return ["active"];
    case "commitSelection":
    case "commitSelectionFor":
    case "revealSelection":
    case "submitResults":
      return ["active", "settling"];
    case "claimPrize":
      return ["settling", "settled"];
    case "finalizeResults":
      return ["active", "settling", "settled"];
    default:
      return [];
  }
}

function contractRoomStatus(value: unknown): string | null {
  const statusId = Array.isArray(value)
    ? Number(value[14])
    : value && typeof value === "object" && "status" in value
      ? Number((value as { status?: unknown }).status)
      : Number.NaN;
  return (
    ({
      0: "lobby",
      1: "active",
      2: "settling",
      3: "settled",
      4: "cancelled",
    } as Record<number, string>)[statusId] ?? null
  );
}

function buildMerkleRoot(leaves: Hex[]): Hex {
  if (leaves.length === 0) return `0x${"00".repeat(32)}` as Hex;
  let level = [...leaves].sort(compareHex);
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1] ?? left;
      next.push(hashPair(left, right));
    }
    level = next;
  }
  return level[0] ?? (`0x${"00".repeat(32)}` as Hex);
}

function buildMerkleProof(leaves: Hex[], leafIndex: number): Hex[] {
  if (leaves.length <= 1) return [];
  let level = leaves
    .map((leaf, index) => ({ leaf, originalIndex: index }))
    .sort((a, b) => compareHex(a.leaf, b.leaf));
  let index = level.findIndex((item) => item.originalIndex === leafIndex);
  const proof: Hex[] = [];
  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    proof.push(
      (level[siblingIndex] ?? level[index])?.leaf ?? (`0x${"00".repeat(32)}` as Hex),
    );
    const next: Array<{ leaf: Hex; originalIndex: number }> = [];
    for (let cursor = 0; cursor < level.length; cursor += 2) {
      const left = level[cursor];
      const right = level[cursor + 1] ?? left;
      if (!left || !right) continue;
      next.push({ leaf: hashPair(left.leaf, right.leaf), originalIndex: left.originalIndex });
    }
    index = Math.floor(index / 2);
    level = next;
  }
  return proof;
}

function hashPair(a: Hex, b: Hex): Hex {
  const [left, right] = compareHex(a, b) <= 0 ? [a, b] : [b, a];
  return keccak256(concat([left, right]));
}

function compareHex(a: Hex, b: Hex): number {
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeForJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizeForJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeForJson(item)]),
    );
  }
  return value;
}
