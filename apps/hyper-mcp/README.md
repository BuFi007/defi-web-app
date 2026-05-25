# BuFi Agora — MCP Trading Gateway

Trading infrastructure for AI agents. Forex perpetual futures and lending/borrowing on Arc, exposed as MCP tools with x402 nanopayment billing.

## Quick Start

```bash
cd apps/hyper-mcp
bun install
bun run dev
```

Server starts on `http://localhost:4002`. MCP endpoint at `/mcp`.

## Connect Your Agent

### Claude Code (CLI)

```bash
claude mcp add --transport http bufi-hyper http://localhost:4002/mcp
```

Or add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "bufi-hyper": {
      "type": "url",
      "url": "http://localhost:4002/mcp"
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bufi-hyper": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:4002/mcp", "--allow-http"]
    }
  }
}
```

### Cursor / Windsurf / Any MCP Client

```json
{
  "mcpServers": {
    "bufi-hyper": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:4002/mcp", "--allow-http"]
    }
  }
}
```

### Deployed Server

Replace `http://localhost:4002/mcp` with your deployed URL.

## MCP Tools

| Tool | Description |
|------|-------------|
| `get__api_markets` | List forex perp markets (EUR, JPY, MXN, CHF, AUD vs USDC) |
| `get__api_funding` | Current funding rates |
| `post__api_quote` | Get mark price, fee, required margin |
| `post__api_trade_build` | Build EIP-712 order for signing |
| `post__api_trade_submit` | Submit signed order to matcher |
| `get__api_positions_address` | View open positions |
| `post__api_borrow_preview` | Preview lending pool APY and health |
| `get__api_leaderboard` | Top traders by trade count |
| `get__api_reputation_identity_agentId` | ERC-8004 agent identity |
| `get__api_reputation_score_agentId` | Onchain reputation score |
| `post__api_reputation_feedback` | Rate a trader (1-5 stars) |

## Endpoints

| Path | Description |
|------|-------------|
| `/mcp` | MCP JSON-RPC 2.0 endpoint |
| `/openapi.json` | OpenAPI 3.1 spec |
| `/llms.txt` | Protocol description for LLMs |
| `/health` | Health check |

## Stack

- **Framework**: [Hyper](https://hyperjs.ai) (Bun-native, source-distributed)
- **Settlement**: Arc Testnet (chainId 5042002)
- **Oracle**: Pyth Network
- **Payments**: Circle x402 + Gateway nanopayments
- **Identity**: ERC-8004 (IdentityRegistry, ReputationRegistry, ValidationRegistry)
- **Agent Wallet**: Circle Agent Wallet (`circle` CLI)

## Architecture

```
Agent (Claude / GPT / any MCP client)
  │ MCP JSON-RPC 2.0
  ▼
Hyper-MCP Gateway (Bun, port 4002)
  │ imports @bufi/* workspace packages
  ▼
Arc Testnet — sub-second finality, ~$0.01 USDC gas
```

## Hackathon

Built for the [Agora Agents Hackathon](https://thecanteenapp.com) by Canteen × Circle × Arc.

RFBs covered:
- **RFB 01**: Perpetual Futures Trading Agent infrastructure
- **RFB 06**: Social Trading Intelligence (leaderboard + ERC-8004 reputation)
