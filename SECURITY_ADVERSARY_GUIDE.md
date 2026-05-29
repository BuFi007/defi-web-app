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
