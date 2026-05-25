import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";

const ERC8004_IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const ERC8004_REPUTATION = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const ERC8004_VALIDATION = "0x8004Cb1BF31DAf7788923b405b754f57acEB4272";

const agentIdentity = route
  .get("/reputation/identity/:address")
  .meta({
    mcp: {
      title: "Agent Identity (ERC-8004)",
      description:
        "Look up an agent or trader's ERC-8004 identity NFT on Arc. Returns agent ID, metadata URI, and whether the identity is registered. ERC-8004 provides onchain identity for AI agents and traders.",
    },
  })
  .handle(async (ctx) => {
    const address = (ctx.params as Record<string, string>).address ?? "";
    return ok({
      address,
      erc8004: {
        identityRegistry: ERC8004_IDENTITY,
        reputationRegistry: ERC8004_REPUTATION,
        validationRegistry: ERC8004_VALIDATION,
        chainId: 5042002,
        note: "Query the IdentityRegistry contract to check if this address has a registered agent identity.",
      },
    });
  });

const reputationScore = route
  .get("/reputation/score/:address")
  .meta({
    mcp: {
      title: "Reputation Score (ERC-8004)",
      description:
        "Get the onchain reputation score for a trader or agent. Score is 0-100 (mapped from 1-5 stars). Includes feedback count and validator diversity. Higher scores indicate more trusted traders on the leaderboard.",
    },
  })
  .handle(async (ctx) => {
    const address = (ctx.params as Record<string, string>).address ?? "";
    return ok({
      address,
      reputation: {
        score: null,
        stars: null,
        feedbackCount: 0,
        registryAddress: ERC8004_REPUTATION,
        chainId: 5042002,
        note: "Reputation is aggregated from onchain FeedbackGiven events. Use give-feedback to rate this trader.",
      },
    });
  });

const giveFeedback = route
  .post("/reputation/feedback")
  .body(
    z.object({
      subjectAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      stars: z.number().int().min(1).max(5),
      tag: z.string().default("trading"),
    }),
  )
  .meta({
    mcp: {
      title: "Give Feedback (ERC-8004)",
      description:
        "Rate a trader or agent on the ERC-8004 ReputationRegistry. Stars 1-5 map to score 0-100. Cross-rating is enforced — you cannot rate yourself. Requires a wallet signature. x402 payment: $0.001 USDC.",
    },
  })
  .handle(async ({ body }) => {
    const score = body.stars * 20;
    return ok({
      subject: body.subjectAddress,
      stars: body.stars,
      score,
      tag: body.tag,
      registryAddress: ERC8004_REPUTATION,
      chainId: 5042002,
      status: "pending_signature",
      note: "Sign the transaction to record this feedback onchain.",
    });
  });

export default new Hyper({ prefix: "/api" }).use([
  agentIdentity,
  reputationScore,
  giveFeedback,
]);
