# Hackathon Gap Analysis — What We're Missing to Win

> Source: arc-canteen context sync, Arc agentic economy docs, judging criteria
> Date: 2026-05-25

---

## Judging Rubric (reminder)

| Weight | Criteria | Our status |
|--------|----------|------------|
| 30% | **Agentic Sophistication** — how much does the AI decide vs automate? | STRONG — composite tools, ERC-1271, workflow state machine |
| 30% | **Traction** — real users, real transactions, real volume | WEAK — only our own wallet traded |
| 20% | **Circle Tool Usage** — creative use of Circle platform | MEDIUM — agent wallet + x402 + ERC-1271, but missing Gateway nanopayments + x402 service registration |
| 20% | **Innovation** — novel approaches, emergent behavior | STRONG — MCP-native exchange, ERC-8004 reputation, Hyper framework |

---

## CRITICAL GAPS (fix today)

### 1. Register as an x402 service on Circle's marketplace

**What**: Our MCP server should be listed at `agents.circle.com/services` so any
agent can discover and pay for our tools via `circle services pay`.

**Why it matters**: This is THE Circle integration the judges want to see. An agent
runs `circle services search "forex trading"`, finds BuFi, and starts trading.
Without it, we're a localhost demo, not an agentic service.

**How**: Register at agents.circle.com, list our endpoints with x402 pricing.
The `circle services pay` CLI handles nanopayment settlement automatically.

### 2. Gateway nanopayment deposit flow

**What**: We reference x402 nanopayments everywhere but haven't demonstrated the
actual Gateway deposit → nanopay → settle flow.

**Why it matters**: 20% of judging is Circle tool usage. Nanopayments are Gateway's
killer feature — gas-free, sub-cent USDC payments for high-frequency agent trades.
We need to show:
1. `circle gateway deposit --amount 5 --address <wallet> --chain ARC-TESTNET`
2. Agent trades via MCP, each call deducts from Gateway balance
3. No gas costs per trade

**How**: Wire the real `circleGatewayVerifier` (already in `packages/x402/verify.ts`)
instead of `mockVerifier`. Set `X402_FACILITATOR_URL` env var.

### 3. ERC-8183 job contracts (from Arc docs)

**What**: Arc has ERC-8183 — programmable job contracts for agent work settlement.
We have ERC-8004 (identity/reputation) but not 8183 (jobs).

**Why it matters**: The arc-escrow sample shows the full flow: create job → fund
escrow with USDC → submit deliverable → AI evaluation → settlement. This is
exactly what our copy-trading leaderboard needs — a "trading job" where the agent
posts a performance bond, trades, and gets paid if performance meets threshold.

**How**: The slash-bonded leaderboard IS an ERC-8183 job:
- Job = "maintain top-N leaderboard rank for 7 days"
- Escrow = USDC performance bond
- Deliverable = trading PnL
- Evaluation = oracle-verified PnL > threshold
- Settlement = bond returned (pass) or slashed (fail)

### 4. Traction — get real agents trading

**What**: Only our own Circle wallet has traded. Judges weight traction at 30%.

**Why it matters**: "How many real people have tried the product, and what validation
you got from end users" — directly from the submission form.

**How**:
- Deploy to `fx.bu.finance` (Railway config ready)
- Post the `claude mcp add` one-liner in the Canteen Discord
- Agents.circle.com listing drives organic discovery
- The arc-canteen `update-traction` command tracks this

### 5. Submit via arc-canteen

**What**: `arc-canteen login` → `arc-canteen update-product` → `arc-canteen update-traction`

**Why it matters**: The hackathon's own tracking system. Judges see updates.

---

## MEDIUM GAPS (strengthen submission)

### 6. Delegated signing (one-call trades)

**What**: Agent trades in 1 MCP call, not 2 (prepare + execute). The MCP server
holds a signing key authorized by the agent wallet.

**Why it matters**: "Agentic Sophistication" — full autonomy beats meaningful agency.
One-call trades = full autonomy. Two-call trades = meaningful agency (agent still
decides, but can't execute without human-in-the-loop signing).

### 7. Cross-chain collateral via CCTP

**What**: Use CCTP to move USDC from other chains to Arc for trading collateral.

**Why it matters**: RFB 01 explicitly mentions "cross-chain collateral movement via CCTP"
as a desired feature. We have the Gateway integration but haven't demonstrated CCTP.

### 8. Video demo — 3 minutes

**What**: Record the Circle agent wallet → MCP → trading flow.

**Structure**:
- 0:00-0:30 — Problem: agents need infra to trade, not just strategies
- 0:30-1:30 — Demo: `circle wallet` → `claude mcp add bufi-hyper` → trade EURC/USDC
- 1:30-2:15 — Architecture: MCP + x402 + ERC-8004 + Arc settlement
- 2:15-2:45 — Traction: N agents connected, M trades executed
- 2:45-3:00 — Vision: slash-bonded leaderboard + ERC-8183 job contracts

---

## WHAT WE HAVE THAT OTHERS DON'T

| Differentiator | Details |
|----------------|---------|
| **MCP-native exchange** | Not a trading bot — the market itself, accessible via standard MCP |
| **22 MCP tools** | Full product surface: perps + spot + lending + reputation |
| **4.17s trades** | Dogfooded, 60x improvement documented |
| **ERC-8004 reputation** | Onchain agent identity + peer ratings on Arc |
| **ERC-1271 support** | Circle smart contract wallets work (we fixed this) |
| **Hyper framework** | Source-distributed, one route = REST + OpenAPI + MCP |
| **Sentry monitoring** | Agent workflow errors tracked with trade context |
| **20-agent swarm tested** | Zero failures, zero nonce collisions |

---

## PRIORITY ORDER (remaining hours)

1. **Deploy to fx.bu.finance** (30 min) — Railway, BUFI_MCP_URL set
2. **arc-canteen login + update-product** (10 min) — get on judges' radar
3. **Wire real x402 facilitator** (30 min) — X402_FACILITATOR_URL + Gateway deposit
4. **Record video demo** (30 min)
5. **Post in Canteen Discord** (5 min) — drive traction
6. **Submit via Google form** (10 min) — GitHub repo + video + live link
