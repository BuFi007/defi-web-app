import { createPublicClient, http, fallback, parseAbiItem, type Address } from "viem";

/**
 * ERC-8004 (Trustless Agents) read client for the Kawaii agent-badge.
 *
 * The identity + reputation registries are ALREADY deployed on Arc Testnet and
 * already wired into apps/hyper-mcp (agents self-register via the MCP
 * `reputation/register` tool, which returns `register(string)` calldata so the
 * agent OWNS its identity). This module is the apps/web read side: given an
 * agent's ERC-8004 `agentId`, verify ownership + read reputation so the Kawaii
 * mint can attach the "agent badge" to an agentic Punk. We never mint identities
 * here (that would make our server the owner) — we only verify + link.
 *
 * Contracts (Arc Testnet 5042002) — mirror apps/hyper-mcp/src/erc8004.ts:
 *   IdentityRegistry   0x8004A818BFB912233c491871b3d84c89A494BD9e
 *   ReputationRegistry 0x8004B663056A597Dffe9eCcC1965A193B7388713
 *   ValidationRegistry 0x8004Cb1BF31DAf7788923b405b754f57acEB4272
 */
export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;
export const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address;

const ARC_PRIMARY = process.env.ARC_RPC_URL || "https://rpc.drpc.testnet.arc.network";
const ARC_FALLBACK = process.env.ARC_TESTNET_RPC_FALLBACK || "https://rpc.testnet.arc.network";

const arcClient = createPublicClient({
  transport: fallback([http(ARC_PRIMARY), http(ARC_FALLBACK)]),
});

const IDENTITY_ABI = [
  parseAbiItem("function ownerOf(uint256 tokenId) view returns (address)"),
  parseAbiItem("function tokenURI(uint256 tokenId) view returns (string)"),
  parseAbiItem("function balanceOf(address owner) view returns (uint256)"),
] as const;

const FEEDBACK_EVENT = parseAbiItem(
  "event FeedbackGiven(uint256 indexed subjectId, uint256 indexed fromId, int128 score, string tag)",
);

/** Does this wallet hold any ERC-8004 identity NFT? (cheap pre-check) */
export async function hasIdentity(address: Address): Promise<boolean> {
  try {
    const balance = await arcClient.readContract({ address: IDENTITY_REGISTRY, abi: IDENTITY_ABI, functionName: "balanceOf", args: [address] });
    return balance > 0n;
  } catch {
    return false;
  }
}

/** Owner of an agentId — used to VERIFY a minter actually controls the identity
 *  they claim before we attach the badge to their Punk. */
export async function ownerOfAgent(agentId: bigint): Promise<Address | null> {
  try {
    return (await arcClient.readContract({ address: IDENTITY_REGISTRY, abi: IDENTITY_ABI, functionName: "ownerOf", args: [agentId] })) as Address;
  } catch {
    return null;
  }
}

export interface ReputationSummary {
  averageScore: number | null;
  feedbackCount: number;
  scores: number[];
}

/** Aggregate ERC-8004 reputation for an agentId from FeedbackGiven events. */
export async function getReputation(agentId: bigint): Promise<ReputationSummary> {
  try {
    const currentBlock = await arcClient.getBlockNumber();
    const fromBlock = currentBlock > 150_000n ? currentBlock - 150_000n : 0n;
    const logs = await arcClient.getLogs({ address: REPUTATION_REGISTRY, event: FEEDBACK_EVENT, args: { subjectId: agentId }, fromBlock, toBlock: currentBlock });
    if (logs.length === 0) return { averageScore: null, feedbackCount: 0, scores: [] };
    const scores = logs.map((l) => Number(l.args.score ?? 0));
    return { averageScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), feedbackCount: scores.length, scores };
  } catch {
    return { averageScore: null, feedbackCount: 0, scores: [] };
  }
}

/**
 * Verify + resolve an agent's badge: confirm `wallet` owns `agentId`, then read
 * its reputation. Returns null if ownership doesn't match (so a Punk can't claim
 * a badge it doesn't control).
 */
export async function resolveAgentBadge(
  wallet: string,
  agentId: bigint,
): Promise<{ agentId: string; reputation: ReputationSummary } | null> {
  const owner = await ownerOfAgent(agentId);
  if (!owner || owner.toLowerCase() !== wallet.toLowerCase()) return null;
  const reputation = await getReputation(agentId);
  return { agentId: agentId.toString(), reputation };
}
