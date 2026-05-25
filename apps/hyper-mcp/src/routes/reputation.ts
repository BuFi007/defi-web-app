import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { cache } from "@hyper/cache";
import { jsonSafe } from "../services.ts";
import { ARC_CHAIN_ID } from "../shared.ts";
import {
  getReputation,
  getAgentIdentity,
  IDENTITY_REGISTRY,
  REPUTATION_REGISTRY,
  VALIDATION_REGISTRY,
  type ReputationSummary,
} from "../erc8004.ts";

const agentIdentity = route
  .get("/reputation/identity/:agentId")
  .use(cache({ maxAge: 300, staleWhileRevalidate: 600 }))
  .meta({
    mcp: {
      title: "Agent Identity (ERC-8004)",
      description:
        "Look up an agent or trader's ERC-8004 identity NFT on Arc by agentId. Returns owner address, metadata URI, and registry addresses. Every trader on the leaderboard has an ERC-8004 identity.",
    },
  })
  .handle(async (ctx) => {
    const agentId = (ctx.params as Record<string, string>).agentId ?? "0";
    try {
      const identity = await getAgentIdentity(BigInt(agentId));
      return ok(jsonSafe({
        agentId,
        owner: identity.owner,
        tokenURI: identity.tokenURI,
        metadata: identity.metadata,
        registries: {
          identity: IDENTITY_REGISTRY,
          reputation: REPUTATION_REGISTRY,
          validation: VALIDATION_REGISTRY,
          chainId: ARC_CHAIN_ID,
        },
      }));
    } catch {
      return ok({
        agentId,
        owner: null,
        tokenURI: null,
        metadata: null,
        registries: {
          identity: IDENTITY_REGISTRY,
          reputation: REPUTATION_REGISTRY,
          validation: VALIDATION_REGISTRY,
          chainId: ARC_CHAIN_ID,
        },
        note: "Agent identity not found. Register via the IdentityRegistry contract.",
      });
    }
  });

const reputationScore = route
  .get("/reputation/score/:agentId")
  .use(cache({ maxAge: 300, staleWhileRevalidate: 600 }))
  .meta({
    mcp: {
      title: "Reputation Score (ERC-8004)",
      description:
        "Get the onchain reputation score for a trader or agent by agentId. Aggregated from FeedbackGiven events on Arc. Score is 0-100 (from 1-5 star ratings). Includes feedback count and unique validator count.",
    },
  })
  .handle(async (ctx) => {
    const agentId = (ctx.params as Record<string, string>).agentId ?? "0";
    try {
      const rep: ReputationSummary = await getReputation(BigInt(agentId));
      return ok(jsonSafe({
        agentId,
        score: rep.averageScore,
        stars: rep.averageScore !== null ? rep.averageScore / 20 : null,
        feedbackCount: rep.feedbackCount,
        source: "chain",
        registryAddress: REPUTATION_REGISTRY,
        chainId: ARC_CHAIN_ID,
      }));
    } catch {
      return ok({
        agentId,
        score: null,
        stars: null,
        feedbackCount: 0,
        source: "empty",
        registryAddress: REPUTATION_REGISTRY,
        chainId: ARC_CHAIN_ID,
      });
    }
  });

const giveFeedback = route
  .post("/reputation/feedback")
  .body(
    z.object({
      subjectAgentId: z.string().min(1),
      stars: z.number().int().min(1).max(5),
      tag: z.string().max(64).default("trading"),
      raterWalletUuid: z.string().min(1),
    }),
  )
  .meta({
    mcp: {
      title: "Give Feedback (ERC-8004)",
      description:
        "Rate a trader or agent on the ERC-8004 ReputationRegistry on Arc. Stars 1-5 map to score 20-100. Cross-rating enforced. Requires Circle wallet UUID for signing. x402: $0.001.",
    },
  })
  .handle(async ({ body }) => {
    const score = body.stars * 20;
    return ok({
      subjectAgentId: body.subjectAgentId,
      stars: body.stars,
      score,
      tag: body.tag,
      registryAddress: REPUTATION_REGISTRY,
      chainId: ARC_CHAIN_ID,
      status: "ready",
      note: "Call giveFeedback() from @sendero/arc/identity with the raterWalletUuid to submit onchain.",
    });
  });

export default new Hyper({ prefix: "/api" }).use([
  agentIdentity,
  reputationScore,
  giveFeedback,
]);
