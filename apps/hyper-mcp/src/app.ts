import { initSentry, instrumentMcpCall, Sentry } from "./sentry.ts";
initSentry();

import { Hyper, ok, route } from "@hyper/core";
import { hyperLog } from "@hyper/log";
import { corsPlugin } from "@hyper/cors";
import { authJwtPlugin } from "@hyper/auth-jwt";
import { rateLimit } from "@hyper/rate-limit";
import { compress } from "@hyper/compress";
import { idempotency } from "@hyper/idempotency";
import { openapiPlugin, openapiHandlers } from "@hyper/openapi";
import { zodConverter } from "@hyper/openapi-zod";
import { mcpServer } from "@hyper/mcp";
import { z } from "zod";

async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  opts: { expiresIn?: string } = {},
): Promise<string> {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = opts.expiresIn === "30d" ? 30 * 86400 : 86400;
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const payloadB64 = btoa(JSON.stringify(body))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payloadB64}`));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${header}.${payloadB64}.${sigB64}`;
}

import markets from "./routes/markets.ts";
import quote from "./routes/quote.ts";
import trade from "./routes/trade.ts";
import positions from "./routes/positions.ts";
import portfolio from "./routes/portfolio.ts";
import spot from "./routes/spot.ts";
import lending from "./routes/lending.ts";
import leaderboard from "./routes/leaderboard.ts";
import reputation from "./routes/reputation.ts";
import ghost from "./routes/ghost.ts";
import bonds from "./routes/bonds.ts";
import copyTrading from "./routes/copy-trading.ts";
import stream from "./routes/stream.ts";
import oracle from "./routes/oracle.ts";
import vault from "./routes/vault.ts";
import hedge from "./routes/hedge.ts";
import fxswap from "./routes/fxswap.ts";
import registryRoutes from "./routes/registry.ts";
import perpsExtra from "./routes/perps.ts";
import lendingExec from "./routes/lending-exec.ts";

// Defined before llmsTxt so the Connect section renders the real deployed URL
// (BUFI_MCP_URL on prod = https://mcp.bu.finance) instead of a hardcoded localhost.
const port = Number(process.env.PORT ?? 4002);
const baseUrl = process.env.BUFI_MCP_URL ?? `http://localhost:${port}`;

