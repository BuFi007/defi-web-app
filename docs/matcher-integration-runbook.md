# Matcher integration runbook — Arc Testnet smoke

End-to-end playbook for booting the Rust matcher against the live Arc
Testnet sprint-1 contracts + apps/api + frontend. Use this the first
time the matcher runs against real chain state, or whenever a new
contributor needs to repro the integration locally.

**Last verified against:** fx-telarana `7d9e120` (2026-05-22 sprint-1),
defi-web-app `15c2d82` (Wave N8, 2026-05-23), matcher PR #107.

---

## 0 — Repos required side-by-side

```
~/coding-dojo/
├── defi-web-app/                    apps/api + apps/web (TS)
├── defi-web-app-rust-matcher/       matcher worktree (this branch)
└── fx-telarana/                     contracts + deployment manifests
```

`FX_TELARANA_DEPLOYMENTS` env defaults to `../../fx-telarana/deployments`
relative to `pwd`, which works when the matcher binary is launched from
inside `~/coding-dojo/defi-web-app-rust-matcher/services/matcher/`. If
your layout differs, set the env explicitly (see §3).

---

## 1 — Snapshot of what's live on Arc Testnet (chainId 5042002)

Per `~/coding-dojo/fx-telarana/docs/INTEGRATION_HANDOFF.md`:

| Contract | Address |
|---|---|
| `FxOrderSettlement` | `0x93C3d831D6F0657479d7Fb6Cf0D06e75aA05E4CC` |
| `FxPerpClearinghouse` | `0x39dc43E2133CF860c1d17d4DB75Ef4204eebD46A` |
| `FxFundingEngine` | `0x859bA11A3693895f8B03C31C6AE3b8F04992115B` |
| `FxOracle` | `0xf9b0356A31BC7125e2eD0DADf8b5957860d42c78` |
| `FxMarginAccount` | `0x4EB6018F988301417B93cb2b8899D74D42273e96` |

Markets listed: EURC, tJPYC, tMXNB, cirBTC. EIP-712 domain on the
contract: `EIP712("TelaranaFxOrderSettlement", "1")` — matches the
matcher's `bufi-matcher-types` schema exactly.

USDC is native gas on Arc — fund every signing EOA with USDC, not AVAX.

---

## 2 — Pre-flight: stop the TS keepers

The Rust matcher replaces both TS keepers. Running them in parallel
would double-settle. Verify nothing's running:

```bash
pgrep -fl 'keeper-perps-matcher' || echo 'TS matcher not running ✓'
pgrep -fl 'keeper-perps-funding' || echo 'TS funding poker not running ✓'
```

Then make sure your monorepo dev runner skips them:

```bash
# If you use turbo dev:
cd ~/coding-dojo/defi-web-app
turbo run dev --filter='!@bufi/keeper-perps-matcher' --filter='!@bufi/keeper-perps-funding'
```

Keep `apps/keeper-perps-liquidator` running — it's a separate keeper.

---

## 3 — Configure `.env.local`

Add these to `~/coding-dojo/defi-web-app/.env.local` (the API + frontend
already use this file; matcher reads from the same env when launched
from inside this monorepo):

```bash
# --- Shared SQLite DB (already set if you run apps/api) ---
BUFI_DB_PATH=/Users/<you>/coding-dojo/defi-web-app/.bufi/trading-machine.sqlite

# --- Where the matcher finds Arc contract addresses ---
FX_TELARANA_DEPLOYMENTS=/Users/<you>/coding-dojo/fx-telarana/deployments

# --- Arc Testnet ---
MATCHER_CHAIN_ID=5042002
ARC_RPC_URL=https://rpc.testnet.arc.network

# --- 3 DISTINCT funded EOAs ---
# (boot fails fast if any two collide)
PERP_KEEPER_PRIVATE_KEY=0x<keeper hex, must have SETTLER_ROLE>
LP_OPERATOR_PRIVATE_KEY=0x<lp hex, must have USDC margin on FxMarginAccount>
CANARY_TRADER_PRIVATE_KEY=0x<canary hex, must have USDC margin>
```

For first-run dry tests you can leave `LP_OPERATOR_PRIVATE_KEY` and
`CANARY_TRADER_PRIVATE_KEY` unset — the matcher will boot as a pure CLOB
with the LP backstop + canary disabled.

---

## 4 — Boot the matcher

```bash
cd ~/coding-dojo/defi-web-app-rust-matcher/services/matcher
cargo build --release -p bufi-matcher-server
RUST_LOG=bufi_matcher=info,bufi_perps_db=info,bufi_perps_onchain=info \
  cargo run --release -p bufi-matcher-server --bin bufi-matcher
```

Expected boot log highlights:

```
BUFI matcher server starting
DB opened path=/Users/<you>/coding-dojo/defi-web-app/.bufi/trading-machine.sqlite
deployment loaded chain_id=5042002 order_settlement=0x93C3d831... clearinghouse=0x39dc43E2...
LP backstop enabled (Phase 4 Path A) lp_operator=0x...
canary keeper enabled (Phase 7) canary_trader=0x...
```

If you see `LP backstop disabled (no LP_OPERATOR_PRIVATE_KEY set)` —
that's expected for CLOB-only mode.

---

## 5 — Smoke test checklist

Run these in order. Each step's "PASS" condition is concrete.

### 5.1 Matcher reaches Arc Testnet

```bash
# Check the matcher can read marketConfig for the EURC/USDC market.
cd ~/coding-dojo/defi-web-app-rust-matcher/services/matcher
ARC_RPC_URL=https://rpc.testnet.arc.network \
PERP_KEEPER_PRIVATE_KEY=$PERP_KEEPER_PRIVATE_KEY \
FX_TELARANA_DEPLOYMENTS=~/coding-dojo/fx-telarana/deployments \
  cargo test -p bufi-matcher-server --bin bufi-matcher -- \
    --ignored query_oi_against_live_arc_testnet
```

