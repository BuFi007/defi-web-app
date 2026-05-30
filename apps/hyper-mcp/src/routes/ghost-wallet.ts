import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { ARC_CHAIN_ID, zAddress, zSymbol, zSide, zLeverage } from "../shared.ts";

// ── Ghost Wallet — per-chain shielded "trade balance" (private trading) ──────
// Deposit once into a per-chain shielded balance; trades / supplies / borrows
// execute FROM it via a detached executor, so your wallet is not the on-chain
// actor. Identity + amount are hidden; the position itself is still public on
// the matcher. The executor resolves back to YOU privately (viewing-key scoped).
//
// Execution layer binds to a ShieldedExecutionProvider (Hinkal on Arc first;
// own-stack later). These tools are PREPARE-ONLY / advice — they return the
// shapes the client or agent signs. The MCP never holds a key and never
// fabricates a balance.

const GHOST_WALLET_NOTICE = {
  model:
    "Ghost Wallet = a per-chain shielded trade balance. Deposit once; trade/lend/borrow execute FROM it via a detached executor address, so your own wallet is never the on-chain msg.sender.",
  hides: "WHO (your wallet <-> the trade) and HOW MUCH (balance, margin funding, PnL)",
  doesNotHide:
    "the position itself — the order still reaches the matcher in cleartext to be filled. Claim: unlinkable + amount-private, NOT invisible position.",
  resolution:
    "the detached executor resolves back to YOU privately (viewing-key scoped) so you can manage/close positions; the public cannot link it to you.",
  exit:
    "withdraw to a FRESH address; amounts are public on exit, so withdraw in a denomination (see get__api_ghost_pools).",
  status:
    "execution provider binds to Hinkal on Arc (USDC/EURC supported today); these tools return prepare shapes the client/agent signs.",
} as const;

const zGhostToken = z.enum(["USDC", "EURC"]);

const ARC_TOKENS: Record<string, { address: string; decimals: number }> = {
  USDC: { address: "0x3600000000000000000000000000000000000000", decimals: 6 },
  EURC: { address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6 },
};

const atomic = (amount: string, decimals: number): string =>
  BigInt(Math.floor(parseFloat(amount) * 10 ** decimals)).toString();

// ── balance: model + how to populate. NEVER returns a fabricated number. ─────
const ghostWalletBalance = route
  .post("/ghost-wallet/balance")
  .body(z.object({ trader: zAddress }))
  .meta({
    mcp: {
      title: "Ghost Wallet — Balance (model)",
      description:
        "Describe the caller's per-chain Ghost (shielded) trade balance. The shielded balance is readable only with the owner's access key (client-side), so this endpoint returns the model + supported tokens + how to populate it, NOT a server-read number. Deposit via post__api_ghost_wallet_deposit; read the live shielded balance client-side after access.",
    },
  })
  .handle(async ({ body }) => {
    return ok({
      action: "ghost_wallet_balance",
      chainId: ARC_CHAIN_ID,
      trader: body.trader,
      shieldedTokens: Object.keys(ARC_TOKENS),
      available: false,
      note: "Shielded balances are owner-readable only (need the client-side access key). Deposit with ghost_wallet_deposit; read the balance client-side via the ShieldedExecutionProvider after ensureAccess.",
      privacyNotice: GHOST_WALLET_NOTICE,
    });
  });

// ── deposit (shield): public deposit -> shielded trade balance ───────────────
const ghostWalletDeposit = route
  .post("/ghost-wallet/deposit")
  .body(z.object({ token: zGhostToken, amount: z.string().regex(/^\d+(\.\d+)?$/), trader: zAddress }))
  .meta({
    mcp: {
      title: "Ghost Wallet — Deposit (shield)",
      description:
        "Shield public tokens into your per-chain Ghost trade balance. NOTE: the deposit transaction itself is public (you send tokens to the shielded pool) — privacy applies to your BALANCE and subsequent trades, not the deposit. Returns the approve + shield call shape to sign. After this, trade/lend/borrow privately via ghost_wallet_trade.",
    },
  })
  .handle(async ({ body }) => {
    const tok = ARC_TOKENS[body.token];
    if (!tok) return ok({ error: `Unsupported token: ${body.token}` });
    const amountAtomic = atomic(body.amount, tok.decimals);
    return ok({
      action: "ghost_wallet_deposit",
      chainId: ARC_CHAIN_ID,
      token: body.token,
      amountAtomic,
      prepare: {
        kind: "shield",
        approval: { token: tok.address, spender: "<shielded pool / Hinkal contract>", amount: amountAtomic },
        call: { function: "shield(address asset, uint256 amount)", args: { asset: tok.address, amount: amountAtomic } },
        authorization: "sign the shield op; relayer-submittable so your wallet need not broadcast",
      },
      note: "Deposit is public; your balance + trades after are hidden. Funds USDC margin for private perps and private lending.",
      privacyNotice: GHOST_WALLET_NOTICE,
    });
  });

