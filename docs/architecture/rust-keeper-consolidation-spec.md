# Rust Keeper Consolidation Spec

> All keeper logic converges into one Rust binary (`bufi-matcher`).
> TS keepers are deprecated. Envio replaces Ponder for position tracking.
> Work alongside the Envio migration and fx-telarana contract upgrades.

## Current State

```
RUST (inside bufi-matcher binary):
  ✓ CLOB sequencer + WS gateway + batch flusher
  ✓ Pyth WS pusher (oracle price feed)
  ✓ Funding poker (funding rate pokes)
  ✓ LP backstop (route residuals to LP)
  ✓ Event subscriber (on-chain event indexing)
  ✓ Canary (liveness probe trades)
  ✓ Expiry sweeper + Book WAL
  ✓ Perps liquidator
  ✓ Telarana liquidator
  ✓ Spot executor
  ✓ Gateway signer
  ✓ Arcade settler

TYPESCRIPT (separate bun processes, separate Railway services):
  none — all `apps/keeper-*` packages have been retired.
```

## Target State

```
ONE BINARY: bufi-matcher (services/matcher/)
  ├── CLOB: sequencer, WS gateway, batch flusher, book WAL
  ├── Oracle: pyth_pusher_ws (Pyth Hermes WS subscription)
  ├── Funding: funding_poker (pokes funding rate on-chain)
  ├── LP: lp_router, lp_signer (backstop liquidity)
  ├── Events: event_subscriber (on-chain event indexing)
  ├── Health: http_health (/ready, /health), gRPC server
  ├── Realtime: Redis publisher, broadcast channels
  ├── Canary: liveness probe trades
  ├── Expiry: sweeper for stale intents
  │
  │  NEW MODULES (migrated from TS):
  ├── perps_liquidator.rs    ← from keeper-perps-liquidator
  ├── telarana_liquidator.rs ← from keeper-telarana-liquidator
  ├── spot_executor.rs       ← from keeper-spot
  ├── gateway_signer.rs      ← from keeper-gateway-signer
  └── arcade_settler.rs      ← from keeper-arcade-settler

ONE INDEXER: Envio HyperIndex (services/envio-yield/)
  ├── All position tracking (replaces SQLite DB scanning)
  ├── Yield engine (fee accrual, composite APY)
  └── GraphQL API consumed by UI + matcher

STAYS TYPESCRIPT:
  └── apps/api/ (HTTP REST + WS price feeds — not latency critical)
```

## Migration Plan

### Phase 0: Delete Dead TS Keepers

Remove from the monorepo and Railway:
- `apps/keeper-perps-matcher/` — empty, Rust CLOB replaced it
- `apps/keeper-perps-funding/` — empty, Rust funding_poker replaced it
- `apps/keeper-pyth/` — duplicate, Rust pyth_pusher_ws replaced it
- `apps/keeper-perps-liquidator/` — Rust `perps_liquidator.rs`
- `apps/keeper-telarana-liquidator/` — Rust `telarana_liquidator.rs`
- `apps/keeper-spot/` — Rust `spot_executor.rs`
- `apps/keeper-gateway-signer/` — Rust `gateway_signer.rs`
- `apps/keeper-arcade-settler/` — Rust `arcade_settler.rs`

Remove from `scripts/dev-up.sh` and Railway service list.

### Phase 1: Perps Liquidator → Rust

**Why first:** Highest risk component. Bad debt comes from slow liquidation.

**Current TS logic (105 lines):**
1. `knownAccounts()` — scan SQLite for all traders with intents
2. For each account: `healthChecker.isLiquidatable(marketId, trader)`
3. If liquidatable: `flagAccount()` then `liquidate()`

**Rust replacement (`perps_liquidator.rs`):**

```rust
pub struct PerpsLiquidator {
    onchain: PerpsOnchain,
    deployment: PerpsDeployment,
    envio_url: String,  // GraphQL endpoint for open positions
}
```

Key improvements over TS:
- **Event-driven**: Subscribe to `pyth_pusher_ws` price channel.
  On every price tick, check all positions for the affected market.
  Sub-second liquidation instead of 30s poll.
