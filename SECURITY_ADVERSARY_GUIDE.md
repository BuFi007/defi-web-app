# MCP Adversary Guide — protocol-parity coverage

Adversarial probe log built as the MCP gains 100% coverage of the deployed
protocol surface. Each family is probed as an attacker (malformed input, auth
bypass, overflow/precision, stale-oracle, reentrancy-shaped). Read-only surfaces
have low state-change risk; the value is mapping every entry point + its guards.

Registry of targets: `apps/hyper-mcp/src/registry/contracts.json`.

---

## Family 1 — FxOracleV2 (`/api/oracle/*`) · read-only · `0xdA5Cd6…`

**Routes:** `GET /api/oracle/price?base&quote`, `GET /api/oracle/info`.

| Probe | Result | Verdict |
|---|---|---|
| Input injection (`base=<script>`) | 400 — zod regex `^[A-Za-z]{2,8}$` rejects | ✅ blocked |
| Overflow (20-char base) | 400 — regex max-length 8 | ✅ blocked |
| Unknown token (`base=FAKE`) | graceful error + `supported[]`, no crash | ✅ |
| Same base/quote | rejected ("must differ") | ✅ |
| Unconfigured pair (`cirBTC/AUDF`) | graceful `error+hint`, no revert leak | ✅ |
| No auth on reads | allowed — correct (read-only; data is public on-chain) | ✅ by design |

**Security-relevant property — staleness.** The real oracle risk is a *stale* price
feeding a swap. The route surfaces `ageSeconds` + a `stale` flag (`>maxStaleSeconds`,
default 3600) so consumers refuse stale quotes. FxOracleV2 itself gates freshness in
`getMid` (Pyth → RedStone → Chainlink fallback). **Adversary note:** if a consumer
ignores `stale`, a frozen feed (e.g. CAD cron down) lets QCAD mids drift — always
check `stale` before acting on a price.

**Minor finding (contract team):** `FxOracleV2.decimals()` read returns null
(staticcall empty/reverts) — cosmetic for the MCP (handled), but the getter looks
non-functional; confirm it's wired.

**Live sanity:** EURC/USDC mid = ~1.1675 (1e18-scaled), age ~25s, not stale. ✅

---

## Family 2 — SharedFxVault + TurboFeeVault (`/api/vault/*`, `/api/lp/*`) · `0x0E63…` / `0x929e…`

**Routes:** `GET /vault/depths`, `GET /lp/info`, `GET /lp/position?address`, and PREPARE-only
`POST /lp/{deposit,withdraw,claim}` (unsigned calls; the user signs).

| Probe | Result | Verdict |
|---|---|---|
| Bad LP address (`lp=notanaddr`) | 400 — zod `^0x[0-9a-fA-F]{40}$` | ✅ |
| Negative/junk amount (`-5`) | 400 — amount regex `^\d+(\.\d+)?$` | ✅ |
| Injection in shares (`1;DROP`) | 400 — shares regex `^\d+$` | ✅ |
| `position?address=0xzz` | 400 — addr regex | ✅ |
| Huge amount (1e18 USDC, overflow probe) | handled — BigInt atomic, no crash | ✅ |
| No auth on reads / prepares | allowed — correct (reads are public; writes are unsigned PREPAREs the user signs) | ✅ by design |

**Write safety:** deposit/withdraw/claim are **prepare-only** — the MCP returns the unsigned
contract call (+ an `approvalNeeded` preflight for deposit), never holds keys or moves funds.
An attacker hitting these gets only an unsigned payload; execution requires the user's signature.

**Security-relevant property — fee split + insurance.** The 50/40/10 split (protocol/LP/insurance)
is **immutable on-chain** (`PROTOCOL_BPS`/`LP_BPS`/`INSURANCE_BPS` constants), so it can't be
re-pointed by a compromised operator — good. The 10% insurance fund is the hedge-failure backstop;
its solvency vs open hedge exposure is the real risk to monitor (covered when `/api/hedge/*` lands).

**Live sanity:** junior buffers USDC 27,098 + EURC 10,091 / MXNB 176,590 / QCAD 13,850 / AUDF 9,967;
TurboFeeVault totalDeposits 0 + APY 0 (no LPs yet — correct). ✅

---

## Family 3 — FxHedgeHook (`/api/hedge/*`) · `0x466e…`

**Routes:** `GET /hedge/pools`, `GET /hedge/status?poolId`, PREPARE `POST /hedge/unpause`.

