# Team BRAVO — Iteration 2

## BRAVO.1 — Matcher fills

- **Iter 1 candidate that proved true:** none of (a/b/c) directly. The
  real surface was the LP backstop's `FillSizeCap` denial — which iter 1
  *had* surfaced in the logs but mis-classified as a router quirk. (a)
  TIF hardcode is real (translator.rs:282 still drops the wire `tif`)
  but is NOT the fill blocker; (b) MARKET priceE18=0 reaches the LP
  router fine; (c) per-tick rebuild is by design.

- **Root cause:** The LP TVL row in sqlite `lp_positions` is
  `tvl_usdc_e6 = 1_500_000` (= 1.5 USDC). `LpConfig::default()` sets
  `max_fill_per_intent_bps = 1_000` → per-intent cap = 10% × 1.5e6 ×
  1e12 = **1.5e17 (0.15 unit)**. Canary's default `notional_usdc_e6 =
  1_000_000` produces `mag_e18 = 1e18` (1.0 unit) which is 6.67× the
  cap. Every canary intent gated at LpGate(Basic(FillSizeCap{
  requested_e18:1e18, cap_e18:1.5e17 })) → 0 fills in 13.9h.

- **Fix:** Added `CANARY_NOTIONAL_USDC_E6=100000` (= 0.10 unit) to
  `.env.local` with a multi-line comment block explaining the math.
  Restarted stack; matcher boot log confirms `notional_usdc_e6:100000`.
  Post-fix matcher log now shows `"LP routed residual" size:1e17
  spread_bps:5` — the FillSizeCap path is GREEN.

- **Verification:** **NO settleMatch tx yet.** Now blocked downstream
  on the **OI gate** at the clearinghouse:
  `cast call ... maxOpenInterest(EURC)` returns `1_000_000_000` (= 1e9
  wei) while the matcher's OI gate compares against an 18-dec WAD
  `size = 1e17`. `max(11616, 592446) + 1e17 > 1e9` → revert. Root
  cause is a **unit mismatch in the on-chain config**: the
  `maxOpenInterestUsd` constants in `ConfigureArcPerpMarkets.s.sol:47`
  are written as `1_000e6` (USDC 6-dec quantums) but
  `FxPerpClearinghouse.openInterestLong/Short` track magnitudes in
  18-dec WAD. So the cap is effectively 1 nano-unit. Out of scope to
  fix in this iter (needs contract `setMaxOpenInterest` admin call
  with the deployer key; not on this branch). New `bufi-matcher.log`
  scan: tick is now reaching settlement, just being vetoed by the
  contract.

- **Status:** **RED** — FillSizeCap unblocked, but OI cap config bug
  still blocks settleMatch. Hand off to CHARLIE/DELTA for
  `setMaxOpenInterest` (multiply existing constants by 1e12, or change
  them to e.g. `1_000e18`). Once OI cap is corrected, this branch
  should produce its first `settleMatch` tx within ~30s of canary tick.

## BRAVO.2 — Hardcoded values

Building on ALPHA iter 1 list + my own re-scan of money-market/,
trade-island/, perps-replacement-agent/:

| File:line | Value | Classification | Disposition |
|---|---|---|---|
| `money-market/bento-2/market-info/index.tsx:21-23` | `assetData=[]`, `apyData=null` | **(b) feature gap** | Component renders skeleton forever — no fetch wired. Not fake data, just empty. Acceptable for ECHO dogfood (no misleading numbers); document for DELTA to wire to Morpho rates API. |
| `money-market/bento-3/boofi-ai-assistant/index.tsx:15` | `mockAuthenticate()` returns random true/false | **(a) intentional demo** | AI assistant gate is decorative; auth path not wired to Dynamic. Acceptable. |
| `trade-island/arcade.tsx:130,135-137` | `stake=5`, `streak=2`, `balance=125420.5`, `pnlToday=316.14` | **(a) display-only sample** | Arcade minigame opaque wallet — confirmed intentional iter 1, no change. |
| `trade-island/multiplayer.tsx:693-697` | `round=1`, `countNum=3`, `wallet=125420.5` | **(a) demo placeholder** | Same as arcade. |
| `trade-island/loan.tsx:205 LOAN_MARKETS` | `supply/borrow/util/lltv/tvl = null` | **(c) explicit-null guard** | Renders "—"; comment at :283 forbids re-introducing fake APYs. Already correct. |
| `trade-island/index.tsx:170,765` | leaderboard + LOAN_POSITIONS hardcoded blocks | **(c) FIXED** | Both removed 2026-05-18 per comment; now read from /perps/positions + /perps/trades. Acceptable. |
| `perps-replacement-agent/**` | none | n/a | Clean. |

- **No new hardcoded prices/APYs/balances introduced since iter 1.**
  ECHO can dogfood without risk of misleading numbers on money-market
  (skeletons / dashes), trade-island loan (dashes), or perps panels
  (live `/perps/markets`). Arcade/multiplayer balance numbers are
  display-only on opaque wallets; leave.

## BRAVO.3 — Oracle freshness

Snapshot at `now = 1779647874` (unix). Queried Pyth contract
`0x2880aB155794e7179c9eE2e38200202908C17B43` via `getPriceUnsafe`. The
FxOracle (`0x77b3A3B420dB98B01085b8C46a753Ed9879e2865`) `priceOf`/
`getPrice` reverts on every market — the wrapper enforces a 60s max-
age check, so any feed older than 60s reverts at the wrapper. Pyth
raw state is the truthful row.

| feedId (abbrev) | symbol | last price | exp | publishTime | age (s) | status |
|---|---|---|---|---|---|---|
| `0x76fa…fa5c` | EURC/USD | 116_125_220 | -8 | 1779647853 | 21 | **fresh** |
| `0xeaa0…c94a` | USDC/USD | 99_974_091 | -8 | 1779647853 | 21 | **fresh** |
| `0xe62d…b43e` | BTC/USD (→ cirBTC) | 7_658_520_751_501 | -8 | 1779647853 | 21 | **fresh** |
| `0xef2c…fd52` | USD/JPY (→ tJPYC) | 159_195 | -3 | 1779483604 | **164_270** (~1.9d) | **VERY STALE** — Hermes returning frozen value |
| `0xe13b…77ca` | USD/MXN (→ MXNB)   | 1_732_755 | -5 | 1779483604 | **164_270** (~1.9d) | **VERY STALE** — same |

- **Push pattern (post-restart):** Matcher pyth_pusher refreshes 5
  feeds, but only 2-3 actually `pushed` per tick — the other 2 are
  `skipped` because Hermes returns the *same publishTime as the
  on-chain Pyth state*, so `updatePriceFeeds` no-ops. The skipped
  ones are tJPYC + MXNB. **Hermes itself has stale tJPYC + MXNB
  data on this branch.** Likely a Pyth Hermes outage on these
  emerging-market feeds — verified by pulling Hermes directly:
  same 1779483604 timestamp.

- **Impact on matching:** `LpGate(OracleStale)` denials seen for ~6s
  after restart (just the snapshot lag) then `LP routed residual`
  starts succeeding on EURC. Only EURC market is currently usable
  end-to-end; tJPYC / MXNB / cirBTC perps will fail at `priceOf`
  even with the OI cap fix.

- **Recommendation for FOXTROT:** Investigate Hermes feed status for
  `0xef2c…fd52` and `0xe13b…77ca`; if confirmed upstream outage,
  ECHO should pin trade dogfood to EURC + cirBTC only.

## Handoffs

- **To CHARLIE / DELTA:** The actual blocker is now the on-chain
  `maxOpenInterestUsd` constants. Re-run `ConfigureArcPerpMarkets.s.sol`
  with constants multiplied by 1e12 (or change them to `1_000e18`
  etc.), then call `setMaxOpenInterest` per market. Once that lands,
  expect first `settleMatch` tx ~30s later (canary interval).
- **To ECHO:** Trade dogfood limited to EURC market this iter. tJPYC
  + MXNB perps will show "stale oracle" until Pyth Hermes recovers.
  Money-market UI shows skeletons (not fake data) — no risk of
  misleading numbers.
- **To FOXTROT:** Pyth Hermes status check on USD/JPY + USD/MXN feeds
  is on the critical path for full asset coverage.
