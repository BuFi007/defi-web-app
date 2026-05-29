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
