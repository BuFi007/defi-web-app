# BUFX · Agentic Forex Stablecoin Trading

Onchain forex exchange on Arc. Perpetual futures, spot FX, lending/borrowing — for humans and AI agents.

**Live:** [fx.bu.finance](https://fx.bu.finance) · **MCP:** [mcp.bu.finance](https://mcp.bu.finance/mcp) · **API:** [api.bu.finance](https://api.bu.finance)

## Why

Traditional FX is a $7.5T/day market running on 1970s infrastructure:

- **T+2 settlement & Herstatt risk** — two legs of a trade don't clear simultaneously, exposing counterparties to the failure mode that took down Bankhaus Herstatt in 1974. Onchain atomic settlement eliminates this — both legs clear in one transaction, sub-second, on Arc.
- **Market closure & fragmented liquidity** — FX trades ~24/5 with gaps across session handoffs (Tokyo→London→NY) and liquidity splintered across hundreds of bilateral venues. A 24/7 onchain venue with a single price surface never closes.
- **Exclusion of non-institutional participants** — prime brokerage, ISDAs, and minimum tickets price out SMBs and emerging-market corridors (LATAM, Africa, Asia-Pacific) where spreads balloon. Stablecoin-native rails collapse the access stack to a wallet.

## Core Products

**Perpetual futures** — 5 forex pairs (EUR, JPY, MXN, BTC, AUD vs USDC), up to 100x leverage, Pyth oracle pricing. Intent-based order flow with onchain atomic settlement.

**Spot FX** — buy EURC, JPYC, MXNB stablecoins with USDC at live oracle prices. Emerging-market corridors quoted competitively onchain.

**Lending/Borrowing (Telaraña)** — supply USDC to earn yield, borrow against collateral with real-time health factor monitoring.

## Ghost Mode — Private Trading

Ghost Mode routes trades through **shielded pools** backed by zero-knowledge proofs. The `FxPrivacyEntrypoint` contract implements a commitment-based privacy scheme:

1. **Deposit** — trader sends stablecoins with a Poseidon hash precommitment. The contract adds a commitment to a Merkle tree, decoupling deposit amount and owner from withdrawal.
2. **Relay** — to exit, the trader generates a Groth16 ZK proof (via `commitmentVerifier` / `withdrawalVerifier` circuits with Poseidon T3/T4) proving ownership of a valid commitment without revealing which one. Funds go to any recipient address.
3. **Cross-currency relay** — deposit USDC into the privacy pool, withdraw as EURC (or any stablecoin) via an atomic swap inside the shielded withdrawal. The counterparty never sees the original deposit.

**The UX:** the theme toggle IS the privacy switch. Tap the moon/sun icon in the header — a Dynamic Island animation morphs into a "Ghost Mode — You can now trade privately" pill while a Spaceman circle-reveal transitions the entire page to dark theme. The visual shift is the privacy signal. Under the hood, `GhostModeContext` flips `isGhostMode`, trade routing switches from public order flow to shielded-pool paths, and the state persists across tabs via localStorage. A periodic ad loop surfaces Ghost Mode to light-theme users organically — no modals, no tooltips, just a tap.

This matters for forex: institutional traders use dark pools to avoid signaling large positions. Ghost Mode brings that to stablecoin FX — a $500K USDC→EURC conversion stays invisible on the public book.

## Agent Infrastructure (MCP)

22 MCP tools via a live server — any AI agent connects with one command and can trade, lend, borrow, stream prices, and build onchain reputation. The exchange speaks MCP natively.

- **ERC-8004 identity & reputation** — agents mint identity NFTs on Arc, accumulate peer-rated reputation scores (0–100), build verifiable trading track records
- **MCP workflow state machine** — multi-step flows (quote→sign→execute) with EIP-712 signature gates and x402 nanopayment gates
- **4.17-second trades** — dogfooded with Circle agent wallet (prepare 0.73s + sign 3.04s + execute 0.40s), 60x faster than manual flows
- **x402 nanopayments** — $0.001–$0.005 USDC per paid API call, no subscriptions

## MCP Endpoints

| Endpoint | URL |
|----------|-----|
| **MCP JSON-RPC** (POST) | `https://mcp.bu.finance/mcp` |
| **MCP Landing** (GET) | `https://mcp.bu.finance/mcp` |
| **OpenAPI 3.1 spec** | `https://mcp.bu.finance/openapi.json` |
| **LLM protocol description** | `https://mcp.bu.finance/llms.txt` |
| **Health check** | `https://mcp.bu.finance/health` |
| **SSE price stream** | `https://mcp.bu.finance/api/stream/prices/:symbol` |

### Connect your agent

```bash
# Claude Code (one-liner)
claude mcp add --transport http bufi-hyper https://mcp.bu.finance/mcp

# Codex
codex --approval-mode full-auto -q "claude mcp add --transport http bufi-hyper https://mcp.bu.finance/mcp"
```

```json
// .mcp.json (project-level)
{
  "mcpServers": {
    "bufi-hyper": { "type": "url", "url": "https://mcp.bu.finance/mcp" }
  }
}
```

```json
// Claude Desktop / Cursor / Windsurf
{
  "mcpServers": {
    "bufi-hyper": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.bu.finance/mcp", "--allow-http"]
    }
  }
}
```

## Quickstart

```bash
bun install
bun run dev               # frontend on :3000
bun run dev:api           # api on :3002
bun run dev:ponder        # indexer on :42069
```

## Stack

Bun 1.3 · Next.js 16 · Hono · Ponder · Pyth · Liveblocks · viem · wagmi · Dynamic Labs · Circle Agent Wallet (ERC-1271) · Arc Testnet · Sentry · zod · TypeScript 5

## Architecture

```
apps/
  web/              Next.js 16 frontend
  api/              Hono API: realtime + agentic surface
  hyper-mcp/        MCP trading gateway (22 tools)
  ponder/           Onchain indexer
  keeper-*          Always-on keepers (Gateway, spot, perps, Pyth)
packages/
  x402/             Nanopayment-gated route middleware
  mcp/              Tool registry + workflow state machine
  contracts/        Per-chain address book + FxPrivacyEntrypoint ABI
  perps/            Perps domain interface
  fx-telarana/      Lending domain interface
  fx-spot/          Spot intent builders
  fx-bento/         Arcade domain interface
  db/               Durable SQLite trading DB
  market-data/      Pyth Hermes client + oracle freshness
  liveblocks/       Realtime rooms
  keeper-runtime/   Shared keeper loop
  env/              Zod-validated env
  shared-types/     Cross-package types
  logger/           JSON structured logger
```

## Rust Matcher (Hybrid CLOB)

Rust-based price-time priority matcher for perp trades. Sub-second matching with batch settlement on Arc — the exchange's order-matching core.

**Architecture:** single-writer sequencer actor serializes all order events, a WebSocket gateway accepts submissions from traders/agents, and a batch flusher groups fills into onchain settlement transactions.

```
services/matcher/
  crates/
    orderbook/                          BTreeMap CLOB — price-time priority, cancel/replace
    matcher-server/
      src/
        sequencer.rs                    Single-writer event loop (all order mutations)
        ws_gateway.rs                   WebSocket order submission + acks
        batch_flusher.rs                Onchain settlement batching (Arc)
        tick.rs                         Legacy tick loop (Phase 1: persistent books)
```

**Config:**

| Env var | Purpose |
|---------|---------|
| `MATCHER_WS_BIND` | WebSocket listen address |
| `MATCHER_GRPC_BIND` | gRPC listen address |
| `MATCHER_HTTP_BIND` | HTTP health/metrics address |
| `MATCHER_CHAIN_ID` | Target chain for settlement |

Full architecture spec: [`docs/architecture/hybrid-clob-spec.md`](docs/architecture/hybrid-clob-spec.md)

## Rules

- Money lives onchain. Contracts settle. Backend coordinates.
- No client-supplied price is trusted. Quotes come from oracles.
- No financial action without wallet signature + valid nonce + fresh oracle.
- AI tools never bypass gates. MCP enforces `requiresSignature` / `requiresPaymentUsdc`.
- MCP signatures are EIP-712.
- No Clerk. No SaaS auth. Wallet sessions only.