- **Envio position set**: Query Envio for all open positions on boot.
  Subscribe to `PositionChanged` events for incremental updates.
  Catches positions created outside our API.
- **Atomic liquidation**: Deploy `LiquidationRouter.sol` that does
  `flagAccount + liquidate` in one tx. No front-running gap.
- **Parallel checks**: Tokio spawns one task per market. All markets
  checked concurrently on every price tick.

**Config:**
```
LIQUIDATOR_ENABLED=true
LIQUIDATOR_ENVIO_URL=https://indexer.dev.hyperindex.xyz/6ff8fed/v1/graphql
LIQUIDATOR_CHECK_INTERVAL_MS=1000   # fallback poll if WS is down
LIQUIDATOR_MIN_MARGIN_RATIO=0.05    # 5% — flag below this
```

**Integration point:** The Pyth WS price stream already runs in the
matcher. The liquidator taps the same `broadcast::Sender<PriceTick>`
channel. Zero additional network calls for price data.

### Phase 2: Telarana Liquidator → Rust

**Why second:** Morpho liquidations protect lender capital.

**Current TS logic (260 lines):**
1. For each Morpho market: read position health from MorphoBlue
2. If unhealthy: call `FxLiquidator.liquidate()`
3. Handles multi-hub (Fuji + Arc) and multi-market scanning

**Rust replacement (`telarana_liquidator.rs`):**

```rust
pub struct TelaranaLiquidator {
    hubs: Vec<LendingHubConfig>,  // from fx-telarana chains.ts
    envio_url: String,
}
```

Key improvements:
- **Envio for position tracking**: Query `LendingEvent` entities
  to know which accounts have borrows. No DB scanning.
- **Parallel hub scanning**: Check Fuji + Arc simultaneously.
- **Shared RPC client**: Reuse the matcher's Alloy provider
  instead of creating new viem clients per tick.

**Dependency:** Needs the MorphoBlue ABI and hub config ported
to the `bufi-perps-onchain` crate (or a new `bufi-telarana` crate).

### Phase 3: Spot Executor → Rust

**Current TS logic (24 lines):**
1. Poll for pending gateway swap requests
2. Execute `FxSpotExecutor.executeSpotFx()`

**Rust replacement (`spot_executor.rs`):**
Trivial port — 24 lines of TS becomes ~40 lines of Rust. Subscribe
to `GatewayAtomicFxSwapRequested` events via the event_subscriber
(already indexed). Execute on detection.

### Phase 4: Gateway Signer → Rust

**Current TS logic (23 lines):**
1. Poll for `LockedForRemote` events
2. Fetch Circle CCTP attestation
3. Relay attestation on destination chain

**Rust replacement (`gateway_signer.rs`):**
HTTP call to Circle's attestation API + on-chain relay. The existing
`reqwest` client in the matcher handles the HTTP. The Alloy provider
handles the on-chain write.

## New Smart Contract: LiquidationRouter.sol

Deployed alongside the fx-telarana contract upgrades.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IFxLiquidationEngine} from "./interfaces/IFxLiquidationEngine.sol";

