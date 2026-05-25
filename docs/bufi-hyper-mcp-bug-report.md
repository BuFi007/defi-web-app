# BUFI HYPER MCP — Bug Report

> Source: Dogfood v3 + Sentry issues BUFI-HYPER-MCP-1, BUFI-HYPER-MCP-2
> Date: 2026-05-25
> Agent wallet: 0xb79e4987bc58057a322cd9bcface4944dd6a6cc7

---

## BUG 1: Nonce collision in parallel trade prepares (CRITICAL)

**Sentry**: Not captured as separate issue (returned as JSON error, not thrown)
**Impact**: Swarm trading broken — 3/5 parallel trades fail with "nonce already used"

### Root cause

`generateDeadlineAndNonce()` in `apps/hyper-mcp/src/shared.ts:36` uses `String(Date.now())`.
Parallel prepares within the same millisecond generate identical nonces. The perps service
rejects duplicates at `packages/perps/src/service.ts:142`.

### Reproduction

```bash
# 5 parallel prepares — 3 will collide
for sym in EURC/USDC tJPYC/USDC MXNB/USDC CIRBTC/USDC AUDF/USDC; do
  curl -s -X POST http://localhost:4002/api/trade/prepare \
    -H "Content-Type: application/json" \
    -d "{\"symbol\":\"$sym\",\"side\":\"long\",\"sizeUsdc\":\"1\",\"leverage\":2,\"trader\":\"0xb79e...\"}" &
done
wait
```

### Fix

**File**: `apps/hyper-mcp/src/shared.ts`

```diff
+let nonceCounter = 0;
+
 export function generateDeadlineAndNonce(ttl = 3600) {
+  nonceCounter = (nonceCounter + 1) % 1_000_000;
   return {
     deadline: Math.floor(Date.now() / 1000) + ttl,
-    nonce: String(Date.now()),
+    nonce: `${Date.now()}${String(nonceCounter).padStart(6, "0")}`,
   };
 }
```

Monotonic counter suffix guarantees uniqueness even within the same millisecond.
The on-chain nonce is a uint256 so the extra digits are fine.

---

## BUG 2: quoteFee revert on EURC/USDC (HIGH)

**Sentry**: BUFI-HYPER-MCP-1 (6 events, High priority)
**Impact**: `trade/prepare` fails for EURC/USDC when sizeDelta is too small for the clearinghouse

### Root cause

`quoteFee` on the clearinghouse (`0xCE3401...`) reverts with signature `0xe7764c9e` when called with:
```
marketId: 0x565a6e2f...  (EURC/USDC)
trader:   0x0000...0000  (zero address — no trader passed to quote)
sizeDelta: 1000000       (1 USDC atomic, NOT E18-scaled)
```

The issue is that `sizeDelta` passed to `quoteFee` is in USDC atomic units (6 decimals)
but the clearinghouse expects E18-scaled values. The `signedSizeDelta()` function in
`packages/perps/src/typed-data.ts:184` converts `sizeUsdc` to E18 for the typed data,
but the `quoteFee` call at `packages/perps/src/onchain.ts:52` calls `signedSizeDelta(req)`
which uses the raw `sizeDelta` field when present — and that field may be in USDC atomics
if the MCP route passed `computeSizeDelta()` output directly.

The error signature `0xe7764c9e` is not in the ABI, so viem can't decode it.
Likely a custom error like `InvalidSizeDelta()` or `MarketNotInitialized()`.

### Reproduction

```bash
curl -X POST http://localhost:4002/api/trade/prepare \
  -H "Content-Type: application/json" \
  -d '{"symbol":"EURC/USDC","side":"long","sizeUsdc":"1","leverage":2,"trader":"0xb79e..."}'
```

Sometimes works (when Hermes fallback triggers instead of on-chain quoteFee),
sometimes reverts (when on-chain path runs first).

### Fix

**File**: `packages/perps/src/onchain.ts:52`

Ensure `sizeDelta` passed to `quoteFee` is always E18-scaled, matching the
contract's expected format. The `signedSizeDelta()` call should use the
`sizeUsdc`-derived E18 value, not the raw `sizeDelta` field.

Also add the missing error signature to the clearinghouse ABI so reverts
produce human-readable messages instead of "signature not found":

**File**: `packages/contracts/src/abis/FxPerpClearinghouse.ts`

```diff
+  // Custom errors
+  { type: "error", name: "InvalidSizeDelta", inputs: [] },
+  { type: "error", name: "MarketNotInitialized", inputs: [] },
```

### Workaround

