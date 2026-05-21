/**
 * BUFI perps end-to-end demo trade — Arc Testnet (chain 5042002).
 *
 * The script opens AND closes a real maker/taker matched perp position on
 * `FxOrderSettlement` using two trader EOAs signing EIP-712 SignedOrders
 * and a third settler EOA (the keeper, must hold SETTLER_ROLE) submitting
 * the `settleMatch` tx. It writes a `scripts/perps-demo-trade.output.json`
 * artifact containing the open + close tx hashes, ready to be screenshotted
 * for the hackathon demo.
 *
 * Required env (.env.local at repo root):
 *   - KEEPER_PRIVATE_KEY        Settler EOA. Must hold SETTLER_ROLE on
 *                               FxOrderSettlement (0x49ad…F5565 on Arc).
 *   - DEMO_MAKER_PRIVATE_KEY    Maker trader EOA. Must hold ≥10 USDC on Arc
 *                               testnet to deposit margin.
 *   - DEMO_TAKER_PRIVATE_KEY    Taker trader EOA. Same funding constraint.
 *
 * Optional env:
 *   - ARC_TESTNET_RPC_URL       Defaults to https://rpc.testnet.arc.network.
 *   - DEMO_MARKET_SYMBOL        ArcPerpMarketSymbol, defaults "EURC/USDC".
 *   - DEMO_DWELL_MS             Time between open and close, defaults 30_000.
 *   - DEMO_FILL_SIZE_E18        Override fill size, defaults 1e18 (1 unit).
 *
 * Re-runnable:
 *   - depositMargin and ERC-20 approval skip if already satisfied.
 *   - Nonces are fetched per-trader from the on-chain bitmap (first
 *     unused nonce from 0 forward), so two consecutive runs don't collide.
 *
 * Output:
 *   - scripts/perps-demo-trade.output.json — full artifact, also printed
 *     to stdout at the end. On hard blockers the script writes a
 *     { status: "blocked", reason, needed: [...] } shape and exits 2.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARC_PERP_MARKETS,
  type ArcPerpMarket,
  type ArcPerpMarketSymbol,
  CONTRACTS,
  DEFAULT_RPC_URLS,
  FxMarginAccountAbi,
  FxOrderSettlementAbi,
  FxPerpClearinghouseAbi,
  FxOracleAbi,
} from "@bufi/contracts";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  http,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

// -- Constants ----------------------------------------------------------

const ARC_CHAIN_ID = 5042002 as const;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(SCRIPT_DIR, "perps-demo-trade.output.json");
const EXPLORER_BASE = "https://testnet.arcscan.app/tx/";
const SETTLER_ROLE = keccak256(toBytes("SETTLER_ROLE"));
const DEMO_MARGIN_USDC = 10_000_000n; // 10 USDC (6 decimals)
const DEFAULT_DWELL_MS = 30_000;
// 1 unit (1e18) at 5% IMR ≈ 0.05 USDC notional required, well under 10 USDC.
const DEFAULT_FILL_SIZE_E18 = 1_000_000_000_000_000_000n;

// EIP-712 SignedOrder shape — MUST match the on-chain typehash byte-for-byte.
//
// CRITICAL: the deployed `FxOrderSettlement` on Arc Testnet
// (0x49ad97Fa2b67252373f4683bD4a4B49AA3AF5565) was deployed BEFORE the
// `maxFee` field was added to the contract source. The on-chain
// SIGNED_ORDER_TYPEHASH is:
//   0x013bef06acd9c1a46aeac93201b83f21f59135ab2cb6115aba5497a50529f462
//   = keccak256("SignedOrder(address trader,bytes32 marketId,int256
//                 sizeDeltaE18,uint256 priceE18,uint8 orderType,uint8 flags,
//                 uint64 nonce,uint64 deadline)")   // 8 fields, no maxFee
//
// The contract source on origin/feat/privacy-hook-slice-3-crossccy (and
// presumably main, which @bufi/contracts ABI is generated from) has the
// V9 9-field shape with maxFee — that source has DRIFTED ahead of the
// live deployment. Until the contract is redeployed, every signature
// and settleMatch call MUST use the V8 8-field shape.
//
// See `docs/roadmap-production-perps.md` Pillar 1 — "deploy drift" should
// be a tracked finding.
const SIGNED_ORDER_TYPES = {
  SignedOrder: [
    { name: "trader", type: "address" },
    { name: "marketId", type: "bytes32" },
    { name: "sizeDeltaE18", type: "int256" },
    { name: "priceE18", type: "uint256" },
    { name: "orderType", type: "uint8" },
    { name: "flags", type: "uint8" },
    { name: "nonce", type: "uint64" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

// V8 settleMatch ABI inlined — matches the deployed contract shape.
// Override of `FxOrderSettlementAbi.settleMatch` from @bufi/contracts which
// carries the V9 (with-maxFee) variant.
const FxOrderSettlementV8SettleMatchAbi = [
  {
    type: "function",
    name: "settleMatch",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "maker",
        type: "tuple",
        components: [
          { name: "trader", type: "address" },
          { name: "marketId", type: "bytes32" },
          { name: "sizeDeltaE18", type: "int256" },
          { name: "priceE18", type: "uint256" },
          { name: "orderType", type: "uint8" },
          { name: "flags", type: "uint8" },
          { name: "nonce", type: "uint64" },
          { name: "deadline", type: "uint64" },
        ],
      },
      { name: "makerSig", type: "bytes" },
      {
        name: "taker",
        type: "tuple",
        components: [
          { name: "trader", type: "address" },
          { name: "marketId", type: "bytes32" },
          { name: "sizeDeltaE18", type: "int256" },
          { name: "priceE18", type: "uint256" },
          { name: "orderType", type: "uint8" },
          { name: "flags", type: "uint8" },
          { name: "nonce", type: "uint64" },
          { name: "deadline", type: "uint64" },
        ],
      },
      { name: "takerSig", type: "bytes" },
      { name: "fillSizeE18", type: "uint256" },
      { name: "fillPriceE18", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

interface SignedOrder {
  trader: Address;
  marketId: Hex;
  sizeDeltaE18: bigint;
  priceE18: bigint;
  orderType: number;
  flags: number;
  nonce: bigint;
  deadline: bigint;
}

interface DemoOutput {
  status: "ok";
  chain: "arc-testnet";
  chainId: typeof ARC_CHAIN_ID;
  marketId: Hex;
  marketSymbol: ArcPerpMarketSymbol;
  timestamp: string;
  trader: { maker: Address; taker: Address; settler: Address };
  fillSizeE18: string;
  fillPriceE18: string;
  deposits: Array<{
    trader: "maker" | "taker";
    address: Address;
    approveTx?: string;
    depositTx?: string;
    explorer?: string;
    skipped?: string;
  }>;
  open: {
    tx: Hex;
    explorer: string;
    fillSizeE18: string;
    fillPriceE18: string;
    blockNumber: string;
    gasUsed: string;
    events: {
      MatchSettled?: Record<string, unknown>;
      PositionIncreased: Array<Record<string, unknown>>;
    };
  };
  close: {
    tx: Hex;
    explorer: string;
    fillSizeE18: string;
    fillPriceE18: string;
    blockNumber: string;
    gasUsed: string;
    pnlAtomic: string;
    events: {
      MatchSettled?: Record<string, unknown>;
      PositionDecreased: Array<Record<string, unknown>>;
    };
  };
}

interface BlockedOutput {
  status: "blocked";
  reason: string;
  needed: string[];
  hint?: string;
}

// -- Main ---------------------------------------------------------------

main().catch((err) => {
  console.error("perps-demo-trade fatal:", err);
  writeBlocked({
    status: "blocked",
    reason: (err as Error).message ?? String(err),
    needed: [],
    hint: "see stderr",
  });
  process.exit(1);
});

async function main(): Promise<void> {
  loadDotEnvLocal();

  // -- env gates ------------------------------------------------------
  const keeperPk = process.env.KEEPER_PRIVATE_KEY as Hex | undefined;
  const makerPk = process.env.DEMO_MAKER_PRIVATE_KEY as Hex | undefined;
  const takerPk = process.env.DEMO_TAKER_PRIVATE_KEY as Hex | undefined;
  const missing: string[] = [];
  if (!keeperPk) missing.push("KEEPER_PRIVATE_KEY");
  if (!makerPk) missing.push("DEMO_MAKER_PRIVATE_KEY");
  if (!takerPk) missing.push("DEMO_TAKER_PRIVATE_KEY");
  if (missing.length > 0) {
    writeBlocked({
      status: "blocked",
      reason: `missing required env vars in .env.local: ${missing.join(", ")}`,
      needed: missing,
      hint:
        "Generate two trader EOAs (e.g. `cast wallet new`), set DEMO_MAKER_PRIVATE_KEY " +
        "and DEMO_TAKER_PRIVATE_KEY in .env.local, fund both addresses with ≥10 USDC " +
        "on Arc Testnet via https://faucet.circle.com, then re-run this script.",
    });
    process.exit(2);
  }

  // -- accounts & clients --------------------------------------------
  const keeper = privateKeyToAccount(keeperPk!);
  const maker = privateKeyToAccount(makerPk!);
  const taker = privateKeyToAccount(takerPk!);

  const rpc = process.env.ARC_TESTNET_RPC_URL ?? DEFAULT_RPC_URLS[ARC_CHAIN_ID];
  const publicClient = createPublicClient({ transport: http(rpc) });
  const keeperWallet = createWalletClient({ account: keeper, transport: http(rpc) });
  const makerWallet = createWalletClient({ account: maker, transport: http(rpc) });
  const takerWallet = createWalletClient({ account: taker, transport: http(rpc) });

  console.log("[demo] addresses", {
    keeper: keeper.address,
    maker: maker.address,
    taker: taker.address,
  });

  // -- contracts ------------------------------------------------------
  const arc = CONTRACTS[ARC_CHAIN_ID];
  const orderSettlement = arc.perps.orderSettlement;
  const clearinghouse = arc.perps.clearinghouse;
  const marginAccount = arc.perps.marginAccount;
  const oracle = arc.telarana.fxOracle;
  const usdc = arc.tokens.usdc;
  if (!orderSettlement || !clearinghouse || !marginAccount || !oracle || !usdc) {
    writeBlocked({
      status: "blocked",
      reason: "Arc perps contract addresses are missing from @bufi/contracts manifest",
      needed: ["perps.orderSettlement", "perps.clearinghouse", "perps.marginAccount", "telarana.fxOracle", "tokens.usdc"],
    });
    process.exit(2);
  }

  // -- pick market ----------------------------------------------------
  const marketSymbol = (process.env.DEMO_MARKET_SYMBOL as ArcPerpMarketSymbol | undefined) ?? "EURC/USDC";
  const market: ArcPerpMarket | undefined = ARC_PERP_MARKETS[marketSymbol];
  if (!market) {
    writeBlocked({
      status: "blocked",
      reason: `unknown DEMO_MARKET_SYMBOL: ${marketSymbol}`,
      needed: ["DEMO_MARKET_SYMBOL ∈ EURC/USDC | tJPYC/USDC | tMXNB/USDC | tCHFC/USDC"],
    });
    process.exit(2);
  }
  const baseToken = arc.tokens[market.baseToken] as Address;
  console.log("[demo] market", { symbol: marketSymbol, marketId: market.marketId });

  // -- settler role check --------------------------------------------
  const hasRole = (await publicClient.readContract({
    address: orderSettlement,
    abi: FxOrderSettlementAbi,
    functionName: "hasRole",
    args: [SETTLER_ROLE, keeper.address],
  })) as boolean;
  if (!hasRole) {
    writeBlocked({
      status: "blocked",
      reason: `keeper EOA ${keeper.address} does not hold SETTLER_ROLE on FxOrderSettlement ${orderSettlement}`,
      needed: ["DEFAULT_ADMIN_ROLE holder must grant SETTLER_ROLE to keeper"],
      hint: `cast send ${orderSettlement} 'grantRole(bytes32,address)' ${SETTLER_ROLE} ${keeper.address} --rpc-url ${rpc} --private-key <admin pk>`,
    });
    process.exit(2);
  }
  console.log("[demo] keeper has SETTLER_ROLE: ok");

  // -- balance probe --------------------------------------------------
  const [makerUsdc, takerUsdc] = await Promise.all([
    readUsdcBalance(publicClient, usdc, maker.address),
    readUsdcBalance(publicClient, usdc, taker.address),
  ]);
  console.log("[demo] usdc balances", {
    maker: makerUsdc.toString(),
    taker: takerUsdc.toString(),
  });
  const traderMargin = await Promise.all([
    readMarginOf(publicClient, marginAccount, maker.address),
    readMarginOf(publicClient, marginAccount, taker.address),
  ]);
  const [makerMargin, takerMargin] = traderMargin;
  console.log("[demo] margin balances", { maker: makerMargin.toString(), taker: takerMargin.toString() });

  const fundingNeeded: string[] = [];
  if (makerUsdc + makerMargin < DEMO_MARGIN_USDC) fundingNeeded.push(`maker ${maker.address}`);
  if (takerUsdc + takerMargin < DEMO_MARGIN_USDC) fundingNeeded.push(`taker ${taker.address}`);
  if (fundingNeeded.length > 0) {
    writeBlocked({
      status: "blocked",
      reason: `demo wallets under-funded; need ≥10 USDC each (wallet USDC + already-deposited margin)`,
      needed: fundingNeeded,
      hint:
        "Fund these addresses from https://faucet.circle.com (select 'Arc Testnet', request USDC), wait for confirmation, then re-run.",
    });
    process.exit(2);
  }

  // -- deposits (idempotent) -----------------------------------------
  const deposits: DemoOutput["deposits"] = [];
  for (const t of [
    { role: "maker" as const, account: maker, wallet: makerWallet, existing: makerMargin, balance: makerUsdc },
    { role: "taker" as const, account: taker, wallet: takerWallet, existing: takerMargin, balance: takerUsdc },
  ]) {
    if (t.existing >= DEMO_MARGIN_USDC) {
      console.log(`[demo] ${t.role} already has ${t.existing} margin → skip deposit`);
      deposits.push({ trader: t.role, address: t.account.address, skipped: `existing margin ${t.existing}` });
      continue;
    }
    const need = DEMO_MARGIN_USDC - t.existing;
    if (t.balance < need) {
      writeBlocked({
        status: "blocked",
        reason: `${t.role} ${t.account.address} has only ${t.balance} USDC; needs ${need} to top up to ${DEMO_MARGIN_USDC} margin`,
        needed: [`fund ${t.account.address} with ${need} USDC`],
      });
      process.exit(2);
    }

    const currentAllowance = (await publicClient.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "allowance",
      args: [t.account.address, marginAccount],
    })) as bigint;

    let approveTx: Hex | undefined;
    if (currentAllowance < need) {
      console.log(`[demo] ${t.role} approving ${need} USDC → margin account`);
      approveTx = await t.wallet.sendTransaction({
        chain: null,
        account: t.account,
        to: usdc,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [marginAccount, need],
        }),
      });
      await waitOk(publicClient, approveTx, `approve(${t.role})`);
    } else {
      console.log(`[demo] ${t.role} allowance ${currentAllowance} ≥ ${need} → skip approve`);
    }

    console.log(`[demo] ${t.role} depositMargin(${t.account.address}, ${need})`);
    const depositTx = await t.wallet.sendTransaction({
      chain: null,
      account: t.account,
      to: marginAccount,
      data: encodeFunctionData({
        abi: FxMarginAccountAbi,
        functionName: "depositMargin",
        args: [t.account.address, need],
      }),
    });
    await waitOk(publicClient, depositTx, `depositMargin(${t.role})`);
    deposits.push({
      trader: t.role,
      address: t.account.address,
      approveTx,
      depositTx,
      explorer: EXPLORER_BASE + depositTx,
    });
  }

  // -- oracle mid price ----------------------------------------------
  const [midE18, publishedAt] = (await publicClient.readContract({
    address: oracle,
    abi: FxOracleAbi,
    functionName: "getMid",
    args: [baseToken, usdc],
  })) as [bigint, bigint];
  if (midE18 === 0n) {
    writeBlocked({
      status: "blocked",
      reason: `FxOracle.getMid(${baseToken}, ${usdc}) returned 0 — Pyth feed for ${marketSymbol} not yet primed by keeper-pyth`,
      needed: ["keeper-pyth must publish the matching feed before perps can match"],
      hint: "run `bun run keeper:pyth` against Arc Testnet, or wait for an existing keeper-pyth deployment to publish.",
    });
    process.exit(2);
  }
  console.log("[demo] oracle mid", { midE18: midE18.toString(), publishedAt: publishedAt.toString() });

  // -- nonces (find first unused per-trader) -------------------------
  const makerNonce = await firstUnusedNonce(publicClient, orderSettlement, maker.address);
  const takerNonce = await firstUnusedNonce(publicClient, orderSettlement, taker.address);
  console.log("[demo] nonces", { makerNonce, takerNonce });

  // -- size / deadline ------------------------------------------------
  const fillSizeE18 = process.env.DEMO_FILL_SIZE_E18
    ? BigInt(process.env.DEMO_FILL_SIZE_E18)
    : DEFAULT_FILL_SIZE_E18;
  const dwellMs = Number(process.env.DEMO_DWELL_MS ?? DEFAULT_DWELL_MS);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  // -- OPEN: maker long, taker short --------------------------------
  const openMaker = await signOrder({
    trader: maker,
    orderSettlement,
    market,
    sizeDeltaE18: fillSizeE18, // long
    priceE18: midE18,
    flags: 0,
    nonce: makerNonce,
    deadline,
  });
  const openTaker = await signOrder({
    trader: taker,
    orderSettlement,
    market,
    sizeDeltaE18: -fillSizeE18, // short
    priceE18: midE18,
    flags: 0,
    nonce: takerNonce,
    deadline,
  });

  console.log("[demo] OPEN settleMatch", { fillSizeE18: fillSizeE18.toString(), fillPriceE18: midE18.toString() });
  const openTx = await keeperWallet.writeContract({
    chain: null,
    account: keeper,
    address: orderSettlement,
    abi: FxOrderSettlementV8SettleMatchAbi,
    functionName: "settleMatch",
    args: [openMaker.order, openMaker.signature, openTaker.order, openTaker.signature, fillSizeE18, midE18],
  });
  const openReceipt = await waitOk(publicClient, openTx, "settleMatch(open)");
  const openDecoded = decodeSettlementEvents(openReceipt, "open");
  console.log("[demo] OPEN tx", { tx: openTx, gasUsed: openReceipt.gasUsed.toString() });

  // -- dwell (so funding accrues / demo-feel) ------------------------
  if (dwellMs > 0) {
    console.log(`[demo] dwell ${dwellMs}ms before close`);
    await sleep(dwellMs);
  }

  // -- CLOSE: maker short reduce-only, taker long reduce-only ------
  const [closePrice, closePublishedAt] = (await publicClient.readContract({
    address: oracle,
    abi: FxOracleAbi,
    functionName: "getMid",
    args: [baseToken, usdc],
  })) as [bigint, bigint];
  if (closePrice === 0n) {
    throw new Error("oracle returned 0 mid on close — Pyth feed stale");
  }
  console.log("[demo] close oracle mid", { closePrice: closePrice.toString(), publishedAt: closePublishedAt.toString() });

  const closeMakerNonce = await firstUnusedNonce(publicClient, orderSettlement, maker.address);
  const closeTakerNonce = await firstUnusedNonce(publicClient, orderSettlement, taker.address);
  const closeDeadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  const closeMaker = await signOrder({
    trader: maker,
    orderSettlement,
    market,
    sizeDeltaE18: -fillSizeE18, // close long → sell
    priceE18: closePrice,
    flags: 1, // FLAG_REDUCE_ONLY
    nonce: closeMakerNonce,
    deadline: closeDeadline,
  });
  const closeTaker = await signOrder({
    trader: taker,
    orderSettlement,
    market,
    sizeDeltaE18: fillSizeE18, // close short → buy
    priceE18: closePrice,
    flags: 1,
    nonce: closeTakerNonce,
    deadline: closeDeadline,
  });

  console.log("[demo] CLOSE settleMatch", {
    fillSizeE18: fillSizeE18.toString(),
    fillPriceE18: closePrice.toString(),
  });
  const closeTx = await keeperWallet.writeContract({
    chain: null,
    account: keeper,
    address: orderSettlement,
    abi: FxOrderSettlementV8SettleMatchAbi,
    functionName: "settleMatch",
    args: [
      closeMaker.order,
      closeMaker.signature,
      closeTaker.order,
      closeTaker.signature,
      fillSizeE18,
      closePrice,
    ],
  });
  const closeReceipt = await waitOk(publicClient, closeTx, "settleMatch(close)");
  const closeDecoded = decodeSettlementEvents(closeReceipt, "close");
  console.log("[demo] CLOSE tx", { tx: closeTx, gasUsed: closeReceipt.gasUsed.toString() });

  // Pull realized PnL from PositionDecreased (sum across maker+taker;
  // both are emitted on the same tx, but the maker's pnl is the
  // headline since the demo lists the maker as the "winner" of the
  // close direction).
  const pnlAtomic = closeDecoded.PositionDecreased.reduce(
    (acc, ev) => acc + ((ev.pnl as bigint | undefined) ?? 0n),
    0n,
  );

  const out: DemoOutput = {
    status: "ok",
    chain: "arc-testnet",
    chainId: ARC_CHAIN_ID,
    marketId: market.marketId,
    marketSymbol,
    timestamp: new Date().toISOString(),
    trader: { maker: maker.address, taker: taker.address, settler: keeper.address },
    fillSizeE18: fillSizeE18.toString(),
    fillPriceE18: midE18.toString(),
    deposits,
    open: {
      tx: openTx,
      explorer: EXPLORER_BASE + openTx,
      fillSizeE18: fillSizeE18.toString(),
      fillPriceE18: midE18.toString(),
      blockNumber: openReceipt.blockNumber.toString(),
      gasUsed: openReceipt.gasUsed.toString(),
      events: {
        MatchSettled: openDecoded.MatchSettled,
        PositionIncreased: openDecoded.PositionIncreased,
      },
    },
    close: {
      tx: closeTx,
      explorer: EXPLORER_BASE + closeTx,
      fillSizeE18: fillSizeE18.toString(),
      fillPriceE18: closePrice.toString(),
      blockNumber: closeReceipt.blockNumber.toString(),
      gasUsed: closeReceipt.gasUsed.toString(),
      pnlAtomic: pnlAtomic.toString(),
      events: {
        MatchSettled: closeDecoded.MatchSettled,
        PositionDecreased: closeDecoded.PositionDecreased,
      },
    },
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(out, bigintReplacer, 2));
  console.log(JSON.stringify(out, bigintReplacer, 2));
  console.log("\n[demo] DONE → wrote", OUTPUT_PATH);
}

// -- Helpers ------------------------------------------------------------

async function signOrder(args: {
  trader: PrivateKeyAccount;
  orderSettlement: Address;
  market: ArcPerpMarket;
  sizeDeltaE18: bigint;
  priceE18: bigint;
  flags: number;
  nonce: bigint;
  deadline: bigint;
}): Promise<{ order: SignedOrder; signature: Hex }> {
  const order: SignedOrder = {
    trader: args.trader.address,
    marketId: args.market.marketId,
    sizeDeltaE18: args.sizeDeltaE18,
    priceE18: args.priceE18,
    orderType: 0, // market
    flags: args.flags,
    nonce: args.nonce,
    deadline: args.deadline,
  };
  const signature = await args.trader.signTypedData({
    domain: {
      name: "TelaranaFxOrderSettlement",
      version: "1",
      chainId: ARC_CHAIN_ID,
      verifyingContract: args.orderSettlement,
    },
    types: SIGNED_ORDER_TYPES,
    primaryType: "SignedOrder",
    message: order,
  });
  return { order, signature };
}

async function readUsdcBalance(
  publicClient: PublicClient,
  usdc: Address,
  who: Address,
): Promise<bigint> {
  return (await publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [who],
  })) as bigint;
}

async function readMarginOf(
  publicClient: PublicClient,
  marginAccount: Address,
  who: Address,
): Promise<bigint> {
  return (await publicClient.readContract({
    address: marginAccount,
    abi: FxMarginAccountAbi,
    functionName: "marginOf",
    args: [who],
  })) as bigint;
}

async function firstUnusedNonce(
  publicClient: PublicClient,
  orderSettlement: Address,
  trader: Address,
): Promise<bigint> {
  // Scan word 0 first; if the low 256 bits are saturated, scan word 1.
  // Demo wallets won't blow past 512 nonces, so two words is enough.
  for (let word = 0n; word < 2n; word++) {
    const bitmap = (await publicClient.readContract({
      address: orderSettlement,
      abi: FxOrderSettlementAbi,
      functionName: "nonceBitmap",
      args: [trader, word],
    })) as bigint;
    for (let bit = 0n; bit < 256n; bit++) {
      if ((bitmap & (1n << bit)) === 0n) {
        return (word << 8n) + bit;
      }
    }
  }
  throw new Error(`trader ${trader} has used all nonces in words 0+1`);
}

async function waitOk(
  publicClient: PublicClient,
  hash: Hex,
  label: string,
): Promise<TransactionReceipt> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`${label} reverted: ${hash}`);
  }
  return receipt;
}

function decodeSettlementEvents(
  receipt: TransactionReceipt,
  phase: "open" | "close",
): {
  MatchSettled?: Record<string, unknown>;
  PositionIncreased: Array<Record<string, unknown>>;
  PositionDecreased: Array<Record<string, unknown>>;
} {
  const out = {
    MatchSettled: undefined as Record<string, unknown> | undefined,
    PositionIncreased: [] as Array<Record<string, unknown>>,
    PositionDecreased: [] as Array<Record<string, unknown>>,
  };
  for (const log of receipt.logs) {
    // MatchSettled lives on FxOrderSettlement
    try {
      const ev = decodeEventLog({
        abi: FxOrderSettlementAbi,
        data: log.data,
        topics: log.topics,
        strict: false,
      });
      if (ev.eventName === "MatchSettled") {
        out.MatchSettled = ev.args as unknown as Record<string, unknown>;
        continue;
      }
    } catch {
      /* not an FxOrderSettlement event */
    }
    // PositionIncreased / PositionDecreased live on FxPerpClearinghouse
    try {
      const ev = decodeEventLog({
        abi: FxPerpClearinghouseAbi,
        data: log.data,
        topics: log.topics,
        strict: false,
      });
      if (ev.eventName === "PositionIncreased") {
        out.PositionIncreased.push(ev.args as unknown as Record<string, unknown>);
      } else if (ev.eventName === "PositionDecreased") {
        out.PositionDecreased.push(ev.args as unknown as Record<string, unknown>);
      }
    } catch {
      /* other log, ignore */
    }
  }

  if (!out.MatchSettled) {
    throw new Error(`expected MatchSettled in ${phase} receipt; not found`);
  }
  if (phase === "open" && out.PositionIncreased.length === 0) {
    throw new Error("expected ≥1 PositionIncreased on open receipt; got 0");
  }
  if (phase === "close" && out.PositionDecreased.length === 0) {
    throw new Error("expected ≥1 PositionDecreased on close receipt; got 0");
  }
  return out;
}