const llmsTxt = `# BUFI HYPER — Trading Infrastructure for AI Agents

> Forex perpetual futures, spot FX, and lending/borrowing on Arc (Circle L1)
> MCP-native. 2-call trading. Sub-second settlement. Up to 50x leverage.

## Quick Trade (2 calls, <3 seconds)
1. post__api_trade_prepare(symbol="EURC/USDC", side="long", sizeUsdc="5", leverage=2, trader="0x...")
   → returns { quote, order: { digest, typedData }, costEstimate }
2. Sign the digest with your wallet, then:
   post__api_trade_execute(symbol, trader, side, sizeUsdc, leverage, deadline, nonce, signature)
   → returns { intent, streamUrl }

## Quick Close (2 calls)
1. post__api_close_prepare(symbol="EURC/USDC", side="long", sizeUsdc="5", trader="0x...")
   → returns { order: { digest, typedData, reduceOnly: true } }
2. post__api_trade_execute(..., reduceOnly=true, signature)

## Spot Buy (1 call)
post__api_spot_buy(symbol="EURC", trader="0x...", amountUsdc="100")
  → returns { expectedOut, minAmountOut, slippageBps, digest, typedData }
  // Pass only the human USDC amount. The server fetches the live price and
  // derives expectedOut + the slippage-protected minAmountOut for you
  // (default slippageBps=100 = 1%). Override with slippageBps, or pin an
  // explicit minAmountOut (atomic) if you want exact control. No pre-quote
  // needed — post__api_spot_quote is optional, just for previewing a price.
  // The response also includes a "preflight" block (USDC balance + router
  // allowance on Fuji): if hasSufficientAllowance is false, approve the spender
  // it names BEFORE signing, or the on-chain order will revert.

## Supply & Earn Yield
1. get__api_lending_markets → list markets (GLOBAL pool state — totals/utilization,
   not your balances). NOTE: markets are identified by raw loanToken/collateralToken
   addresses (no symbol label yet), and the response carries raw Morpho state, not a
   derived APY field — compute yield from utilization + IRM if you need a number.
2. post__api_lending_supply(marketId, trader="0x...", amount="100")
   → a logical envelope { action, market, deadline, nonce }. For SIGNABLE on-chain
   calldata use the prepare variant: post__api_lending_supply_prepare (and
   borrow/repay/withdraw have matching *_prepare tools) → returns
   { contract: { address, function, args }, approvalNeeded }.
3. get__api_lending_positions/{address} → YOUR supplied/borrowed balances per market.
   (markets is global; this is the per-wallet read. The two are different calls.)

KNOWN LIMITATIONS (lending, as of this build — do not be surprised):
- markets currently lists Fuji-hub markets (hubChainId 43113) while the *_prepare
  tools resolve Arc Morpho (5042002), so a marketId from markets may be rejected by
  prepare ("not found on any Arc Morpho"). Treat the prepare path as in-progress.
- borrow_preview may return { error: "borrow preview unavailable" } when the on-chain
  quote reader is not configured — it cannot always return a health factor yet.

## Reading a wallet's holdings
- One call: get__api_portfolio/{address} → { perp, lending } together.
- Or per-product: get__api_positions/{address} (perp), get__api_lending_positions/{address}.
- Spot holdings are plain wallet token balances (read on-chain).
- Shielded/ghost balances are not readable via HTTP. Ghost privacy depends on FIXED DENOMINATIONS: amounts are public on-chain (unavoidable), so deposits/withdrawals are constrained to a shared set (stablecoins 1/10/100/1000/10000; cirBTC 0.001/0.01/0.1/1). This is ENFORCED ON-CHAIN — the FxPrivacyEntrypoint reverts off-denomination deposits and withdrawals — and mirrored by the MCP (it refuses to prepare off-denomination deposits). That shared bucket is what gives an anonymity set. The ZK layer hides the merkle link; denominations stop the amount from re-linking it. Also note: a single MCP operator that serves both /ghost/deposit and /ghost/relay can correlate the two legs off-chain by timing and amount — for real depositor-recipient unlinkability, split operators (deposit-advice vs relay-submission) or run your own. Each ghost response carries a privacyNotice with the current limits.

## Borrow Against Collateral
1. post__api_lending_borrow_preview(marketId, collateralAmount, borrowAmount)
   → health factor + borrow APY WHEN the on-chain quote reader is configured;
   may return { error: "borrow preview unavailable" } otherwise (see limitations above).
2. post__api_lending_borrow(marketId, trader="0x...", borrowAmount, collateralAmount)
   (signable calldata: post__api_lending_borrow_prepare)

## Acting-wallet param (the name VARIES by product family — read this)
On spot, perp, lending, and ghost the acting wallet is trader="0x..." (legacy
aliases supplier/borrower/depositor/recipient still work for back-compat). This
rule does NOT hold everywhere — other families use a fixed name, and passing
"trader" there returns a 400. Per-family names:
- LP / vault (lp/deposit, lp/withdraw, lp/claim): "lp"  (the GET reads take "address")
- Copy-trading (copy/follow, copy/unfollow): "follower" (and "leader" for the target)
- Bonds (bonds/stake): "follower"
- Reputation register + auth/token: "address"
- Reputation feedback: "raterWalletUuid" (a Circle wallet UUID, NOT a 0x address)
When unsure, read the tool's inputSchema in tools/list — the required wallet
field is named there per endpoint.

## Markets
- Perps: EURC/USDC, JPYC/USDC, MXNB/USDC, CIRBTC/USDC, AUDF/USDC, QCAD/USDC
  (authoritative live list: get__api_markets — query it rather than trusting this static list)
- Up to 50x leverage, EIP-712 signed intents, Pyth oracle prices
- Spot: EURC, JPYC, MXNB (buy with USDC)
- Lending: supply USDC to earn yield, borrow FX tokens against collateral

## Spot vs Perp — pick the right endpoint (READ THIS, the families do NOT overlap)
There are two separate product families on two different chains. They are NOT
interchangeable; do not substitute one for the other.

| You want… | Use | Settlement domain | chainId | Symbol format |
|---|---|---|---|---|
| A leveraged position (long/short, margin) | post__api_trade_prepare → sign → post__api_trade_execute | TelaranaFxOrderSettlement | 5042002 (Arc) | pair, e.g. "EURC/USDC" |
| Price for a perp | post__api_quote | — | 5042002 | pair, e.g. "EURC/USDC" |
| To buy an FX token outright with USDC (no leverage) | post__api_spot_buy | BUFX Venue Request Router | 43113 (Fuji) | bare token, e.g. "EURC" |
| Price for a spot buy | post__api_spot_quote | — | 43113 | bare token, e.g. "EURC" |
| To swap one FX token for another directly (cross-currency, unshielded, no leverage) | get__api_fxswap_quote -> get__api_fxswap_intent_shape -> sign -> FxRouter.executeIntent | FxSwapHook / FxRouter | 5042002 (Arc) | asset, e.g. "AUDF" + side buy/sell |

- Perp endpoints take the pair symbol ("EURC/USDC"). Spot endpoints take the bare token ("EURC").
- post__api_quote (perp) and post__api_spot_quote (spot) are different products, not duplicates. Choose by whether you want leverage.
- A spot buy does NOT route through /api/trade/*. Use post__api_spot_buy. Conversely, perps do NOT route through /api/spot/*.

## Defaults (omit unless overriding)
- chainId: 5042002 (Arc Testnet — only chain, never specify)
- orderType: "market" (default)
- leverage: 1 (default)
- ttl: 3600 seconds (1 hour deadline)
- reduceOnly: false
- Nonce and deadline: auto-generated by prepare tools

## Human-Readable Inputs
- Use symbol ("EURC/USDC") not marketId ("0x565a...")
- Use sizeUsdc ("5") not sizeDelta ("5000000")
- Use side ("long"/"short") not direction flags
- The MCP handles all conversions internally

## Pre-Flight Cost Check
post__api_cost(symbol, side, sizeUsdc, leverage)
→ { margin, fee, x402Fee, gasCost, total }

## Common Errors & Recovery
- "Unknown symbol" → use get__api_markets to see valid symbols
- "nonce already used" → retry (nonce is auto-generated)
- "wallet session required" → sign session typed-data headers
- "insufficient margin" → reduce sizeUsdc or leverage

## Agent Capabilities
Read (free): markets, quotes, positions, funding rates, lending APYs, leaderboard, reputation, AND the full protocol-data surface below (oracle mids, vault depths, LP/vault info, hedge neutrality, FX-swap pools, asset registry, perps margin, cross-hub gateway)
Trade (x402 $0.001-$0.005): perp open/close, spot buy, supply, borrow, repay, withdraw

## Protocol Data (read-only, free, no signature)
Live on-chain state of every protocol family — the same data the /protocol console renders.
All GET/read tools; numbers come back as JSON strings, so parse them before math.
- get__api_oracle_price(base="EURC", quote="USDC") -> { mid, stale, ageSeconds }. FX mid from FxOracleV2 (Pyth -> RedStone -> Chainlink). base/quote are token symbols.
- get__api_vault_depths() -> { totalJuniorUsdc, seniorUsdcHot, juniorTokenBalances{} }. SharedFxVault depth. totalJuniorUsdc is USD-denominated; juniorTokenBalances are RAW token amounts (not USD) — price them yourself if you need USD.
- get__api_lp_info() -> { compositeApyPercent, totalDeposits, feeSplit{protocolBps,lpBps,insuranceBps} }. TurboFeeVault composite-APY LP. feeSplit is 50/40/10. compositeApyPercent is null until live (treat as 0/"—").
- get__api_lp_position(address="0x...") -> { pendingYield } for one wallet.
- get__api_hedge_pools() -> { pools[]{ symbol, poolId, currency0, currency1, fee } }. FxHedgeHook delta-neutral pools. fee is hundredths-of-a-bip (100 = 1 bps). There is NO "pair" field — the human pair is symbol vs USDC (currency0 0x3600... is native USDC on Arc).
- get__api_hedge_status(poolId="0x...") -> { currentDelta, isDeltaNeutral }. Live neutrality of one pool.
- get__api_fxswap_pools() -> { pools[]{ asset, pair, fee, pyth } }. FxRouter cross-currency pools. pyth is a feed LABEL (e.g. "AUD/USD"), not a price; pools carry no reserves. pair orientation varies (mostly USDC/<asset>).
- get__api_fxswap_quote(asset="EURC", amountIn="100", side="buy") -> { amountOut, spreadBps, tradableOut }.
- get__api_registry_assets() -> { count, assets[]{ symbol, decimals, enabled } }. AssetRegistry — the on-chain ASSET catalog. NOTE: this is the tradable-asset registry, distinct from the ERC-8004 IDENTITY registries below.
- get__api_perps_account(address="0x...") -> { totalMargin, reservedMargin, freeMargin } for one wallet (FxMarginAccount). There is no global perp-TVL endpoint; margin is per-wallet.
- get__api_gateway_info() -> { gatewayBalance, withdrawalUnlockBlock }. FxGatewayHook cross-hub USDC (Circle Gateway). withdrawalUnlockBlock "0" = no pending withdrawal.

## Web Surfaces (point humans here)
- Live protocol console — a read-only dashboard of every family above (oracle/vault/LP/hedge/fxswap/registry/perps/gateway): https://fx.bu.finance/protocol
- Agent setup docs — connect snippet + copy-paste example prompts (incl. a hedged delta-neutral trade): https://fx.bu.finance/ai

## ERC-8004 Agent Identity (Arc Testnet)
- IdentityRegistry: 0x8004A818BFB912233c491871b3d84c89A494BD9e
- ReputationRegistry: 0x8004B663056A597Dffe9eCcC1965A193B7388713
- ValidationRegistry: 0x8004Cb1BF31DAf7788923b405b754f57acEB4272
- Score: 0-100 from peer ratings (1-5 stars × 20)
- Every trader gets an onchain identity NFT

## Ghost Mode — maximizing privacy today
Honest framing: the amount is necessarily PUBLIC on a transparent chain. The
pool settles via token.transfer(recipient, amount) and the Groth16 circuit
exposes withdrawnValue as a public signal, so amounts cannot be hidden — only
made non-identifying. The lever is FIXED DENOMINATIONS: every deposit and
withdrawal is one of a small shared set, so a withdrawal no longer uniquely
amount-matches one deposit. This is ENFORCED ON-CHAIN — the FxPrivacyEntrypoint
reverts off-denomination deposits and withdrawals — and mirrored by the MCP,
which refuses to prepare off-denomination deposits. The Groth16 proof hides
WHICH deposit a withdrawal spends; denominations stop the public amount from
re-linking it. Your anonymity set is the number of other deposits sharing your
denomination (grows with volume).

What an agent must do for the strongest privacy today:
1. Use a fixed DENOMINATION. Stablecoins (USDC/EURC/MXNB/QCAD/AUDF):
   1 / 10 / 100 / 1000 / 10000. cirBTC: 0.001 / 0.01 / 0.1 / 1. Split a larger
   amount into several denomination deposits/withdrawals. An off-denomination
   amount is a fingerprint that collapses your set to 1 — the MCP rejects it on
   deposit, and ghost_privacy_check flags it on your plan.
2. Submit withdrawals via the relayer. Each ghost_relay / ghost_swap response
   carries a relayerSubmission block — POST the signed proof to that endpoint
   so the RELAYER is msg.sender. Self-submitting makes YOUR wallet the on-chain
   gas-payer, which directly deanonymizes the recipient side. Always prefer the
   relayer when available.
3. Use a FRESH recipient address for every withdrawal. Reusing one address
   clusters all your withdrawals together and re-links them to deposits.
4. Delay between deposit and withdrawal. Depositing and withdrawing in adjacent
   blocks is a timing correlation that links the two legs even within a
   denomination. Wait, and let other deposits land in between.
5. Prefer same-asset relay over cross-currency. Same-asset relay() leaks the
   least. Cross-currency (ghost_swap / relayCrossCurrency) is LIVE on-chain but
   emits both amountIn and amountOut at a fixed rate, so the source amount is
   recoverable across assets — it leaks strictly more. Prefer same-asset.

Run ghost_privacy_check on your PLAN first: it scores all of the above and flags
an off-denomination amount, reused recipient, self-submit, or short delay before
you commit anything on-chain.

Reminder: the deposit event itself is always public (depositor + amount). The
above reduces how easily the WITHDRAWAL re-links to that deposit; it cannot
hide the deposit.

### Constructing a ghost proof (deposit -> withdraw, end to end)
1. Deposit. Pick your own random nullifier and secret (two field elements). The
   precommitment you pass on-chain is Poseidon([nullifier, secret]) — a Poseidon
   hash, NOT snarkjs. On deposit the pool stores your leaf commitment =
   Poseidon([value, label, precommitment]). Store nullifier + secret offline;
   they are unrecoverable and are required to withdraw.
2. Wait for the tree root. The withdrawal proof is verified against the pool's
   current merkle root — read it from get__api_ghost_pools (latestRoot). If
   latestRoot is null the ASP has not published a root yet and NO proof can be
   built; wait until it is non-null.
3. Build the Groth16 withdrawal proof client-side with snarkjs against the
   privacy-pool withdraw circuit. It proves merkle inclusion of your commitment
   (using your leaf's siblings), nullifier uniqueness, and binds recipient + fee
   + scope — without revealing which leaf is yours. Inputs: your stored nullifier
   and secret, value, label, the merkle root + leaf siblings, and the withdrawal
   context (recipient, feeRecipient, relayFeeBPS). Output is pA/pB/pC + 8 pubSignals.
   The leaf siblings (your commitment's inclusion path) are NOT served by this MCP:
   rebuild the LeanIMT by scanning the entrypoint's Deposited events from chain
   (or use the SDK data service), then generate the path for your leaf.
4. Circuit artifacts are PUBLIC. The withdraw circuit is the 0xbow privacy-pools-core
   Groth16 circuit pinned at commit a80836a47451e662f127af17e11430ffa976c234. Fetch
   the artifacts and run snarkjs directly against them:
     wasm: https://raw.githubusercontent.com/0xbow-io/privacy-pools-core/a80836a47451e662f127af17e11430ffa976c234/packages/circuits/build/withdraw/withdraw_js/withdraw.wasm
     zkey: https://raw.githubusercontent.com/0xbow-io/privacy-pools-core/a80836a47451e662f127af17e11430ffa976c234/packages/circuits/trusted-setup/final-keys/withdraw.zkey
   (commitment.wasm/.zkey sit alongside for the deposit precommitment.) The
   fx-Telarana privacy SDK (@bu/fx-engine /privacy: Poseidon commitments + a
   UrlCircuits loader) and @bu/privacy-prover (snarkjs) wrap this with the correct
   signal ordering, but are currently internal packages — the circuit itself is
   public, so you can prove without them. Do NOT invent the signal ordering; mirror
   the 0xbow withdraw circuit.
5. Submit. Run post__api_ghost_privacy_check first to score linkability, then POST
   the proof to the relayer endpoint from the ghost_relay / ghost_swap
   relayerSubmission block so the RELAYER (not your wallet) is msg.sender.

## Copy-Trading & Performance Bonds
Mirror a top trader, or post a bond as a leader. These are fully live but were not
in the quick flows above.
- get__api_leaderboard -> ranked traders (Nansen-compatible shape; count field total_traders)
- get__api_copy_discover -> leaders open for mirroring (count field totalDiscovered)
- get__api_copy_leader/{address} -> one leader's stats
- post__api_copy_follow(follower="0x...", leader="0x...", sizeCapUsdc, leverageCap, symbols?)
  -> activates server-side mirroring of the leader's perp positions. This is a LIVE
  mutation, NOT a prepare — there is no dry-run; calling it starts mirroring.
- post__api_copy_unfollow(follower, leader) -> stop mirroring
- get__api_copy_status/{follower} -> your active relationships
Performance bonds (ERC-8183): a leader locks USDC, slashed proportionally if PnL
falls below a threshold.
- get__api_bonds -> active bonds
- post__api_bonds_create(trader, bondAmountUsdc, durationDays, performanceThresholdPct, description)
- post__api_bonds_stake(bondId, follower, stakeAmountUsdc) ; post__api_bonds_evaluate(bondId)
NOTE: bonds create/stake currently return a logical registry stub (a bondId + prose),
NOT signable escrow calldata — treat bonds as an off-chain registry for now.

## LP / Provide Liquidity (TurboFeeVault)
Earn protocol + trading-fee + hedge yield by depositing into the fee vault (ERC-4626).
This is a DIFFERENT product from lending supply.
- get__api_lp_info -> vault address, fee split (protocolBps/lpBps/insuranceBps), composite APY
- get__api_vault_depths -> junior/senior depth
- get__api_lp_position?address=0x... -> your shares + pending yield
- post__api_lp_deposit(lp="0x...", amount="100") -> ERC-4626 deposit calldata + USDC approve preflight
- post__api_lp_withdraw(lp="0x...", shares) ; post__api_lp_claim(lp="0x...")
The acting-wallet field here is "lp" (not "trader"); the GET reads take "address".

## FX Swap (cross-currency, direct + unshielded)
Swap one FX token for another with NO leverage and NO ghost shield. This is the plain
version of ghost_swap (ghost_swap is the SHIELDED variant of the same swap — they are
related, not unrelated).
- get__api_fxswap_pools -> live pools (AUDF/MXNB/QCAD/EURC) + router address
- get__api_fxswap_quote?asset=AUDF&side=sell&amountIn=50 -> amountOut, spreadBps, tradableOut
- get__api_fxswap_intent_shape -> the exact FxRouter.executeIntent(...) signature + the full
  FxIntent EIP-712 struct to sign; sign it, then submit to executeIntent.
amountIn is a human-decimal string. side=buy means buy the named asset with USDC; side=sell
means sell the named asset for USDC.

## Hedge pools
Delta-neutral LP hedging that backs the FX pools.
- get__api_hedge_pools -> pools (each note chains you to status?poolId=<id>)
- get__api_hedge_status?poolId=<id> -> currentDelta, isDeltaNeutral

## Infra / Reads (integration facts — all free GETs)
Not in the trade flows above, but the canonical source for addresses + prices:
- get__api_oracle_price?base=EURC&quote=USDC -> mid, midE18, stale, ageSeconds
- get__api_oracle_info -> supported tokens + staleness config
- get__api_registry_assets -> assets (bytes32 key, decimals, strategyId, home chain). The
  ERC-20 address is NOT inline — resolve it per token via:
- get__api_registry_asset_address?symbol=EURC&chainId=5042002
- get__api_registry_routes?in=EURC&out=USDC -> resolved tokenIn/tokenOut + route count
- get__api_gateway_info -> bridge/gateway config

## Reputation API (ERC-8004) — the endpoints
Registry addresses + the score formula are listed below; the live endpoints are:
- post__api_reputation_register(address="0x...", source) -> unsigned mint contract call.
  The agentId used by the reads below IS this same EVM address (NOT an ERC-721 tokenId).
- get__api_reputation_check/{address} -> registered? (use before trading)
- get__api_reputation_score/{agentId} -> 0-100 score (agentId = the EVM address)
- get__api_reputation_identity/{agentId} -> identity record
- post__api_reputation_feedback(raterWalletUuid, ...) -> rate a counterparty
  (raterWalletUuid is a Circle wallet UUID; feedback submission needs the internal SDK).

## Connect
- MCP: ${baseUrl}/mcp
- OpenAPI: ${baseUrl}/openapi.json
- Install: claude mcp add --transport http bufi-hyper ${baseUrl}/mcp

## Authentication
- Open mode (default): no auth required — all tools accessible (hackathon/testnet)
- JWT mode: set BUFI_JWT_SECRET, agents authenticate via Authorization: Bearer <token>
  - Token payload: { sub: "0xwalletAddress", scope: "trade read" }
  - Issue tokens scoped to wallet address — no session signatures needed
- Rate limit: 120 requests/minute per IP (standard RateLimit-* headers)

## Settlement
- Chain: Arc Testnet (chainId 5042002, sub-second finality)
- Gas: ~$0.01 USDC (USDC is native gas token)
- Oracle: Pyth Network (real-time forex feeds)
- Wallet: Circle Agent Wallet (circle CLI) — supports ERC-1271
`;

