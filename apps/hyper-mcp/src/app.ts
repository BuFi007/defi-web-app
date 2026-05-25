import { Hyper, ok, route } from "@hyper/core";
import { hyperLog } from "@hyper/log";
import { corsPlugin } from "@hyper/cors";
import { openapiPlugin } from "@hyper/openapi";
import { zodConverter } from "@hyper/openapi-zod";
import { mcpServer } from "@hyper/mcp";

import markets from "./routes/markets.ts";
import quote from "./routes/quote.ts";
import trade from "./routes/trade.ts";
import positions from "./routes/positions.ts";
import spot from "./routes/spot.ts";
import lending from "./routes/lending.ts";
import leaderboard from "./routes/leaderboard.ts";
import reputation from "./routes/reputation.ts";

const llmsTxt = `# BuFi Agora — Trading Infrastructure for AI Agents

> Forex perpetual futures and lending/borrowing on Arc (Circle L1)
> MCP-native. Pay-per-call via x402 Nanopayments. Sub-second settlement.

## Markets
- EUR/USDC, JPY/USDC, MXN/USDC, CHF/USDC, AUD/USDC perpetual futures
- Up to 50x leverage, EIP-712 signed intents, Pyth oracle prices
- Funding rates updated every 8h
- Lending pools: supply USDC, borrow FX tokens

## MCP Tools — Perpetual Futures
- bufi_list_markets: Available perp markets with funding rates and oracle prices
- bufi_perp_quote: Mark price, fee, required margin for a leveraged trade
- bufi_open_position: Open a long or short position (x402: $0.005)
- bufi_close_position: Close or reduce a position (x402: $0.005)
- bufi_positions: View open positions and unrealized P&L
- bufi_funding_rates: Current and historical funding rates

## MCP Tools — Spot FX
- bufi_spot_quote: Live price for buying EURC, JPYC, or MXNB with USDC
- bufi_spot_buy: Build EIP-712 intent to purchase FX tokens at spot (x402: $0.001)

## MCP Tools — Lending & Borrowing
- bufi_lending_markets: List lending pools with supply/borrow APYs and utilization
- bufi_borrow_preview: Preview borrow: utilization, APY, health factor
- bufi_supply_preview: Preview supplying USDC to earn yield
- bufi_supply_build: Build intent to supply USDC (x402: $0.001)
- bufi_borrow_build: Build intent to borrow against collateral (x402: $0.001)
- bufi_repay_build: Build intent to repay a loan (x402: $0.001)
- bufi_withdraw_build: Build intent to withdraw supplied USDC (x402: $0.001)
- bufi_supply_collateral_build: Build intent to add collateral (x402: $0.001)
- bufi_withdraw_collateral_build: Build intent to remove collateral (x402: $0.001)

## MCP Tools — Leaderboard & Reputation
- bufi_leaderboard: Top traders ranked by PnL, ROI, trade count
- bufi_agent_identity: Look up ERC-8004 identity NFT for a trader/agent
- bufi_reputation_score: Onchain reputation score (0-100) from peer ratings
- bufi_give_feedback: Rate a trader (1-5 stars) on ERC-8004 ReputationRegistry

## ERC-8004 (Onchain Agent Identity)
- IdentityRegistry: 0x8004A818BFB912233c491871b3d84c89A494BD9e
- ReputationRegistry: 0x8004B663056A597Dffe9eCcC1965A193B7388713
- ValidationRegistry: 0x8004Cb1BF31DAf7788923b405b754f57acEB4272
- Chain: Arc Testnet (5042002)

## Connect
- MCP: http://localhost:4002/mcp
- OpenAPI: http://localhost:4002/openapi.json
- llms.txt: http://localhost:4002/llms.txt

## Pricing
- Read operations: free
- Trade execution: $0.001-$0.005 via Circle x402 Nanopayments
- Settlement: USDC on Arc (~$0.01 gas, sub-second finality)

## Stack
- Framework: Hyper (Bun-native, source-distributed)
- Settlement: Arc Testnet (chainId 5042002)
- Oracle: Pyth Network
- Payments: Circle x402 + Gateway
- Agent wallet: Circle Agent Wallet (circle CLI)
`;

const llmsRoute = route.get("/llms.txt").handle(() => {
  return new Response(llmsTxt, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
});

const health = route.get("/health").handle(() => ok({ ok: true, ts: Date.now() }));

const hyper = new Hyper()
  .use(hyperLog({ service: "bufi-hyper" }))
  .use(corsPlugin({ origin: "*", allowAnyOrigin: true }))
  .use(openapiPlugin({ converters: [zodConverter] }))
  .use([health, llmsRoute])
  .use(markets)
  .use(quote)
  .use(trade)
  .use(positions)
  .use(spot)
  .use(lending)
  .use(leaderboard)
  .use(reputation);

const port = Number(process.env.PORT ?? 4002);

const hyperApp = hyper.build();
const mcp = mcpServer(hyperApp);

export default {
  port,
  fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return mcp.handle(req);
    }
    return hyperApp.fetch(req);
  },
};

console.log(`BuFi Agora MCP Gateway listening on :${port}`);
console.log(`  MCP:     http://localhost:${port}/mcp`);
console.log(`  OpenAPI: http://localhost:${port}/openapi.json`);
console.log(`  llms:    http://localhost:${port}/llms.txt`);