// ── withdraw (unshield) -> fresh public address ──────────────────────────────
const ghostWalletWithdraw = route
  .post("/ghost-wallet/withdraw")
  .body(z.object({ token: zGhostToken, amount: z.string().regex(/^\d+(\.\d+)?$/), recipient: zAddress, trader: zAddress }))
  .meta({
    mcp: {
      title: "Ghost Wallet — Withdraw (unshield)",
      description:
        "Withdraw from your Ghost trade balance to a FRESH public address via the relayer (relayer is msg.sender, not you). The withdrawal amount is public on exit — use a denomination so it doesn't uniquely link back. Returns the unshield call shape to sign.",
    },
  })
  .handle(async ({ body }) => {
    const tok = ARC_TOKENS[body.token];
    if (!tok) return ok({ error: `Unsupported token: ${body.token}` });
    return ok({
      action: "ghost_wallet_withdraw",
      chainId: ARC_CHAIN_ID,
      token: body.token,
      amountAtomic: atomic(body.amount, tok.decimals),
      recipient: body.recipient,
      prepare: {
        kind: "unshield",
        call: { function: "unshield(address asset, uint256 amount, address recipient)", args: { asset: tok.address, recipient: body.recipient } },
        relayer: "submit via the relayer so the relayer is msg.sender; your wallet never broadcasts",
      },
      note: "Use a fresh recipient + a denomination amount; amounts are public on exit. For a denominated private exit you can also route through the 0xbow ghost pools (get__api_ghost_pools).",
      privacyNotice: GHOST_WALLET_NOTICE,
    });
  });

// ── trade: execute a perp FROM the shielded balance (the headline) ───────────
const ghostWalletTrade = route
  .post("/ghost-wallet/trade")
  .body(
    z.object({
      symbol: zSymbol,
      side: zSide,
      sizeUsdc: z.string().regex(/^\d+(\.\d+)?$/),
      leverage: zLeverage,
      trader: zAddress,
    }),
  )
  .meta({
    mcp: {
      title: "Ghost Wallet — Private Trade",
      description:
        "Open a forex-perp position PRIVATELY, funded from your Ghost trade balance. Build the order with post__api_trade_prepare, then this wraps it as a shielded execution: the relayer submits it from a detached executor (your wallet is not the trader on-chain), USDC margin is pulled from your shielded balance, and the position resolves back to you privately. The position is still visible on the matcher; WHO and HOW MUCH are hidden. Returns the shielded-execution shape to sign.",
    },
  })
  .handle(async ({ body }) => {
    const usdc = ARC_TOKENS.USDC;
    const marginAtomic = atomic(body.sizeUsdc, usdc.decimals);
    return ok({
      action: "ghost_wallet_trade",
      chainId: ARC_CHAIN_ID,
      symbol: body.symbol,
      side: body.side,
      leverage: body.leverage,
      prepare: {
        kind: "execute",
        step1: "Call post__api_trade_prepare(symbol, side, sizeUsdc, leverage, trader=<your shielded execution address>) to get the order digest + typedData.",
        step2: "This wraps that order as a shielded execution funded from your Ghost USDC balance.",
        shieldedAction: {
          target: "TelaranaFxOrderSettlement (Arc)",
          funding: [{ token: usdc.address, amount: marginAtomic, why: "USDC margin pulled from your shielded balance" }],
          executor: "<detached executor — NOT your wallet; resolves to you privately>",
          settleBackToken: usdc.address,
        },
        authorization: "sign the shielded-execution op; the relayer broadcasts so your wallet is never the on-chain trader",
      },
      note: "Margin is hidden (funded from the shielded balance); your identity is detached; PnL settles back into the Ghost balance. The order on the matcher is public — this hides who placed it and how it's funded, not that it exists.",
      privacyNotice: GHOST_WALLET_NOTICE,
    });
  });

export default new Hyper({ prefix: "/api" }).use([
  ghostWalletBalance,
  ghostWalletDeposit,
  ghostWalletWithdraw,
  ghostWalletTrade,
]);