The Hermes fallback path at `onchain.ts:126` already handles this gracefully —
when `quoteFee` reverts, it falls back to Pyth Hermes for the price and computes
the fee client-side. The issue is that the error still bubbles to Sentry. Wrap
the on-chain call in a try/catch that falls through silently to the Hermes path.

---

## BUG 3: sizeUsdc "0" passes route validation but crashes signedSizeDelta (MEDIUM)

**Sentry**: BUFI-HYPER-MCP-2 (4 events, High priority)
**Impact**: Agent sending sizeUsdc="0" gets a 500 instead of a 400 validation error

### Root cause

The zod schema `zAmount = z.string().regex(/^\d+(\.\d{1,6})?$/)` matches "0" and "0.000000".
The route handler passes this to `computeSizeDelta()` → `signedSizeDelta()` which throws
`"sizeUsdc must be nonzero"` at `packages/perps/src/typed-data.ts:191`.

This throw is caught by the route's catch block and returned as `{ error: "sizeUsdc must be nonzero" }`,
but Sentry still captures it because `captureTradeError` fires before the return.

### Fix

**File**: `apps/hyper-mcp/src/shared.ts`

```diff
-export const zAmount = z.string().regex(/^\d+(\.\d{1,6})?$/);
+export const zAmount = z.string().regex(/^\d+(\.\d{1,6})?$/).refine(
+  (v) => parseFloat(v) > 0,
+  { message: "amount must be greater than zero" },
+);
```

Reject at the schema level so it returns a clean 400 validation error, not a 500.

---

## BUG 4: Borrow preview 500 when reader not configured (MEDIUM)

**Sentry**: Not captured (error returned as JSON, not thrown)
**Impact**: `POST /api/lending/borrow/preview` returns 500 with internal error message

### Root cause

`telaranaService.borrowQuote()` throws `"borrow quote reader is not configured; use on-chain
previewBorrow before returning a quote"` when the on-chain reader isn't set up.

### Fix

**File**: `apps/hyper-mcp/src/routes/lending.ts`

Wrap `borrowQuote` in try/catch and return a degraded response:

```diff
   .handle(async ({ body }) => {
-    const preview = await telaranaService.borrowQuote({...});
-    return ok(jsonSafe(preview));
+    try {
+      const preview = await telaranaService.borrowQuote({...});
+      return ok(jsonSafe(preview));
+    } catch {
+      return ok({
+        error: "borrow preview unavailable",
+        note: "On-chain quote reader not configured. Use lending/markets for APY data.",
+      });
+    }
   });
```

---

## BUG 5: Reputation RPC scans 150k blocks per call (LOW, performance)

**Sentry**: Not an error, but 1-1.3s latency per call
**Impact**: `GET /api/reputation/score/:agentId` and `/identity/:agentId` are slow

### Root cause

`getReputation()` in `apps/hyper-mcp/src/erc8004.ts` scans the last 150,000 blocks
via `getLogs()` on every request. No caching.

### Fix

Wire `@hyper/cache` (already installed) on the reputation routes:

```ts
import { cache } from "@hyper/cache";

const reputationScore = route
  .get("/reputation/score/:agentId")
  .use(cache({ swr: 300_000 }))  // 5-min SWR cache
  ...
```

---

## BUG 6: Quote cold start 1.1s (LOW, performance)

**Impact**: First Pyth oracle call takes 1.1s, subsequent ~380ms

### Fix

Warm the oracle cache on server boot:

```ts
// app.ts — after server starts
setTimeout(async () => {
  const markets = livePerpsMarkets(5042002);
  for (const m of markets.slice(0, 1)) {
    await perpsService.quote({ chainId: 5042002, marketId: m.marketId, side: "long", sizeUsdc: "1", leverage: 1 }).catch(() => {});
  }
}, 100);
```

---

## Summary

| # | Bug | Severity | Sentry ID | Status | Fix effort |
|---|-----|----------|-----------|--------|------------|
| 1 | Nonce collision in parallel prepares | CRITICAL | — | Open | 5 min |
| 2 | quoteFee revert (sizeDelta scale / missing ABI error) | HIGH | BUFI-HYPER-MCP-1 | Open | 30 min |
| 3 | sizeUsdc "0" bypasses validation | MEDIUM | BUFI-HYPER-MCP-2 | Open | 5 min |
| 4 | Borrow preview 500 when reader missing | MEDIUM | — | Open | 5 min |
| 5 | Reputation 150k block scan per call | LOW | — | Open | 10 min |
| 6 | Quote cold start 1.1s | LOW | — | Open | 5 min |

**Recommended fix order**: 1 → 3 → 4 → 6 → 5 → 2 (bug 2 requires contract investigation)