function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeBlocked(out: BlockedOutput): void {
  writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2));
  console.error(JSON.stringify(out, null, 2));
}

// Walk up from this script's dir to find the workspace-root `.env.local`
// and hand it to Bun.env. Bun only auto-loads cwd-local .env.local, so
// running `bun run scripts/perps-demo-trade.ts` from the repo root works
// out of the box, but running from a sub-dir would silently lose envs
// without this. Existing process.env wins so per-invocation overrides
// (e.g. `DEMO_DWELL_MS=0 bun ...`) keep working.
function loadDotEnvLocal(): void {
  try {
    const { existsSync, readFileSync } = require("node:fs") as typeof import("node:fs");
    let dir = SCRIPT_DIR;
    for (let i = 0; i < 6; i++) {
      const candidate = resolve(dir, ".env.local");
      if (existsSync(candidate)) {
        const txt = readFileSync(candidate, "utf8");
        for (const rawLine of txt.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line || line.startsWith("#")) continue;
          const eq = line.indexOf("=");
          if (eq < 0) continue;
          const key = line.slice(0, eq).trim();
          if (!key || process.env[key] !== undefined) continue;
          let value = line.slice(eq + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          process.env[key] = value;
        }
        return;
      }
      const parent = resolve(dir, "..");
      if (parent === dir) return;
      dir = parent;
    }
  } catch {
    // best-effort: missing envs trigger the gate above with a clear message
  }
}