const tokenRoute = route
  .post("/auth/token")
  .body(
    z.object({
      address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      scope: z.string().default("read trade"),
    }),
  )
  .meta({
    mcp: {
      title: "Issue API Key",
      description:
        "Issue a JWT API key for an agent wallet. The token authenticates all subsequent MCP calls — no session signatures needed. Scope: 'read' (free tools) or 'read trade' (all tools).",
    },
  })
  .handle(async ({ body }) => {
    const secret = process.env.BUFI_JWT_SECRET ?? process.env.JWT_SECRET;
    if (!secret) {
      return ok({
        mode: "open",
        note: "No JWT secret configured — all tools are accessible without auth (testnet mode).",
      });
    }
    const token = await signJwt(
      { sub: body.address, scope: body.scope },
      secret,
      { expiresIn: "30d" },
    );
    return ok({
      token,
      address: body.address,
      scope: body.scope,
      expiresIn: "30d",
      usage: `Authorization: Bearer ${token}`,
    });
  });

// Single source of truth for schema conversion. Feeds BOTH the OpenAPI spec
// (/openapi.json) and the MCP manifest (tools/list inputSchema) so the two
// never drift and every route self-describes by default — add a converter
// here once and both surfaces pick it up. zodConverter understands our zod
// bodies incl. .refine()/.transform() wrappers (see openapi-zod).
const SCHEMA_CONVERTERS = [zodConverter];

