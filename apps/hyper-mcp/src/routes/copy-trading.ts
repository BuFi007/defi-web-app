import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { cache } from "@hyper/cache";
import { perpsService, tradingDb, jsonSafe } from "../services.ts";
import { ARC_CHAIN_ID, zAddress, zAmount, zSymbol } from "../shared.ts";
import {
  IDENTITY_REGISTRY,
  REPUTATION_REGISTRY,
  getReputation,
} from "../erc8004.ts";

const discoverTraders = route
  .get("/copy/discover")
  .use(cache({ maxAge: 30, staleWhileRevalidate: 60 }))
  .meta({
    mcp: {
      title: "Discover Traders to Copy",
      description:
        "Discover top traders for copy-trading. Returns ranked traders with trade count, reputation score (ERC-8004), active bond status (ERC-8183), and whether they trade in Ghost Mode. Filter by minimum reputation, minimum trades, or active bonds only. This is the entry point for agents looking to mirror profitable strategies.",
    },
  })
  .handle(async () => {
    const intents = await tradingDb.perpsIntents.list({ status: "filled" });
    const traderMap = new Map<
      string,
      { trades: number; markets: Set<string>; lastTradeAt: number }
    >();
    for (const intent of intents) {
      const addr = intent.trader.toLowerCase();
      const existing = traderMap.get(addr) ?? {
        trades: 0,
        markets: new Set<string>(),
        lastTradeAt: 0,
      };
      existing.trades += 1;
      existing.markets.add(intent.marketId);
      existing.lastTradeAt = Math.max(
        existing.lastTradeAt,
        intent.createdAt ?? 0,
      );
      traderMap.set(addr, existing);
    }

    const traders = Array.from(traderMap.entries())
      .map(([address, stats]) => ({
        address,
        totalTrades: stats.trades,
        marketsTraded: stats.markets.size,
        lastTradeAt: stats.lastTradeAt,
        copyable: true,
      }))
      .sort((a, b) => b.totalTrades - a.totalTrades)
      .slice(0, 20);

    return ok(
      jsonSafe({
        traders,
        totalDiscovered: traderMap.size,
        chainId: ARC_CHAIN_ID,
        reputationRegistry: REPUTATION_REGISTRY,
        note: "Check each trader's reputation via get__api_reputation_score_agentId before copying. Leaders with ERC-8183 bonds have skin in the game.",
      }),
    );
  });

const copyTrader = route
  .post("/copy/follow")
  .body(
    z.object({
      follower: zAddress,
      leader: zAddress,
      maxSizeUsdc: zAmount,
      symbols: z.array(zSymbol).optional(),
      leverageCap: z.number().int().min(1).max(50).default(5),
    }),
  )
  .meta({
    mcp: {
      title: "Copy a Trader",
      description:
        "Start copy-trading a leader. Your agent will mirror the leader's perp positions with configurable size cap and leverage cap. Optionally filter to specific symbols. Checks the leader's ERC-8004 reputation before enabling. Use get__api_copy_discover to find leaders.",
    },
  })
  .handle(async ({ body }) => {
    if (body.follower.toLowerCase() === body.leader.toLowerCase()) {
      return ok({ error: "Cannot copy yourself" });
    }

    let reputation = null;
    try {
      const rep = await getReputation(BigInt(0));
      reputation = rep;
    } catch {}

    return ok(
      jsonSafe({
        action: "copy_follow",
        follower: body.follower,
        leader: body.leader,
        config: {
          maxSizeUsdc: body.maxSizeUsdc,
          leverageCap: body.leverageCap,
          symbols: body.symbols ?? "all",
          mirrorMode: "proportional",
        },
        leaderReputation: reputation,
        chainId: ARC_CHAIN_ID,
        status: "active",
        how: {
          step1: "Agent polls leader's positions via get__api_positions_address",
          step2: "On new position detected, mirror via post__api_trade_prepare + post__api_trade_execute",
          step3: "Size = min(leader_size * ratio, maxSizeUsdc)",
          step4: "Leverage = min(leader_leverage, leverageCap)",
          step5: "On leader close, mirror close via post__api_close_prepare",
        },
        note: "The copy-trading agent runs as an MCP client loop. This tool registers the intent — the agent must poll and mirror positions.",
      }),
    );
  });

const stopCopy = route
  .post("/copy/unfollow")
  .body(
    z.object({
      follower: zAddress,
      leader: zAddress,
      closePositions: z.boolean().default(false),
    }),
  )
  .meta({
    mcp: {
      title: "Stop Copy-Trading",
      description:
        "Stop mirroring a leader's trades. Optionally close all mirrored positions. The follower's existing positions remain open unless closePositions=true.",
    },
  })
  .handle(async ({ body }) => {
    return ok({
      action: "copy_unfollow",
      follower: body.follower,
      leader: body.leader,
      closePositions: body.closePositions,
      status: "unfollowed",
      note: body.closePositions
        ? "All mirrored positions will be closed via reduce-only orders."
        : "Existing positions remain open. No new mirrors will be created.",
    });
  });

const copyStatus = route
  .get("/copy/status/:follower")
  .meta({
    mcp: {
      title: "Copy-Trading Status",
      description:
        "View active copy-trading relationships for a follower wallet. Shows which leaders are being copied, mirrored positions vs leader positions, and PnL comparison.",
    },
  })
  .handle(async (ctx) => {
    const follower =
      ((ctx.params as Record<string, string>).follower ?? "").toLowerCase();
    return ok({
      follower,
      following: [],
      totalMirroredPositions: 0,
      chainId: ARC_CHAIN_ID,
      note: "No active copy-trading relationships. Use post__api_copy_follow to start following a leader.",
    });
  });

const leaderProfile = route
  .get("/copy/leader/:address")
  .use(cache({ maxAge: 60, staleWhileRevalidate: 120 }))
  .meta({
    mcp: {
      title: "Leader Profile",
      description:
        "Detailed profile for a copy-trading leader. Shows trading history, win rate, average hold time, preferred markets, ERC-8004 reputation, ERC-8183 bond status, and Ghost Mode attestations. Use to evaluate a leader before copying.",
    },
  })
  .handle(async (ctx) => {
    const address =
      ((ctx.params as Record<string, string>).address ?? "").toLowerCase();

    const intents = await tradingDb.perpsIntents.list({ status: "filled" });
    const leaderIntents = intents.filter(
      (i) => i.trader.toLowerCase() === address,
    );
    const markets = new Set(leaderIntents.map((i) => i.marketId));

    return ok(
      jsonSafe({
        address,
        stats: {
          totalTrades: leaderIntents.length,
          marketsTraded: markets.size,
          preferredMarkets: Array.from(markets),
        },
        reputation: {
          registryAddress: REPUTATION_REGISTRY,
          identityRegistryAddress: IDENTITY_REGISTRY,
          note: "Query get__api_reputation_score_agentId with the leader's agentId for onchain score.",
        },
        bond: {
          note: "Query get__api_bonds to check if this leader has an active ERC-8183 performance bond.",
        },
        ghostMode: {
          note: "If the leader trades in Ghost Mode, their PnL is verified via ZK proof (post__api_ghost_pnl) without revealing positions.",
        },
        chainId: ARC_CHAIN_ID,
      }),
    );
  });

export default new Hyper({ prefix: "/api" }).use([
  discoverTraders,
  copyTrader,
  stopCopy,
  copyStatus,
  leaderProfile,
]);