| Probe | Result | Verdict |
|---|---|---|
| Bad poolId (`0xdead`, short) | 400 — zod `^0x[0-9a-fA-F]{64}$` | ✅ |
| Injection poolId (`0x' OR 1`) | 400 — regex | ✅ |
| Unconfigured poolId (valid format) | graceful (`known:false` + read result/err) | ✅ |
| `unpause` bad poolId | 400 | ✅ |

**Security-relevant property — delta exposure + the unpause control.** `currentDelta` is the
LP's neutrality guarantee (int256; `0` = neutral). A non-zero delta = unhedged exposure → the
insurance fund is what backstops a hedge failure, so **delta drift vs insurance-fund solvency is
the core LP-insurance risk** to monitor. `unpauseHedge` is **owner-gated on-chain**
(`POOL_CONFIGURATOR_ROLE`); the MCP only returns an unsigned prepare — it does NOT gate it, so the
real control is the on-chain role. **Adversary note:** if `POOL_CONFIGURATOR_ROLE` is loosely
assigned (e.g. still the deployer EOA with a hot key), an attacker who compromises that key could
unpause/mis-configure hedging — confirm the role sits behind a timelock/multisig before mainnet.

**Live sanity:** JPYC pool (`0xd194…3504`) currentDelta=0, isDeltaNeutral=true. ✅

---

## Family 4 — FxSwapHooks + FxRouter (`/api/fxswap/*`) · hooks `0xe66d/0x5410/0x04a1/0x72aE`, router `0xd660`

**Routes:** `GET /fxswap/pools`, `GET /fxswap/quote?asset&amountIn&side`, `GET /fxswap/intent-shape` (doc).

| Probe | Result | Verdict |
|---|---|---|
| Bad asset (`FAKE`) | 400 — zod enum | ✅ |
| Junk amount (`abc`) | 400 — regex | ✅ |
| Bad side (`hack`) | 400 — enum buy/sell | ✅ |
| Huge amount (1e8, slippage probe) | handled (quote capped by tradable) | ✅ |
| QCAD quote | graceful error — reverts `0x33d02f9b` (stale CAD feed) | ✅ |

**Security-relevant properties:**
- **Constant-spread MVP, no size-impact curve.** `effectiveSpreadBps` is flat (~30bps); price doesn't
  slip with size, but fills are capped by `tradableAssets`. **Adversary note:** a quote can look fine
  while the actual swap underfills/reverts because the pool is near-empty (AUDF `tradableAssets≈0`).
  Until DODO-PMM ships, large swaps are liquidity-bounded, not price-bounded.
- **Oracle-staleness DoS.** QCAD quotes revert because the CAD/USD feed is stale (cron-dependent).
  If the CAD relayer cron (`0x861A…D3A6`) loses gas, **all QCAD swaps brick** — a liveness/DoS vector
  worth a watchdog + alert.
- **executeIntent guards (good):** EIP-712-signed `FxIntent`, pair must be allow-listed
  (`setPairAllowed`), `feeBps ≤ maxFeeBps`, deadline-bounded, `nonReentrant`. **But** `setPairAllowed`/
  `setSwapAdapter` are `onlyOwner` — same hot-key concern: a compromised owner could allow a malicious
  pair or swap a drain adapter. Confirm owner = timelock/multisig.

**Live sanity:** AUDF buy 100 USDC → ~0.0006 AUDF (pool near-empty, spread 30bps); QCAD reverts (stale). ✅

---

## Family 5 — Asset/Pool Registries (`/api/registry/*`) · `0x7618…` / `0x05B7…`

**Routes:** `GET /registry/assets`, `GET /registry/asset-address?symbol&chainId`, `GET /registry/routes?in&out`.

| Probe | Result | Verdict |
|---|---|---|
| Injection symbol (`<x>`) | 400 — regex `^[A-Za-z]{2,10}$` | ✅ |
| Negative chainId | 400 — `coerce.number().int().positive()` | ✅ |
| Unknown route token (`FAKE`) | graceful error, count 0 | ✅ |
| Huge chainId (1e21, overflow probe) | 200 graceful (read returns null) | ✅ |

**Security-relevant notes:** read-only discovery, low risk. **PoolRegistry routes are empty
(`count 0`)** — swaps currently route via FxRouter/hooks directly, NOT this registry. **Adversary
note:** if a consumer trusts PoolRegistry for routing and it's later populated by a compromised
`poolRegistryAdmin` (= deployer EOA `0x0646…`/`0xca43…`), it could point a router at a malicious
pool. The registries' write functions are admin-gated (not MCP-exposed); confirm the admin keys are
behind a timelock/multisig before relying on registry-driven routing.

