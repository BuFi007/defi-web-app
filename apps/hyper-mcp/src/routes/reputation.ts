import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { cache } from "@hyper/cache";
import { jsonSafe } from "../services.ts";
import { ARC_CHAIN_ID } from "../shared.ts";
import {
  getReputation,
  getAgentIdentity,
  hasIdentity,
  buildRegisterCalldata,
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

const registerIdentity = route
  .post("/reputation/register")
  .body(
    z.object({
      address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      name: z.string().max(64).optional(),
      type: z.enum(["agent", "human"]).default("agent"),
      source: z.string().max(32).default("mcp"),
    }),
  )
  .meta({
    mcp: {
      title: "Register Identity (ERC-8004)",
      description:
        "Register an onchain ERC-8004 identity NFT for a trader or agent on Arc. Every trader on the leaderboard needs an identity. Call this before trading to establish your onchain reputation. Returns the contract call to execute. If already registered, returns the existing identity.",
    },
  })
  .handle(async ({ body }) => {
    const already = await hasIdentity(body.address as `0x${string}`);
    if (already) {
      return ok({
        address: body.address,
        registered: true,
        registryAddress: IDENTITY_REGISTRY,
        chainId: ARC_CHAIN_ID,
        note: "Identity already registered. Use bufi_reputation_score to check your score.",
      });
    }

    const metadata = JSON.stringify({
      name: body.name ?? `Trader-${body.address.slice(0, 8)}`,
      type: body.type,
      source: body.source,
      registeredAt: new Date().toISOString(),
      platform: "bufi-hyper",
    });

    const calldata = buildRegisterCalldata(metadata);

    return ok({
      address: body.address,
      registered: false,
      action: "register",
      contract: {
        to: calldata.to,
        function: calldata.functionSignature,
        args: calldata.args,
      },
      metadata: JSON.parse(metadata),
      chainId: ARC_CHAIN_ID,
      note: "Submit this contract call to mint your ERC-8004 identity NFT. After minting, you appear on the leaderboard and can receive reputation feedback.",
    });
  });

const checkIdentity = route
  .get("/reputation/check/:address")
  .meta({
    mcp: {
      title: "Check Identity Status",
      description:
        "Check whether a wallet address has an ERC-8004 identity NFT registered on Arc. Returns true/false. Use before trading to determine if registration is needed.",
    },
  })
  .handle(async (ctx) => {
    const address = ((ctx.params as Record<string, string>).address ?? "") as `0x${string}`;
    const registered = await hasIdentity(address);
    return ok({
      address,
      registered,
      registryAddress: IDENTITY_REGISTRY,
      chainId: ARC_CHAIN_ID,
    });
  });

export default new Hyper({ prefix: "/api" }).use([
  agentIdentity,
  reputationScore,
  giveFeedback,
  registerIdentity,
  checkIdentity,
]);