**PASS:** test prints `openInterestLong / openInterestShort / cap` values
from the live chain. **FAIL:** RPC error → check `ARC_RPC_URL` reachable;
manifest error → check `FX_TELARANA_DEPLOYMENTS` path.

### 5.2 API → DB → matcher pickup

Submit a tiny pending intent via the API (or directly via
`db.perpsIntents.put`) and watch the matcher's log:

**PASS:** within one tick cycle the matcher logs either
`intent ready to match` or a structured rejection (`SignerMismatch`,
`Expired`, `InvalidSize`). **FAIL:** silent — the matcher isn't reading
the same DB; double-check `BUFI_DB_PATH`.

### 5.3 EIP-712 signature recovery

If 5.2 shows `SignerMismatch`, the wire format drifted. Compare:
- TS signing recipe: `~/coding-dojo/fx-telarana/packages/sdk/scripts/perp-arc-trading-smoke.ts:215-260`
- Rust verification: `services/matcher/crates/matcher-server/src/intent_translator.rs:226-264`

Both MUST use:
- EIP-712 domain `name="TelaranaFxOrderSettlement"`, `version="1"`,
  `chainId=5042002`, `verifyingContract=0x93C3d831...`
- 65-byte `r||s||v` with `v ∈ {27, 28}` (NOT 0/1)
- TypeHash: `keccak256("SignedOrder(address trader,bytes32 marketId,int256 sizeDeltaE18,uint256 priceE18,uint256 maxFee,uint8 orderType,uint8 flags,uint64 nonce,uint64 deadline)")`

### 5.4 Settle one match on-chain

Submit two opposite-side limit intents (`packages/perps` has helpers).

**PASS:** matcher logs `settleMatch confirmed tx=0x...`, both DB rows
flip to `filled`, on-chain `openInterest{Long,Short}` increases.
Inspect via:
```bash
cast call $FX_PERP_CLEARINGHOUSE 'openInterestLong(bytes32)' $MARKET_ID \
  --rpc-url https://rpc.testnet.arc.network
```

### 5.5 Canary keeper liveness

If `CANARY_TRADER_PRIVATE_KEY` is set, within 30 minutes of boot you
should see:
```
canary keeper started trader=0x... market=0x565a6e2f... interval_secs=1800
canary tick: terminal status reached intent_id=0x... status=filled latency_ms=NNN
```

**PASS:** `latency_ms` < 60_000 typically (one tick + one confirmation
buffer). **FAIL:** `canary tick failed; alerting operators` — read the
error: timeout (matcher not picking it up), Db (DB conflict), Sign
(signing path bug).

### 5.6 LP backstop end-to-end (Path A)

This is the path the Phase 7.1 fix was about. Submit a taker intent
larger than the resting book, with `LP_OPERATOR_PRIVATE_KEY` set:

**PASS:** matcher logs `LP routed residual ...` then `settleMatch
confirmed tx=0x...` then BOTH the taker and the synthetic LP DB rows
flip to `filled`. No follow-up tick should re-attempt the same intent.
**FAIL:** if the next tick re-routes the same residual and reverts with
`NonceAlreadyUsed`, the C1 desync regressed — file an issue and stop.

---

## 6 — Tracing + observability

The matcher emits JSON logs. Pipe to `jq` for live tails:

```bash
cargo run --release -p bufi-matcher-server --bin bufi-matcher 2>&1 | \
  jq -c 'select(.fields.message != null) | {ts: .timestamp, lvl: .level, msg: .fields.message, mod: .target}'
```

Key fields to grep when something looks wrong:
- `"settleMatch confirmed"` — successful on-chain settlement (look for the tx hash)
- `"settleMatch failed"` — revert; pair with the tx hash and run `cast run` to inspect
- `"oracle stale"` — invariant 4 trip — Arc oracle is paused
- `"OI cap breach"` — invariant 1 trip — market hit its OI ceiling
- `"LP gate denied"` — one of invariants 1/3/4/5/7/8/10 — log includes the typed reason

---

## 7 — Known gaps (not blockers)

These are documented in `docs/matcher-mainnet-readiness.md` and don't
prevent testnet integration:

- **§3.5 fill durability** — kill -9 the matcher mid-settlement and
  restart — confirm the next tick doesn't replay or double-settle. Manual.
- **§4.3 LP TVL reconciliation** — `lp_positions.tvl_usdc_e6` should be
  reconciled against `FxMarginAccount.marginOf(LP_OPERATOR)` at boot.
  Today the matcher trusts the SQLite value.
- **§4.5 `if_burn_floor_usdc_e6`** — admin call required before LP is
  enabled in production (`max(0.01 × LP TVL, 10_000 USDC)`).
- **§6.2 OTEL exporter** — `MATCHER_OTEL_ENDPOINT` not yet wired; logs
  currently land on stdout.

For full mainnet readiness, every ⬜ row in the readiness doc must be
addressed first. Sign-offs from matcher lead + fx-telarana owner +
operator are §10.

---

## 8 — Rollback to TS keepers

If the Rust matcher misbehaves in testnet and you need to revert
*without* unmerging the PR:

```bash
# Stop the Rust matcher (Ctrl-C or kill)
# Re-start the TS keeper:
cd ~/coding-dojo/defi-web-app
turbo run dev --filter='@bufi/keeper-perps-matcher' --filter='@bufi/keeper-perps-funding'
```

Both read the same SQLite, so pending intents pick up where the Rust
matcher left off. No DB migration needed.
