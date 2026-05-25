# BuFi Agora MCP — Hyperspeed Agentic Trading Feedback

> Dogfood: Circle agent wallet → EURC/USDC perp long on Arc Testnet
> Current time-to-trade: **>4 minutes** (6 sequential steps, manual JSON, 2 signatures)
> Target: **<5 seconds** (1-2 MCP tool calls, zero manual construction)

---

## What happened today

| Step | Time | Blocker |
|------|------|---------|
| `circle wallet login` (OTP) | ~60s | Interactive, 3 attempts needed |
| `bufi_list_markets` | <1s | OK |
| `bufi_perp_quote` | <1s | Needed `sizeDelta` (contract-native) — agent doesn't know this |
| Build EIP-712 typed data | ~30s | Agent had to read source code to construct JSON |
| Sign session + order (2x `circle wallet sign typed-data`) | ~5s | 2 separate signatures |
| Submit intent | ~2s | **BLOCKED** — ERC-1271 not supported (now fixed) |

**Total: >4 minutes of agent reasoning + 6 tool calls + 2 signatures**

---

## Critical changes for hyperspeed

### 1. Composite MCP tools — collapse 6 calls to 2

**Current flow (6 calls):**
```
list_markets → quote → build_typed_data → sign_session → sign_order → submit
```

**Target flow (2 calls):**
```
bufi_trade_prepare(symbol, side, sizeUsdc, leverage) → { digest, sessionDigest, typedData }
bufi_trade_execute(signature, sessionSignature) → { intentId, status }
```

`bufi_trade_prepare` should:
- Accept human-readable `symbol` ("EURC/USDC") not bytes32 marketId
- Auto-compute `sizeDelta` from `sizeUsdc` internally
- Auto-generate `nonce` and `deadline`
- Return both the order digest AND session digest in one response
- Return the typed data for both signatures so the agent signs once per call

`bufi_trade_execute` should:
- Accept both signatures and submit atomically
- Return intent status + SSE stream URL for tracking

Same pattern for spot, lending, borrowing — every product surface needs a 2-call prepare/execute pair.

### 2. API-key auth for agents — eliminate session signatures entirely

The wallet-session dance (sign a WalletSession typed-data, pass 4 headers) is designed for browser UX. AI agents should authenticate via:

```
Authorization: Bearer <agent-api-key>
X-Agent-Wallet: 0xb79e...
```

Issue API keys scoped to a wallet address. The agent signs once at setup, never again for session auth. This cuts the flow to:

```
bufi_trade(symbol, side, sizeUsdc, leverage) → { digest }
bufi_trade_submit(digest, signature) → { intentId }
```

Or with a pre-authorized agent wallet (delegate signing to the MCP):

```
bufi_trade(symbol, side, sizeUsdc, leverage) → { intentId, txHash }
```

**One call. Sub-second.**

### 3. Human-readable inputs everywhere

| Current | Target |
|---------|--------|
| `marketId: "0x565a6e2f..."` | `symbol: "EURC/USDC"` |
| `sizeDelta: "5000000"` | `sizeUsdc: "5"` (MCP computes delta) |
| `chainId: 5042002` | default to Arc Testnet (only chain) |
| `priceE18: "0"` | `orderType: "market"` (zero price implicit) |
| `nonce: "1779723406411"` | auto-generated |
| `deadline: 1779727006` | `ttl: 3600` or default 1h |

The MCP should never expose E18-scaled values, bytes32 market IDs, or require the agent to compute contract-native representations. Those are implementation details.

### 4. llms.txt rewrite

Current `llms.txt` lists tool names + one-line descriptions. For hyperspeed, it needs:

**a) Workflow sequences, not tool catalogs:**
```
## Quick Trade (2 calls)
1. bufi_trade_prepare("EURC/USDC", "long", "5", 2)
   → returns { orderDigest, sessionDigest, ... }
2. bufi_trade_execute(orderSig, sessionSig)
   → returns { intentId, status: "accepted" }

## Yield Farm (2 calls)
1. bufi_supply_prepare("EURC/USDC", "100")
   → returns { digest, apy: "4.2%", ... }
2. bufi_supply_execute(signature)
   → returns { txHash }
```

**b) Default values documented:**
```
## Defaults (omit these unless overriding)
- chainId: 5042002 (Arc Testnet)
- orderType: "market"
- leverage: 1
- ttl: 3600 (1 hour)
- reduceOnly: false
```

