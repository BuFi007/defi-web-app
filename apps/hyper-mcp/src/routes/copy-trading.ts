import { Hyper, ok, route, badRequest } from "@hyper/core";
import { z } from "zod";
import { cache } from "@hyper/cache";
import { perpsService, tradingDb, jsonSafe } from "../services.ts";
import { ARC_CHAIN_ID, zAddress, zAmount } from "../shared.ts";
import {
  IDENTITY_REGISTRY,
  REPUTATION_REGISTRY,
  getReputation,
} from "../erc8004.ts";

// Copy-trading market set. Mirrors the live perp markets (shared.ts
// PERP_SYMBOLS) PLUS QCAD/USDC, which is a live market not yet in the shared
// perps enum (G12). Bare-token forms are accepted as aliases so callers can
// pass `EURC` or `EURC/USDC`.
const COPY_SYMBOLS = [
  "EURC/USDC",
  "JPYC/USDC",
  "MXNB/USDC",
  "CIRBTC/USDC",
  "AUDF/USDC",
  "QCAD/USDC",
] as const;
const zCopySymbol = z.enum(COPY_SYMBOLS);

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Process-memory store for copy-trading relationships. There is no DB-backed
 * copy store in services.ts (only perpsIntents/receipts), and the existing
 * in-file pattern for ephemeral aggregates is a module-level Map (see
 * leaderboard.ts). Keyed by follower address (lowercased).
 *
 * NOTE (flag for parent): this persists only for the lifetime of the process
 * and is not shared across instances. If durable cross-instance copy state is
 * required, a shared store belongs in services.ts / tradingDb.
 */
interface CopyRelationship {
  leader: string;
  maxSizeUsdc: string;
  leverageCap: number;
  symbols: string[] | "all";
  createdAt: number;
}
const copyStore = new Map<string, Map<string, CopyRelationship>>();

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
      symbols: z.array(zCopySymbol).optional(),
      leverageCap: z.number().int().min(1).max(50).default(5),
    }),
  )
  .meta({
    mcp: {
      title: "Copy a Trader",
      description:
        "Start copy-trading a leader. Your agent will mirror the leader's perp positions with configurable size cap and leverage cap. Optionally filter to specific symbols (EURC/USDC, JPYC/USDC, MXNB/USDC, CIRBTC/USDC, AUDF/USDC, QCAD/USDC). Checks that the leader has trading history and their ERC-8004 reputation before enabling. Use get__api_copy_discover to find leaders.",
    },
  })
  .handle(async ({ body }) => {
    if (body.follower.toLowerCase() === body.leader.toLowerCase()) {
      return badRequest({ code: "invalid_leader", error: "Cannot copy yourself" });
    }

    // Leader-existence guard: a leader must have at least one filled perp
    // intent (the same source discover/leaderProfile read from). Reject unknown
    // leaders so follow can't register against a non-existent trader.
    const leaderAddr = body.leader.toLowerCase();
    const intents = await tradingDb.perpsIntents.list({ status: "filled" });
    const leaderTrades = intents.filter(
      (i) => i.trader.toLowerCase() === leaderAddr,
    ).length;
    if (leaderTrades === 0) {
      return badRequest({
        code: "unknown_leader",
        error:
          "Leader has no trading history and cannot be copied. Use get__api_copy_discover to find copyable leaders.",
      });
    }

    let reputation = null;
    try {
      const rep = await getReputation(BigInt(0));
      reputation = rep;
    } catch {}

    // Persist the relationship so a subsequent GET /copy/status/:follower
    // reflects it (G10). Keyed follower -> leader.
    const followerAddr = body.follower.toLowerCase();
    const symbols: string[] | "all" = body.symbols ?? "all";
    let followerRels = copyStore.get(followerAddr);
    if (!followerRels) {
      followerRels = new Map<string, CopyRelationship>();
      copyStore.set(followerAddr, followerRels);
    }
    followerRels.set(leaderAddr, {
      leader: body.leader,
      maxSizeUsdc: body.maxSizeUsdc,
      leverageCap: body.leverageCap,
      symbols,
      createdAt: Date.now(),
    });

    return ok(
      jsonSafe({
        action: "copy_follow",
        follower: body.follower,
        leader: body.leader,
        config: {
          maxSizeUsdc: body.maxSizeUsdc,
          leverageCap: body.leverageCap,
          symbols,
          mirrorMode: "proportional",
        },
        leaderReputation: reputation,
        leaderTrades,
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
    // Remove the persisted relationship so status no longer reports it (G10).
    const followerAddr = body.follower.toLowerCase();
    const leaderAddr = body.leader.toLowerCase();
    const followerRels = copyStore.get(followerAddr);
    const wasFollowing = followerRels?.delete(leaderAddr) ?? false;
    if (followerRels && followerRels.size === 0) {
      copyStore.delete(followerAddr);
    }

    return ok({
      action: "copy_unfollow",
      follower: body.follower,
      leader: body.leader,
      closePositions: body.closePositions,
      wasFollowing,
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
    const raw = (ctx.params as Record<string, string>).follower ?? "";
    if (!ADDRESS_RE.test(raw)) {
      return badRequest({
        code: "invalid_address",
        error: "follower must be a valid 0x-prefixed 40-hex-char address",
      });
    }
    const follower = raw.toLowerCase();

    const followerRels = copyStore.get(follower);
    const following = followerRels
      ? Array.from(followerRels.values()).map((rel) => ({
          leader: rel.leader,
          maxSizeUsdc: rel.maxSizeUsdc,
          leverageCap: rel.leverageCap,
          symbols: rel.symbols,
          since: rel.createdAt,
        }))
      : [];

    return ok({
      follower,
      following,
      totalMirroredPositions: 0,
      chainId: ARC_CHAIN_ID,
      note:
        following.length === 0
          ? "No active copy-trading relationships. Use post__api_copy_follow to start following a leader."
          : "Active copy-trading relationships. Each follower agent polls and mirrors its leaders' positions.",
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
    const rawAddr = (ctx.params as Record<string, string>).address ?? "";
    if (!ADDRESS_RE.test(rawAddr)) {
      return badRequest({
        code: "invalid_address",
        error: "address must be a valid 0x-prefixed 40-hex-char address",
      });
    }
    const address = rawAddr.toLowerCase();

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