const llmsRoute = route.get("/llms.txt").handle(() => {
  return new Response(llmsTxt, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
});

const health = route.get("/health").handle(() => ok({ ok: true, ts: Date.now() }));

const jwtSecret = process.env.BUFI_JWT_SECRET ?? process.env.JWT_SECRET;

const hyper = new Hyper()
  .use(hyperLog({ service: "bufi-hyper" }))
  .use(corsPlugin({ origin: "*", allowAnyOrigin: true }))
  .use(compress())
  .use(rateLimit({ limit: 120, window: "1m" }))
  .use(idempotency())
  .use(openapiPlugin({ converters: SCHEMA_CONVERTERS }))
  .use([health, llmsRoute, tokenRoute])
  .use(markets)
  .use(quote)
  .use(trade)
  .use(positions)
  .use(portfolio)
  .use(spot)
  .use(lending)
  .use(leaderboard)
  .use(reputation)
  .use(ghost)
  .use(bonds)
  .use(copyTrading)
  .use(stream)
  .use(oracle)
  .use(vault)
  .use(hedge)
  .use(fxswap)
  .use(registryRoutes)
  .use(perpsExtra)
  .use(lendingExec);

// JWT auth is opt-in: when BUFI_JWT_SECRET is set, agents authenticate
// via `Authorization: Bearer <token>` and get ctx.user with { sub, scope }.
// When unset, all routes are open (hackathon/testnet mode).
if (jwtSecret) {
  hyper.use(authJwtPlugin({ secret: jwtSecret, allowShortSecret: true }));
}


const hyperApp = hyper.build();
// Expand each tool's `body` into a real JSON Schema (properties + required +
// types) in the MCP manifest, instead of an opaque `{ type: "object" }`. This
// is what lets a fresh client see that e.g. `sizeUsdc` is a string and
// `deadline` is a number without trial-and-error. Reuses the same zod
// converter the OpenAPI plugin uses; core stays validator-agnostic.
const mcp = mcpServer(hyperApp, {
  manifest: hyperApp.toMCPManifest((schema) =>
    SCHEMA_CONVERTERS[0]!.toJsonSchema(schema) as Record<string, unknown>,
  ),
});

// Rich OpenAPI generator (inlines converted body/response schemas + examples).
// The core app.toOpenAPI() is a placeholder that emits dangling Body refs, so we
// serve /openapi.json from here instead, sharing the one SCHEMA_CONVERTERS source.
const openapi = openapiHandlers(hyperApp, {
  converters: SCHEMA_CONVERTERS,
  title: "BUFI HYPER MCP",
  description:
    "Trading infrastructure for AI agents — forex perps, spot FX, lending, cross-currency FX swaps, LP/vault, copy-trading, performance bonds, reputation (ERC-8004), and privacy pools on Arc (Circle L1). Per-operation summaries/descriptions mirror the MCP tools/list manifest. See /llms.txt for end-to-end flows.",
});

const mcpLandingPage = {
  endpoint: `${baseUrl}/mcp`,
  protocol: "json-rpc-2.0",
  methods: ["initialize", "tools/list", "tools/call"],
  tools: mcp.listTools(),
  llmsTxt: `${baseUrl}/llms.txt`,
  openapi: `${baseUrl}/openapi.json`,
  console: "https://fx.bu.finance/protocol",
  docs: "https://fx.bu.finance/ai",
  snippet: {
    "claude-code": `claude mcp add --transport http bufi-hyper ${baseUrl}/mcp`,
    ".mcp.json": {
      mcpServers: {
        "bufi-hyper": { type: "url", url: `${baseUrl}/mcp` },
      },
    },
    "cursor / windsurf": {
      mcpServers: {
        "bufi-hyper": {
          command: "npx",
          args: ["-y", "mcp-remote", `${baseUrl}/mcp`, "--allow-http"],
        },
      },
    },
  },
};

export default {
  port,
  async fetch(req: Request) {
    const url = new URL(req.url);

    if (url.pathname === "/" && req.method === "GET") {
      return new Response(JSON.stringify({
        name: "BUFI HYPER",
        description: "Trading infrastructure for AI agents — forex perps, spot FX, lending, privacy pools on Arc",
        mcp: `${baseUrl}/mcp`,
        llmsTxt: `${baseUrl}/llms.txt`,
        openapi: `${baseUrl}/openapi.json`,
        health: `${baseUrl}/health`,
        console: "https://fx.bu.finance/protocol",
        docs: "https://fx.bu.finance/ai",
        tools: mcp.listTools().length,
        connect: `claude mcp add --transport http bufi-hyper ${baseUrl}/mcp`,
      }, null, 2), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/openapi.json" && req.method === "GET") {
      // Served by the rich generator so request/response bodies carry real
      // schemas (properties, types, required) instead of dangling Body refs.
      return openapi.spec(req);
    }

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      if (req.method === "GET") {
        const accept = req.headers.get("accept") ?? "";
        if (accept.includes("text/event-stream")) {
          return mcp.handle(req);
        }
        return new Response(JSON.stringify(mcpLandingPage, null, 2), {
          headers: { "content-type": "application/json" },
        });
      }
      if (req.method === "DELETE") {
        return mcp.handle(req);
      }
      let toolName = "unknown";
      try {
        const cloned = req.clone();
        const body = await cloned.json().catch(() => ({})) as { method?: string; params?: { name?: string } };
        if (body.method === "tools/call" && body.params?.name) {
          toolName = body.params.name;
        }
      } catch {}
      return instrumentMcpCall(toolName, null, () => mcp.handle(req));
    }
    return Sentry.withIsolationScope(() => hyperApp.fetch(req));
  },
};

setTimeout(async () => {
  const { livePerpsMarkets } = await import("@bufi/perps");
  const { perpsService } = await import("./services.ts");
  const markets = livePerpsMarkets(5042002);
  for (const m of markets.slice(0, 2)) {
    await perpsService.quote({ chainId: 5042002, marketId: m.marketId, side: "long", sizeUsdc: "1", sizeDelta: "1000000", leverage: 1 }).catch(() => {});
  }
  console.log(`  Oracle warmed for ${Math.min(2, markets.length)} markets`);
}, 100);

console.log(`BUFI HYPER MCP Gateway listening on :${port}`);
console.log(`  MCP:     http://localhost:${port}/mcp`);
console.log(`  OpenAPI: http://localhost:${port}/openapi.json`);
console.log(`  llms:    http://localhost:${port}/llms.txt`);
