import { createPublicClient, http, fallback, type Address, type Hex, decodeEventLog, parseAbiItem } from "viem";

export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;
export const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address;
export const VALIDATION_REGISTRY = "0x8004Cb1BF31DAf7788923b405b754f57acEB4272" as Address;

const ARC_TESTNET_RPC = process.env.ARC_TESTNET_RPC ?? "https://rpc.drpc.testnet.arc.network";
const ARC_TESTNET_RPC_FALLBACK = process.env.ARC_TESTNET_RPC_FALLBACK ?? "https://rpc.testnet.arc.network";

const arcClient = createPublicClient({
  transport: fallback([http(ARC_TESTNET_RPC), http(ARC_TESTNET_RPC_FALLBACK)]),
});

const IDENTITY_ABI = [
  parseAbiItem("function ownerOf(uint256 tokenId) view returns (address)"),
  parseAbiItem("function tokenURI(uint256 tokenId) view returns (string)"),
  parseAbiItem("function balanceOf(address owner) view returns (uint256)"),
] as const;

export async function hasIdentity(address: Address): Promise<boolean> {
  try {
    const balance = await arcClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: IDENTITY_ABI,
      functionName: "balanceOf",
      args: [address],
    });
    return balance > 0n;
  } catch {
    return false;
  }
}

export function buildRegisterCalldata(metadataURI: string): {
  to: Address;
  functionSignature: string;
  args: [string];
} {
  return {
    to: IDENTITY_REGISTRY,
    functionSignature: "register(string)",
    args: [metadataURI],
  };
}

const FEEDBACK_EVENT = parseAbiItem(
  "event FeedbackGiven(uint256 indexed subjectId, uint256 indexed fromId, int128 score, string tag)",
);

export interface ReputationSummary {
  averageScore: number | null;
  feedbackCount: number;
  scores: number[];
}

export async function getAgentIdentity(agentId: bigint): Promise<{
  owner: Address;
  tokenURI: string;
  metadata: Record<string, unknown> | null;
}> {
  const [owner, tokenURI] = await Promise.all([
    arcClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: IDENTITY_ABI,
      functionName: "ownerOf",
      args: [agentId],
    }),
    arcClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: IDENTITY_ABI,
      functionName: "tokenURI",
      args: [agentId],
    }),
  ]);

  let metadata: Record<string, unknown> | null = null;
  if (tokenURI) {
    try {
      const res = await fetch(tokenURI);
      if (res.ok) metadata = await res.json() as Record<string, unknown>;
    } catch {}
  }

  return { owner, tokenURI, metadata };
}

export async function getReputation(agentId: bigint): Promise<ReputationSummary> {
  const currentBlock = await arcClient.getBlockNumber();
  const fromBlock = currentBlock > 150_000n ? currentBlock - 150_000n : 0n;
  const agentIdPadded = ("0x" + agentId.toString(16).padStart(64, "0")) as Hex;

  const logs = await arcClient.getLogs({
    address: REPUTATION_REGISTRY,
    event: FEEDBACK_EVENT,
    args: { subjectId: agentId },
    fromBlock,
    toBlock: currentBlock,
  });

  if (logs.length === 0) {
    return { averageScore: null, feedbackCount: 0, scores: [] };
  }

  const scores = logs.map((log) => Number(log.args.score ?? 0));
  const total = scores.reduce((a, b) => a + b, 0);
  return {
    averageScore: Math.round(total / scores.length),
    feedbackCount: scores.length,
    scores,
  };
}