**c) Error recovery patterns:**
```
## Common errors
- "wallet session required" → sign a WalletSession first (see auth section)
- "sizeDelta is required" → pass sizeUsdc instead, MCP converts
- "nonce already used" → auto-retry with fresh nonce
```

**d) Agent capabilities matrix:**
```
## What agents can do without human approval
- Read: markets, quotes, positions, funding rates, lending APYs (free)
- Trade: perp open/close, spot buy, supply, borrow (x402 $0.001-$0.005)

## What requires human approval
- Withdrawals > 100 USDC
- Leverage > 20x
- Liquidation-risk trades (health factor < 1.5)
```

### 5. Batch operations

Agents managing portfolios need batch endpoints:

```
bufi_batch([
  { action: "close", symbol: "MXNB/USDC" },
  { action: "open", symbol: "EURC/USDC", side: "long", sizeUsdc: "10", leverage: 5 },
  { action: "supply", pool: "EURC/USDC", amount: "50" },
])
→ returns [{ intentId }, { intentId }, { txHash }]
```

One tool call for a portfolio rebalance instead of 6.

### 6. Streaming price feeds via MCP resources

Instead of agents polling `/perps/quote` every second:

```
MCP Resource: bufi://prices/EURC-USDC
→ SSE stream of { markPrice, bid, ask, funding } every 100ms
```

The agent subscribes once, reacts to price changes, and fires trades at speed. Current MCP tools are request/response — needs event-driven resources for real-time trading.

### 7. Pre-flight cost estimation

Before every trade, agents need to know the total cost:

```
bufi_cost_estimate("EURC/USDC", "long", "5", 2)
→ {
    margin: "2.50 USDC",
    fee: "0.002912 USDC",
    x402Fee: "0.005 USDC",
    gasCost: "~0.01 USDC",
    total: "~2.52 USDC",
    walletBalance: "21 USDC",
    sufficient: true
  }
```

---

## Product surface parity — what's missing per vertical

### Perps (partially working)
- [x] list_markets
- [x] quote
- [x] create intent (now works with ERC-1271)
- [ ] **composite trade tool** (prepare + execute)
- [ ] close position tool
- [ ] modify/replace order tool (replacement flow exists but not in MCP)
- [ ] funding rate alerts

### Spot FX
- [x] spot_quote (exists in hyper-mcp)
- [x] spot_buy (exists in hyper-mcp)
- [ ] **needs same prepare/execute pattern**
- [ ] spot_sell (missing)
- [ ] batch swap

### Lending & Borrowing
- [x] lending_markets (exists)
- [x] supply/borrow/repay/withdraw build tools (exist)
- [ ] **all return typed data that agents can't sign without the wallet-session dance**
- [ ] health factor monitoring
- [ ] auto-repay on liquidation risk
- [ ] yield comparison across pools

### Leaderboard & Reputation
- [x] leaderboard
- [x] agent_identity (ERC-8004)
- [x] reputation_score
- [x] give_feedback

---

## Target architecture

```
Agent                    BuFi MCP                        Arc Testnet
  │                         │                                │
  ├─ bufi_trade("EURC/USDC", "long", "5", 2x) ──►│         │
  │                         │ compute sizeDelta              │
  │                         │ generate nonce, deadline       │
  │                         │ build EIP-712 typed data       │
  │◄── { digest, typedData }┤                                │
  │                         │                                │
  │ sign(digest) ──────────►│                                │
  │  (circle wallet sign)   │                                │
  │                         │ verify signature (ERC-1271)    │
  │                         │ create intent                  │
  │                         │ matcher picks up ─────────────►│ settle on-chain
  │◄── { intentId, status } ┤◄──────────────────────────────┤ sub-second
  │                         │                                │
```

**Total: 2 MCP calls + 1 wallet sign = <3 seconds**

---

## ERC-1271 fix (shipped today)

**Files changed:**
- `apps/api/src/wallet-session.ts` — ERC-1271 fallback for session auth
- `packages/perps/src/typed-data.ts` — ERC-1271 fallback for order signature verification

After ecrecover fails to match the claimed address (smart contract wallet), calls `isValidSignature(hash, signature)` on-chain. Circle agent wallets return `0x1626ba7e` (valid). Zero overhead for EOA wallets — the on-chain call only fires when ecrecover doesn't match.

**Result:** Circle agent wallet `0xb79e...6cc7` now authenticates sessions and submits perp intents on Arc Testnet. Intent `0x877d...21b0` accepted — EURC/USDC long, 5 USDC, 2x leverage.
