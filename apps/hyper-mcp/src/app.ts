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
1. get__api_lending_markets → see APYs (GLOBAL — pool totals, not your balances)
2. post__api_lending_supply(marketId, trader="0x...", amount="100")
   → returns { action: "supply", market, deadline, nonce }
3. get__api_lending_positions/{address} → YOUR supplied/borrowed balances + health factor per market.
   (markets is global; this is the per-wallet read. The two are different calls.)

## Reading a wallet's holdings
- One call: get__api_portfolio/{address} → { perp, lending } together.
- Or per-product: get__api_positions/{address} (perp), get__api_lending_positions/{address}.
- Spot holdings are plain wallet token balances (read on-chain).
- Shielded/ghost balances are not readable via HTTP. NOTE: ghost privacy is currently WEAK — deposits and withdrawals are amount-linkable (the ZK layer hides the merkle link, not amounts). Do not rely on it for unlinkability yet. Also note: a single MCP operator that serves both /ghost/deposit and /ghost/relay can correlate the two legs off-chain by timing and amount even when the on-chain link is hidden — for real depositor-recipient unlinkability, split operators (deposit-advice vs relay-submission) or run your own. Each ghost response carries a privacyNotice with the current limits.

## Borrow Against Collateral
1. post__api_lending_borrow_preview(marketId, collateralAmount, borrowAmount) → check health factor
2. post__api_lending_borrow(marketId, trader="0x...", borrowAmount, collateralAmount)

## Acting-wallet param: always "trader"
Every endpoint that needs the acting wallet accepts trader="0x...". Legacy
aliases (supplier/borrower/depositor/recipient) still work for back-compat, but
prefer "trader" everywhere — one name across spot, perp, lending, and ghost.

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
Read (free): markets, quotes, positions, funding rates, lending APYs, leaderboard, reputation
Trade (x402 $0.001-$0.005): perp open/close, spot buy, supply, borrow, repay, withdraw

## ERC-8004 Agent Identity (Arc Testnet)
- IdentityRegistry: 0x8004A818BFB912233c491871b3d84c89A494BD9e
- ReputationRegistry: 0x8004B663056A597Dffe9eCcC1965A193B7388713
- ValidationRegistry: 0x8004Cb1BF31DAf7788923b405b754f57acEB4272
- Score: 0-100 from peer ratings (1-5 stars × 20)
- Every trader gets an onchain identity NFT

## Ghost Mode — maximizing privacy today
Honest framing: Ghost Mode privacy is WEAK right now. The Groth16 proof hides
WHICH deposit a withdrawal spends, but amounts are public and arbitrary, so a
withdrawal is linkable to its deposit by amount-matching — anonymity set is
near 1 at current volume. These knobs are mitigation, NOT unlinkability. Do not
rely on Ghost Mode for confidentiality until fixed denominations ship.

What an agent CAN control today to reduce linkability:
1. Submit withdrawals via the relayer. Each ghost_relay / ghost_swap response
   carries a relayerSubmission block — POST the signed proof to that endpoint
   so the RELAYER is msg.sender. Self-submitting makes YOUR wallet the on-chain
   gas-payer, which directly deanonymizes the recipient side. Always prefer the
   relayer when available.
2. Use a FRESH recipient address for every withdrawal. Reusing one address
   clusters all your withdrawals together and re-links them to deposits.
3. Use round-number amounts (e.g. 100, 500, 1000) to blend into the set.
   Unique high-precision amounts (e.g. 743.218901) are fingerprints — they
   amount-match a single deposit and collapse the set to 1.
4. Delay between deposit and withdrawal. Depositing and withdrawing in adjacent
   blocks is a timing correlation that links the two legs even without amount
   matching. Wait, and let other deposits land in between.
5. Prefer same-asset relay over cross-currency. Same-asset relay() leaks the
   least. Cross-currency (ghost_swap / relayCrossCurrency) is now LIVE on-chain
   (the swap adapter is wired into the entrypoint — no longer reverts) BUT it
   emits both amountIn and amountOut at a fixed rate, so the source amount is
   recoverable across assets — it leaks strictly more. Prefer same-asset for
   privacy.

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
});

const mcpLandingPage = {
  endpoint: `${baseUrl}/mcp`,
  protocol: "json-rpc-2.0",
  methods: ["initialize", "tools/list", "tools/call"],
  tools: mcp.listTools(),
  llmsTxt: `${baseUrl}/llms.txt`,
  openapi: `${baseUrl}/openapi.json`,
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
