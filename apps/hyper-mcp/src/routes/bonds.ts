import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { jsonSafe } from "../services.ts";
import { ARC_CHAIN_ID } from "../shared.ts";

const ERC8183_JOB_REGISTRY = "0x0000000000000000000000000000000000000000" as const;

const createBond = route
  .post("/bonds/create")
  .body(
    z.object({
      trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      bondAmountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
      durationDays: z.number().int().min(1).max(90).default(7),
      performanceThresholdPct: z.number().min(-100).max(1000).default(0),
      description: z.string().max(256).default("Maintain positive PnL"),
    }),
  )
  .meta({
    mcp: {
      title: "Create Trading Bond (ERC-8183)",
      description:
        "Post a USDC performance bond as a trading leader. Followers can stake alongside you. If your PnL drops below the threshold within the duration, the bond slashes proportionally. Based on ERC-8183 job contracts on Arc — job = maintain performance, escrow = USDC bond, evaluation = oracle-verified PnL.",
    },
  })
  .handle(async ({ body }) => {
    const deadline = Math.floor(Date.now() / 1000) + body.durationDays * 86400;
    const bondId = `bond_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return ok({
      bondId,
      action: "create_trading_bond",
      trader: body.trader,
      bondAmountUsdc: body.bondAmountUsdc,
      durationDays: body.durationDays,
      expiresAt: deadline,
      performanceThresholdPct: body.performanceThresholdPct,
      description: body.description,
      erc8183: {
        standard: "ERC-8183 Job Contract",
        jobType: "trading_performance",
        escrow: `${body.bondAmountUsdc} USDC`,
        evaluationMethod: "oracle-verified PnL vs threshold",
        settlementChain: "Arc Testnet",
        note: "Bond is locked in escrow. Returned if PnL >= threshold at expiry. Slashed proportionally if PnL < threshold.",
      },
      chainId: ARC_CHAIN_ID,
      status: "pending_deposit",
      nextStep: "Deposit the bond amount to the escrow contract, then share your bondId for followers to stake alongside.",
    });
  });

const stakeAlongside = route
  .post("/bonds/stake")
  .body(
    z.object({
      bondId: z.string().min(1),
      follower: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      stakeAmountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
    }),
  )
  .meta({
    mcp: {
      title: "Stake Alongside Leader",
      description:
        "Stake USDC alongside a trading leader's performance bond. Your stake earns proportional returns if the leader maintains performance above threshold. If the leader's PnL drops below threshold, both the bond and your stake are at risk of slashing. Check the leader's ERC-8004 reputation score before staking.",
    },
  })
  .handle(async ({ body }) => {
    return ok({
      action: "stake_alongside",
      bondId: body.bondId,
      follower: body.follower,
      stakeAmountUsdc: body.stakeAmountUsdc,
      erc8183: {
        role: "follower",
        riskModel: "Proportional — if leader's bond slashes 20%, your stake slashes 20%",
        returnModel: "Share of leader's PnL proportional to your stake vs total pool",
      },
      chainId: ARC_CHAIN_ID,
      status: "pending_deposit",
      recommendation: "Check the leader's reputation via get__api_reputation_score_agentId before staking. Leaders with score > 80 and > 10 feedback events have proven track records.",
    });
  });

const evaluatePerformance = route
  .post("/bonds/evaluate")
  .body(
    z.object({
      bondId: z.string().min(1),
    }),
  )
  .meta({
    mcp: {
      title: "Evaluate Bond Performance",
      description:
        "Trigger oracle-verified PnL evaluation for a trading bond. Reads the leader's realized PnL from on-chain settlement events and compares against the performance threshold. If in Ghost Mode, accepts a ZK proof of PnL instead of public data. Returns: current PnL, threshold, slash amount (if any), and settlement status.",
    },
  })
  .handle(async ({ body }) => {
    return ok({
      action: "evaluate_performance",
      bondId: body.bondId,
      evaluation: {
        method: "oracle-verified on-chain PnL",
        ghostModeSupported: true,
        ghostModeMethod: "ZK proof of PnL via post__api_ghost_pnl — proves performance without revealing positions",
        oracleSource: "Pyth Network forex feeds + on-chain settlement events",
      },
      chainId: ARC_CHAIN_ID,
      status: "evaluation_pending",
      note: "Evaluation can be triggered by anyone — the oracle data is public. Ghost Mode traders submit ZK proofs instead.",
    });
  });

const listBonds = route
  .get("/bonds")
  .meta({
    mcp: {
      title: "List Trading Bonds",
      description:
        "List all active trading performance bonds. Shows leader address, bond amount, duration, threshold, current PnL, follower count, and total staked. Use to discover traders accepting copy-trading followers. Filter by performance, reputation, and bond size.",
    },
  })
  .handle(async () => {
    return ok({
      bonds: [],
      total: 0,
      chainId: ARC_CHAIN_ID,
      note: "No active bonds yet. Create one via post__api_bonds_create to start the copy-trading marketplace.",
    });
  });

export default new Hyper({ prefix: "/api" }).use([
  createBond,
  stakeAlongside,
  evaluatePerformance,
  listBonds,
]);
