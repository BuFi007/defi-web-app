import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { cache } from "@hyper/cache";
import { createPublicClient, http, fallback, formatUnits } from "viem";
import { ARC, contractAddress, tokenAddress } from "../registry/index.ts";

// LP-insurance layer (the hookathon centerpiece):
//   SharedFxVault (0x0E63…)  — junior/senior buffers behind the FxSwap pools
//   TurboFeeVault (0x929e…)  — "LP deposits USDC, earns ONE composite APY" + the
//                              on-chain 50/40/10 fee split (treasury/LP/insurance).
const ARC_RPC = process.env.ARC_TESTNET_RPC ?? ARC.rpc;
const ARC_RPC_FALLBACK = process.env.ARC_TESTNET_RPC_FALLBACK ?? "https://rpc.testnet.arc.network";
const arcClient = createPublicClient({ transport: fallback([http(ARC_RPC), http(ARC_RPC_FALLBACK)]) });

const SHARED_VAULT = contractAddress("arc", "lpInsuranceLayer.sharedFxVault");
const TURBO_VAULT = contractAddress("arc", "lpInsuranceLayer.turboFeeVault");
const USDC = tokenAddress("arc", "USDC");
const JUNIOR_TOKENS = ["EURC", "MXNB", "QCAD", "AUDF", "cirBTC"] as const;
// Immutable on-chain fee split (TurboFeeVault PROTOCOL_BPS/LP_BPS/INSURANCE_BPS).
const FEE_SPLIT = { protocolBps: 5000, lpBps: 4000, insuranceBps: 1000 } as const;

const zAddr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const zAmount = z.string().regex(/^\d+(\.\d+)?$/);

