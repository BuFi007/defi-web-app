# BUFI HYPER MCP — Dogfood v3 Prompt

Paste this into a fresh Claude Code session with the MCP server running on port 4002.

---

## Setup

```bash
# Start the MCP server
cd ~/coding-dojo/defi-web-app/apps/hyper-mcp
PORT=4002 bun run dev

# Verify
curl http://localhost:4002/health
```

---

## Dogfood Prompt

```
You have access to the BUFI HYPER MCP server at http://localhost:4002 for forex perp trading on Arc Testnet.

Circle agent wallet: 0xb79e4987bc58057a322cd9bcface4944dd6a6cc7 (ARC-TESTNET, ~16 USDC balance)
Sign with: `circle wallet sign typed-data '<JSON>' --address 0xb79e4987bc58057a322cd9bcface4944dd6a6cc7 --chain ARC-TESTNET --quiet`

## Objective
Test ALL 21 MCP tools end-to-end. Report PASS/FAIL per tool with response time.

## Checklist

### 0. Discovery
- GET http://localhost:4002/mcp → landing page with tool list + install snippets
- GET http://localhost:4002/llms.txt → workflow-first protocol description (verify no "CHF", no "100x", says "BUFI HYPER")

### 1. Auth
- POST /auth/token with {"address":"0xb79e4987bc58057a322cd9bcface4944dd6a6cc7","scope":"read trade"}
- Expect: mode "open" (no JWT secret set) or a JWT token

### 2. Markets & Quotes (5 tools)
- GET /api/markets → 5 perp markets (EURC, tJPYC, MXNB, CIRBTC, AUDF), all enabled
- GET /api/funding → funding rates for all markets
- POST /api/quote with {"symbol":"EURC/USDC","side":"long","sizeUsdc":"5"} → markPrice
- POST /api/quote with {"symbol":"AUDF/USDC","side":"short","sizeUsdc":"10","leverage":5} → markPrice ~0.71
- POST /api/cost with {"symbol":"MXNB/USDC","side":"long","sizeUsdc":"10","leverage":5} → total in USDC

### 3. Trade Flow — ALL 5 markets (3 tools × 5 markets)
For EACH of: EURC/USDC, tJPYC/USDC, MXNB/USDC, CIRBTC/USDC, AUDF/USDC:
  a. POST /api/trade/prepare with {symbol, side:"long", sizeUsdc:"1", leverage:2, trader:<addr>}
     → digest, typedData (must include EIP712Domain in types), deadline, nonce, quote
  b. Sign the typedData with circle wallet sign typed-data
  c. POST /api/trade/execute with {symbol, side, sizeUsdc, leverage, trader, deadline, nonce, signature}
     → intent status: "accepted"
  d. Record time from prepare→accepted

### 4. Close Flow (1 tool)
- POST /api/close/prepare with {symbol:"EURC/USDC", side:"long", sizeUsdc:"1", trader:<addr>}
  → digest with reduceOnly:true

### 5. Positions (1 tool)
- GET /api/positions/<addr> → list of open positions (may be empty if matcher hasn't filled)

### 6. Spot FX (2 tools)
- POST /api/spot/quote for EACH of: EURC, JPYC, MXNB → price + routeId
- POST /api/spot/buy with {symbol:"EURC", trader:<addr>, amountInAtomic:"100000000", minAmountOutAtomic:"1"}
  → digest + typedData

### 7. Lending (5 tools)
- GET /api/lending/markets → pool list with APYs
- POST /api/lending/borrow/preview with a marketId from above
- POST /api/lending/supply with {marketId, supplier:<addr>, amount:"50"}
- POST /api/lending/repay with {marketId, borrower:<addr>, amount:"10"}
- POST /api/lending/withdraw with {marketId, supplier:<addr>, amount:"10"}

### 8. Leaderboard & Reputation (3 tools)
- GET /api/leaderboard → ranked traders
- GET /api/reputation/identity/2286 → ERC-8004 identity NFT
- GET /api/reputation/score/2286 → onchain reputation score
- POST /api/reputation/feedback with {subjectAgentId:"2286", stars:5, tag:"trading", raterWalletUuid:"test"}

### 9. SSE Streams (2 tools — verify they open)
- GET /api/stream/prices/EURC%2FUSDC → SSE price events (connect for ~5 seconds, verify events arrive)
- GET /api/stream/intents/<addr> → SSE intent events (connect for ~5 seconds, verify accepted events for earlier trades)

### 10. Edge Cases
- POST /api/quote with symbol "CHF/USDC" → must reject (no CHF market)
- POST /api/trade/prepare with leverage 51 → must reject (max 50)
- POST /api/trade/prepare with sizeUsdc "0" → must reject
- POST /api/trade/prepare with sizeUsdc "-5" → must reject
- POST /api/trade/prepare without trader → must reject
- POST /api/cost for AUDF/USDC → total in USDC (verify Hermes fallback works)

## Report Format

| # | Tool | Endpoint | Status | Time | Notes |
|---|------|----------|--------|------|-------|
| 0 | discovery | GET /mcp | PASS | 25ms | 21 tools listed |
| 0 | llms.txt | GET /llms.txt | PASS | 20ms | BUFI HYPER, no CHF |
| 1 | auth | POST /auth/token | PASS | 30ms | open mode |
| ... | ... | ... | ... | ... | ... |

At the end, report:
- Total tools tested: X/21
- Total PASS/FAIL
- Average trade time (prepare+sign+execute)
- Any regressions from v2 dogfood
- AUDF status: does it quote AND trade?
```

---

## Expected Results

| Surface | Markets | Expected |
|---------|---------|----------|
| Perp quote | 5/5 | All return markPrice via Hermes fallback |
| Perp trade | 5/5 | All return status:"accepted" |
| Spot quote | 3/3 | EURC, JPYC, MXNB all return price |
| Lending | 8 pools | Markets list returns pools |
| Reputation | ERC-8004 | Identity + score lookups work |
| Streams | 2/2 | Price + intent SSE streams open |
| Edge cases | 5/5 | All rejected cleanly (no 500s) |

## Key Addresses

```
Circle wallet:     0xb79e4987bc58057a322cd9bcface4944dd6a6cc7
FxOracleV2:        0xF181caF51bD2450211CB9e72d5Cc853d3789698B
Clearinghouse:     0xCE3401BD53be4c0a8c7CCb0376b313925f99b8d2
OrderSettlement:   0x904bb24A910c54A84341E157B894d11B474A2e1F
MCP endpoint:      http://localhost:4002/mcp
```
