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

Ghost Mode routes trades through **shielded pools** backed by zero-knowledge proofs. The `FxPrivacyEntrypoint` contract (a fork of 0xbow's audited privacy-pools-core) implements a commitment-based scheme:

1. **Deposit** — trader sends stablecoins with a Poseidon precommitment `Poseidon([nullifier, secret])`. The pool stores the leaf commitment `Poseidon([value, label, precommitment])` in a Merkle tree.
2. **Relay (withdraw)** — to exit, the trader generates a Groth16 proof (`withdrawalVerifier` circuit, Poseidon T3/T4) proving ownership of *some* valid commitment without revealing *which* one. Funds go to any fresh recipient. Submit through the relayer so the relayer — not your wallet — is the on-chain `msg.sender`.
3. **Cross-currency relay** — deposit USDC, withdraw EURC (or vice-versa) via an atomic fixed-rate swap inside the shielded withdrawal.

### What it does and does NOT hide (read this)

The ZK proof hides the **link** between a deposit and its withdrawal. It does **not** hide **amounts** — on a transparent chain the pool settles via `token.transfer(recipient, amount)` and the circuit exposes `withdrawnValue` as a public signal, so amounts are unavoidably public. An arbitrary amount is therefore a fingerprint that re-links a withdrawal to its deposit (anonymity set → 1).

The fix is **fixed denominations**: every deposit/withdrawal must be one of a small shared set, so the public amount no longer identifies a single deposit.

- **Denominations** — stablecoins (USDC/EURC/MXNB/QCAD/AUDF): `1 / 10 / 100 / 1000 / 10000`; cirBTC: `0.001 / 0.01 / 0.1 / 1`. Split larger amounts into several denomination deposits.
- **Enforced on-chain** — `FxPrivacyEntrypoint` reverts `NotADenomination` on any off-denomination deposit or withdrawal (Arc Testnet, gate live for all 6 assets). The MCP advice layer mirrors this and refuses to prepare off-denomination deposits.
- **No new trusted setup** — the gate is a value-domain check; the deployed `WithdrawalVerifier` is byte-identical to the audited pin.
- **Your anonymity set** = the number of other deposits sharing your denomination. It grows with volume — it is not infinite, and the system says so honestly (`privacyNotice` on every ghost API response; `ghost_privacy_check` lints a planned withdrawal).
- **Best practice**: fresh recipient address, withdraw via the relayer, wait between deposit and withdrawal, prefer same-asset over cross-currency (cross-currency emits both legs).
- **Deferred**: confidential (hidden) amounts require non-ERC20 settlement + a new ceremony; KYC/identity binding is a later, separate decision. See `PRIVACY_CIRCUIT_WORKPLAN.md`.

**The UX:** the theme toggle IS the privacy switch. Tap the moon/sun icon in the header — a Dynamic Island animation morphs into a "Ghost Mode" pill while a Spaceman circle-reveal transitions the page to dark theme. Under the hood, `GhostModeContext` flips `isGhostMode`, trade routing switches to shielded-pool paths, and the state persists across tabs.

This matters for forex: institutional traders use dark pools to avoid signaling positions. Ghost Mode brings best-effort unlinkability to stablecoin FX — honest about its limits, not "invisible".

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
  env/              Zod-validated env
  shared-types/     Cross-package types
  logger/           JSON structured logger
services/
  matcher/          Rust CLOB + all always-on keeper roles
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