const sharedVaultAbi = [
  { type: "function", name: "totalJuniorUsdc", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "seniorUsdcHot", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalJuniorTokenBalance", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const turboAbi = [
  { type: "function", name: "compositeApy", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalDeposits", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pendingYield", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const erc20Abi = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

// ── /api/vault/depths — SharedFxVault junior/senior buffers (seeding targets) ──
const vaultDepths = route
  .get("/vault/depths")
  .use(cache({ maxAge: 30, staleWhileRevalidate: 60 }))
  .meta({ mcp: { title: "Shared FX Vault — Buffer Depths", description: "Junior USDC + senior hot USDC + per-token junior balances backing the FxSwap pools. These are the cross-currency seeding targets; thin junior buffers => higher swap slippage." } })
  .output(
    z.object({
      vault: z.string(), chainId: z.number(),
      totalJuniorUsdc: z.string(), seniorUsdcHot: z.string(),
      juniorTokenBalances: z.record(z.string()),
      note: z.string(),
    }),
  )
  .handle(async () => {
    const read = (fn: string, args: readonly unknown[] = []) =>
      arcClient.readContract({ address: SHARED_VAULT, abi: sharedVaultAbi, functionName: fn as never, args: args as never }) as Promise<bigint>;
    let totalJuniorUsdc = "0", seniorUsdcHot = "0";
    try { totalJuniorUsdc = formatUnits(await read("totalJuniorUsdc"), 6); } catch {}
    try { seniorUsdcHot = formatUnits(await read("seniorUsdcHot"), 6); } catch {}
    const juniorTokenBalances: Record<string, string> = {};
    for (const sym of JUNIOR_TOKENS) {
      try {
        const dec = sym === "cirBTC" ? 18 : 6;
        juniorTokenBalances[sym] = formatUnits(await read("totalJuniorTokenBalance", [tokenAddress("arc", sym)]), dec);
      } catch { juniorTokenBalances[sym] = "n/a"; }
    }
    return ok({ vault: SHARED_VAULT, chainId: ARC.chainId, totalJuniorUsdc, seniorUsdcHot, juniorTokenBalances, note: "Junior buffer absorbs first-loss; senior hot USDC is the JIT liquidity. Deepen junior to reduce cross-currency slippage." });
  });

// ── /api/lp/info — TurboFeeVault composite APY + fee split ──
const lpInfo = route
  .get("/lp/info")
  .use(cache({ maxAge: 30, staleWhileRevalidate: 60 }))
  .meta({ mcp: { title: "LP Vault — Info + Composite APY", description: "TurboFeeVault: deposit USDC, earn one blended APY (lending IRM + 40% trading-fee share + hedge income). Returns compositeApy, totalDeposits, and the immutable 50/40/10 fee split (treasury/LP/insurance)." } })
  .output(
    z.object({
      vault: z.string(), chainId: z.number(), depositAsset: z.string(),
      compositeApyRaw: z.string(), compositeApyPercent: z.string().nullable(),
      totalDeposits: z.string(),
      feeSplit: z.object({ protocolBps: z.number(), lpBps: z.number(), insuranceBps: z.number(), note: z.string() }),
      note: z.string(),
    }),
  )
  .handle(async () => {
    const read = (fn: string) => arcClient.readContract({ address: TURBO_VAULT, abi: turboAbi, functionName: fn as never, args: [] }) as Promise<bigint>;
    let apyRaw = 0n, total = 0n;
    try { apyRaw = await read("compositeApy"); } catch {}
    try { total = await read("totalDeposits"); } catch {}
    // compositeApy scale is uint256; rewardPerShare is 1e18-scaled, so treat APY as a
    // 1e18 fraction → percent. Reported alongside the raw value for transparency.
    const apyPct = apyRaw > 0n ? formatUnits(apyRaw * 100n, 18) : null;
    return ok({
      vault: TURBO_VAULT, chainId: ARC.chainId, depositAsset: "USDC",
      compositeApyRaw: apyRaw.toString(), compositeApyPercent: apyPct,
      totalDeposits: formatUnits(total, 6),
      feeSplit: { ...FEE_SPLIT, note: "50% protocol treasury, 40% LP yield pool, 10% insurance fund (hedge-failure protection)" },
      note: "compositeApyPercent assumes a 1e18-scaled fraction; verify against the contract. Deposit via /api/lp/deposit.",
    });
  });

// ── /api/lp/position — a wallet's claimable yield ──
const lpPosition = route
  .get("/lp/position")
  .query(z.object({ address: zAddr }))
  .meta({ mcp: { title: "LP Vault — Position", description: "Claimable pending yield for an LP address in the TurboFeeVault." } })
  .output(z.object({ vault: z.string(), address: z.string(), pendingYield: z.string(), pendingYieldRaw: z.string() }))
  .handle(async ({ query }) => {
    let pending = 0n;
    try { pending = (await arcClient.readContract({ address: TURBO_VAULT, abi: turboAbi, functionName: "pendingYield", args: [query.address as `0x${string}`] })) as bigint; } catch {}
    return ok({ vault: TURBO_VAULT, address: query.address, pendingYield: formatUnits(pending, 6), pendingYieldRaw: pending.toString() });
  });

// ── PREPARE endpoints (unsigned contract calls; the user signs/broadcasts) ──
const lpDeposit = route
  .post("/lp/deposit")
  .body(z.object({ amountUsdc: zAmount, lp: zAddr }))
  .meta({ mcp: { title: "LP Vault — Prepare Deposit", description: "Prepare an unsigned TurboFeeVault.deposit(assets) call to stake USDC for composite-APY LP shares. Returns the call + an approval preflight (USDC must be approved to the vault). PREPARE only — you sign/broadcast." } })
  .output(z.object({ action: z.literal("lp_deposit"), vault: z.string(), amountAtomic: z.string(), contract: z.object({ address: z.string(), function: z.string(), args: z.record(z.string()) }), approvalNeeded: z.object({ token: z.string(), spender: z.string(), atLeastAtomic: z.string(), currentAllowance: z.string() }).nullable(), chainId: z.number(), note: z.string() }))
  .handle(async ({ body }) => {
    const atomic = BigInt(Math.floor(parseFloat(body.amountUsdc) * 1e6));
    let allowance = 0n;
    try { allowance = (await arcClient.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [body.lp as `0x${string}`, TURBO_VAULT] })) as bigint; } catch {}
    const approvalNeeded = allowance >= atomic ? null : { token: USDC, spender: TURBO_VAULT, atLeastAtomic: atomic.toString(), currentAllowance: allowance.toString() };
    return ok({ action: "lp_deposit", vault: TURBO_VAULT, amountAtomic: atomic.toString(), contract: { address: TURBO_VAULT, function: "deposit(uint256 assets)", args: { assets: atomic.toString() } }, approvalNeeded, chainId: ARC.chainId, note: "If approvalNeeded is non-null, approve USDC to the vault first, then call deposit. Earns the 40% LP fee share + lending + hedge yield." });
  });

const lpWithdraw = route
  .post("/lp/withdraw")
  .body(z.object({ shares: z.string().regex(/^\d+$/), lp: zAddr }))
  .meta({ mcp: { title: "LP Vault — Prepare Withdraw", description: "Prepare an unsigned TurboFeeVault.withdraw(sharesToBurn) call (burn LP shares → USDC). PREPARE only — you sign." } })
  .output(z.object({ action: z.literal("lp_withdraw"), vault: z.string(), contract: z.object({ address: z.string(), function: z.string(), args: z.record(z.string()) }), chainId: z.number(), note: z.string() }))
  .handle(async ({ body }) => ok({ action: "lp_withdraw", vault: TURBO_VAULT, contract: { address: TURBO_VAULT, function: "withdraw(uint256 sharesToBurn)", args: { sharesToBurn: body.shares } }, chainId: ARC.chainId, note: "Burns shares for the underlying USDC. Check /api/lp/position for claimable yield first (claim separately via /api/lp/claim)." }));

const lpClaim = route
  .post("/lp/claim")
  .body(z.object({ lp: zAddr }))
  .meta({ mcp: { title: "LP Vault — Prepare Claim Yield", description: "Prepare an unsigned TurboFeeVault.claimYield() call to claim accrued LP yield. PREPARE only — you sign." } })
  .output(z.object({ action: z.literal("lp_claim"), vault: z.string(), contract: z.object({ address: z.string(), function: z.string(), args: z.record(z.string()) }), chainId: z.number(), note: z.string() }))
  .handle(async ({ body }) => ok({ action: "lp_claim", vault: TURBO_VAULT, contract: { address: TURBO_VAULT, function: "claimYield()", args: {} }, chainId: ARC.chainId, note: `claimYield() for ${body.lp} sends accrued USDC yield to the caller.` }));

export default new Hyper({ prefix: "/api" }).use([vaultDepths, lpInfo, lpPosition, lpDeposit, lpWithdraw, lpClaim]);