/// @notice Atomic flag + liquidate in one transaction.
/// Eliminates the gap between flagging and liquidation where
/// price can move further or another keeper can front-run.
contract LiquidationRouter {
    IFxLiquidationEngine public immutable engine;

    constructor(address _engine) {
        engine = IFxLiquidationEngine(_engine);
    }

    function liquidateAtomic(
        bytes32 marketId,
        address trader,
        uint256 maxClose
    ) external {
        engine.flagAccount(marketId, trader);
        engine.liquidate(marketId, trader, maxClose);
    }

    function liquidateBatch(
        bytes32[] calldata marketIds,
        address[] calldata traders,
        uint256[] calldata maxCloses
    ) external {
        require(
            marketIds.length == traders.length &&
            traders.length == maxCloses.length,
            "length mismatch"
        );
        for (uint256 i = 0; i < marketIds.length; i++) {
            engine.flagAccount(marketIds[i], traders[i]);
            engine.liquidate(marketIds[i], traders[i], maxCloses[i]);
        }
    }
}
```

## Oracle Circuit Breaker

Added to the matcher's Pyth WS handler. Not a separate keeper.

```rust
pub struct OracleCircuitBreaker {
    max_stale_secs: u64,       // 30s warning, 60s pause, 120s emergency
    max_deviation_bps: u64,    // 200 bps (2%) from TWAP → pause
    twap_window_secs: u64,     // 300s (5 min) TWAP
}
```

Thresholds:
```
Pyth age > 30s  → log warning, increase margin requirements 2x
Pyth age > 60s  → pause new position opens on affected markets
Pyth age > 120s → emergency: close all 50x+ positions at last known price
Price > 2% from 5min TWAP → pause new opens, flag for manual review
```

## Envio Integration Points

The consolidated matcher queries Envio for:

| Query | Used by | Frequency |
|-------|---------|-----------|
| All open perps positions | perps_liquidator | On boot + PositionChanged subscription |
| All Morpho borrow positions | telarana_liquidator | On boot + Borrow/Repay subscription |
| Pending gateway swaps | spot_executor | On boot + event subscription |
| Daily fee snapshots | UI composite APY | On request (GraphQL) |

The matcher subscribes to Envio's real-time updates (if available)
or polls the GraphQL endpoint every 5s as fallback.

## Railway Deployment Changes

**Before (7 services):**
```
matcher           ← Rust binary
bufi-api          ← TS API server
keeper-perps-liquidator  ← TS (bun)
keeper-telarana-liquidator ← TS (bun)
keeper-spot       ← TS (bun)
keeper-gateway-signer ← TS (bun)
keeper-arcade-settler ← TS (bun)
```

**After (3 services):**
```
matcher           ← Rust binary (runs CLOB + all keeper roles)
bufi-api          ← TS API server
ponder/envio      ← indexer (Ponder locally, Envio target)
```

Cost reduction: 7 → 3 Railway services. Fewer processes to monitor.
Single binary to deploy. One health endpoint to check.

## Implementation Order

| Phase | What | Effort | Depends on |
|-------|------|--------|------------|
| 0 | Delete dead TS keepers | 30 min | Nothing |
| 1 | perps_liquidator.rs + LiquidationRouter.sol | 3 days | Envio deployed |
| 2 | telarana_liquidator.rs | 2 days | Phase 1 patterns |
| 3 | spot_executor.rs | 1 day | Phase 1 patterns |
| 4 | gateway_signer.rs | 1 day | Phase 3 |
| 5 | Oracle circuit breaker | 1 day | Phase 1 |
| 6 | Remove TS keepers from Railway | 30 min | All phases done |

Total: ~8 days of engineering. Can overlap with Envio migration and
fx-telarana contract work since the Rust modules are additive (they
don't break the existing TS keepers during transition).

## Transition Strategy

Dual-run during migration:
1. Deploy new Rust module alongside existing TS keeper
2. Both run simultaneously — Rust is faster, gets there first
3. Monitor for 48h — compare Rust vs TS liquidation timing
4. If Rust is strictly faster + no missed liquidations → kill TS keeper
5. Repeat for each keeper

Never cut over without a dual-run validation period. The TS keeper
is the safety net until the Rust module proves itself.

## Relationship to Other Specs

- **Hybrid CLOB Spec** (`docs/architecture/hybrid-clob-spec.md`):
  The CLOB sequencer is Phase 1-5 of this spec's foundation. The
  liquidator modules plug into the same binary.

- **Unified Liquidity Layer** (`docs/architecture/turbo-fee-vault-spec.md`):
  The TurboFeeVault contract routes fees. The consolidated matcher
  generates the trades that produce those fees. Both are part of the
  same fx-telarana deployment.

- **Envio Yield Engine** (`services/envio-yield/`):
  The indexer that replaces Ponder AND provides the position set for
  the liquidation modules. Must be deployed before Phase 1 starts.

- **FxHedgeHook** (hookathon):
  The hedge hook opens perps positions. The perps_liquidator monitors
  those positions. They're in the same binary, sharing the same price
  feed. This is the architecture that makes sub-second hedge
  liquidation possible.