**Live sanity:** 7 assets registered + enabled (USDC/EURC/JPYC/MXNB/AUDF/QCAD/cirBTC); EURC@5042002
resolves to `0x89B5…`; USDC→EURC routes = 0. ✅

---

## Family 6 — Perps + Liquidation + Gateway (`/api/perps/*`, `/api/liquidation/*`, `/api/gateway/*`)

**Routes:** `GET /perps/account`, `GET /perps/health`, `GET /perps/funding`, `GET /liquidation/status`, `GET /gateway/info`.
Contracts: FxMarginAccount `0x4EB6`, FxHealthChecker `0xA00B`, FxFundingEngine `0x859b`, LiquidationRouter `0xc98c`, FxGatewayHook `0x2931`.

| Probe | Result | Verdict |
|---|---|---|
| Bad address | 400 — addr regex | ✅ |
| Bad/short marketId | 400 — bytes32 regex | ✅ |
| Injection version (`1;DROP`) | 400 — coerce.int | ✅ |
| Unknown market (valid bytes32) | graceful (max-uint health / err) | ✅ |

**Security-relevant properties:**
- **`healthFactor` returns `type(uint256).max` for no-position** — a consumer must special-case this
  (don't render `1.15e77` as a ratio; it means "no debt / infinite health"). Liquidation triggers on
  `isLiquidatable` + `flaggedAt`.
- **Gateway is the biggest fund-custody risk.** `FxGatewayHook` is the only contract that moves USDC
  across hubs, and until Circle ships EIP-1271 on burn intents (~mid-July) the **deployer EOA
  `0x0646…` is the sole BurnIntent signing authority**. **Adversary note:** compromise of that one hot
  key = control of cross-hub USDC movement = the highest-severity path in the protocol. Top priority
  to rotate behind the hub contract / timelock (the CLAUDE.md "1271 authority rotation" plan). The
  `gatewayWithdrawalUnlockBlock` operator delay is the only time-buffer today.

**Live sanity:** agent margin 0 (no position), health = max-uint (no position), gateway balance
0.0479 USDC. ✅

---

## Family 7 — Lending PREPARE (Morpho Blue) (`/api/lending/*-prepare`) · Morpho `0x3c9b`/`0x65f4`

**Routes:** PREPARE-only `POST /api/lending/{supply,borrow,repay,withdraw}-prepare`.

| Probe | Result | Verdict |
|---|---|---|
| Bad marketId (`0xbad`) | 400 — bytes32 regex | ✅ |
| Bad amount (`-5`) | 400 — amount regex | ✅ |
| Bad trader (`xx`) | 400 — addr regex | ✅ |
| Unknown market (valid bytes32) | graceful error (not found on any Morpho) | ✅ |

**Security-relevant property — marketParams come from on-chain, not the caller.** The prepare reads
`idToMarketParams(marketId)` from Morpho itself and builds the call from that — so **a caller cannot
inject a fake oracle/irm/lltv** to trick the MCP into a malicious market; the marketId must resolve on
a real Morpho. supply/repay carry a loanToken→Morpho approval preflight; borrow/withdraw don't (you
receive). All four are prepare-only (no key custody). Borrow reverts on-chain without pre-supplied
collateral + health — enforced by Morpho, not the MCP.

**Live sanity:** USDC market (`0x9e18…`) → supply/borrow/repay/withdraw prepares resolve on Morpho
`0x3c9b` with correct marketParams + approval preflight. ✅

---

## Coverage: 100% — every deployed family exposed + probed

oracle · vault/lp · hedge · fxswap · registry · perps · liquidation · gateway · lending.
**Top risks for the security pass (severity order):** (1) **gateway authority = single deployer hot
key** until Circle-1271 (cross-hub USDC custody — rotate first); (2) **QCAD/CAD oracle-staleness DoS**
(cron-dependent, bricks QCAD swaps); (3) **`onlyOwner`/admin keys** on `setSwapAdapter`/`setPairAllowed`
(router), `POOL_CONFIGURATOR_ROLE` (hedge), registry admins — all the deployer EOA; loosely-held →
malicious-pair / drain-adapter / mis-route vectors. All write paths in the MCP are prepare-only
(unsigned; the user signs) — the MCP holds no keys and moves no funds.
