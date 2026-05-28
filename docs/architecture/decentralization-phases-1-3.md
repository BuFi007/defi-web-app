# BUFX Decentralization — Phases 1-3 Spec

> Move BUFX from "trusted matcher" to "trusted operator set" — roughly dYdX v3
> level decentralization. Each phase is independently shippable. Phase 4+
> (operator set with slashing, commit-reveal, encrypted mempool) live in a
> separate spec.

## Audit baseline

| Risk | Severity | Source |
|------|----------|--------|
| R1: Single EOA owns all 7 contracts | Medium | `reports/AUDIT_REPORT.md` |
| Matcher monopoly on funding rate updates | High | This spec |
| Matcher monopoly on liquidation timing | High | This spec |

## Goals

- **No single key** can hold the protocol hostage.
- **Anyone** with stake in the protocol (LP, trader, liquidator) can keep it
  running by pushing time-sensitive operations.
- **Admin functions** (parameter changes, contract upgrades, fee splits) require
  multisig consent + timelock delay.

## Non-goals (deferred to later phases)

- Match selection authority (matcher still picks order pairs — Phase 4+)
- Sequencer set consensus (Phase 5+)
- MEV-resistant order placement (Phase 6+)

---

## Phase 1 — Permissionless funding poke + bounty

### Current state

`FxFundingEngine.pokeFundingRate(marketId)` at `contracts/src/perp/FxFundingEngine.sol:83`
is already publicly callable. There is no access control gate. But in
practice **only the Rust matcher's funding_poker module calls it**, because:

1. No bounty incentivizes external callers.
2. The cumulative funding update is silent — no public dashboard.
3. The matcher polls every market every block.

If the matcher goes down, funding stops updating. Traders accrue unrealized
funding indefinitely until someone notices.

### Spec

Add a **funding poke bounty** paid in USDC to whoever pokes a stale market.

**Contract changes:**

```solidity
// FxFundingEngine.sol

uint256 public constant POKE_BOUNTY_USDC = 100_000; // 0.10 USDC
uint256 public constant POKE_BOUNTY_MAX_STALENESS = 5 minutes;

event FundingPokeRewarded(bytes32 indexed marketId, address indexed caller, uint256 bountyUsdc);

function pokeFundingRate(bytes32 marketId) public whenNotPaused {
    MarketFundingState storage state = _state[marketId];

    // Existing funding logic ...

    // NEW: reward stale pokes from protocolLiquidity bucket
    uint256 stale = block.timestamp - state.lastUpdate;
    if (stale >= POKE_BOUNTY_MAX_STALENESS && msg.sender != address(0)) {
        uint256 bounty = POKE_BOUNTY_USDC;
        // Cap bounty at available protocolLiquidity to avoid reverting on empty
        uint256 available = MARGIN_ACCOUNT.protocolLiquidity();
        if (bounty > available) bounty = available;
        if (bounty > 0) {
            MARGIN_ACCOUNT.withdrawProtocolLiquidity(msg.sender, bounty);
            emit FundingPokeRewarded(marketId, msg.sender, bounty);
        }
    }
}
```

**Rust matcher changes:**

The `funding_poker` module stays for the **safe-default case** where no
external poker exists. But it MUST:

1. Default `FUNDING_POKER_ENABLED=false` (matches Phase 0 keeper flag convention).
2. When enabled, ONLY poke markets that are >5 minutes stale (avoid burning
   bounty on freshly-updated markets).
3. Remove the per-block polling — switch to event-driven via Envio
   subscription to `FundingPoked` events.

**Frontend:**

- Add "Funding staleness" indicator to the loan/perps tabs.
- If a market is >5 min stale, show a "Poke funding rate" CTA that any user can
  click to earn the bounty.
- Display total bounties paid in the protocol stats.

**Tests:**

- `test_pokeFundingRateRewardsStalePoker` — confirms 0.10 USDC bounty after 5+ min staleness.
- `test_pokeFundingRateNoRewardWhenFresh` — no bounty if <5 min since last poke.
- `test_pokeFundingRateRespectsMaxBounty` — cap at `protocolLiquidity` balance.

### Acceptance criteria

- [ ] `pokeFundingRate` pays 0.10 USDC bounty for stale (>5 min) pokes.
- [ ] Rust matcher `FUNDING_POKER_ENABLED=false` by default.
- [ ] Frontend shows funding staleness indicator.
- [ ] Public "Poke funding" CTA works for any wallet.
- [ ] Forge tests pass.

---

## Phase 2 — Permissionless liquidation with bounty (already partial)

### Current state

`FxLiquidationEngine.liquidate()` at line 130 is **already publicly callable**.
Same goes for `LiquidationRouter.liquidateAtomic()`. The liquidator reward is
paid from the trader's margin via `payLiquidatorReward()`.

But in practice **only the Rust matcher's perps_liquidator module calls it**, because:

1. No public dashboard shows underwater positions.
2. The matcher polls every position every block via direct RPC.
3. External keepers don't know which positions to target.

If the matcher goes down, bad debt accumulates.

### Spec

Make liquidations discoverable AND incentivized for external keepers.

**Contract changes (small):**

`FxLiquidationEngine` already emits `AccountFlagged(marketId, trader)`. Add:

```solidity
// FxLiquidationEngine.sol — add view function

struct LiquidatableAccount {
    bytes32 marketId;
    address trader;
    int256 healthBps;       // current health factor
    uint256 estimatedReward; // USDC bounty if liquidated now
}

function listLiquidatable(bytes32 marketId, uint256 limit)
    external view returns (LiquidatableAccount[] memory);

// Internal: enumerate flagged accounts where flagDelay has elapsed.
```

This is just a convenience view — the actual `liquidate()` call is already
permissionless. Adding this view lets external keepers discover targets without
running a full event indexer.

**Envio indexer changes:**

Index `AccountFlagged` events to a new `LiquidatableAccount` GraphQL entity.
Expose via API at `/perps/liquidatable?chainId=5042002`.

**Rust matcher changes:**

The `perps_liquidator` module stays as a **safe-default last resort**:

1. Default `LIQUIDATOR_ENABLED=false` (already done in Phase 0 audit fix).
2. When enabled, only fires if the position has been flagged for >2x flagDelay
   without anyone else liquidating it. Gives external keepers first dibs.
3. Switch from RPC polling to Envio subscription on `AccountFlagged` events.

**Frontend:**

- New `/liquidations` page showing all flagged positions with bounties.
- "Liquidate now" button — opens MetaMask, signs `liquidateAtomic()` call.
- Show top liquidators leaderboard (last 7 days, by USDC earned).
- Show bounties available per market.

**Telarana:**

Same pattern for Telarana lending. `FxLiquidator.liquidate()` is already
public. Add view + Envio entity for liquidatable loans.

**Tests:**

- `test_listLiquidatableReturnsFlagged` — view enumerates flagged accounts.
- `test_externalLiquidatorEarnsReward` — non-matcher address can liquidate and receive USDC.
- `test_matcherLastResortDelay` — Rust matcher waits 2x flagDelay before firing.

### Acceptance criteria

- [ ] `listLiquidatable` view returns flagged accounts with estimated bounties.
- [ ] Envio indexes `AccountFlagged` events into `LiquidatableAccount` entity.
- [ ] Frontend `/liquidations` page shows live positions with "Liquidate now" CTA.
- [ ] Rust matcher uses 2x flagDelay grace period; only acts as last resort.
- [ ] Bounty leaderboard visible.
- [ ] Forge tests pass.

---

## Phase 3 — Multisig + Timelock admin migration

### Current state

From `reports/AUDIT_REPORT.md` Case S4: all 7 audited contracts share a single
owner EOA `0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69`. Compromise of this key
grants:

- Morpho market creation, IRM/LLTV changes, fee recipient swap
- TurboFeeVault: setTreasury, insurance payout
- Bento: room limits, entry tokens, escrow swap (now constrained by F1-F5 fixes)
- Gateway: signerMode changes
- FxOracle: feed swaps
- FxFundingEngine: maxFundingRate cap
- FxHedgeHook: rebalance threshold

### Spec

Rotate all `DEFAULT_ADMIN_ROLE` and `onlyOwner` assignments to a **2-of-3
multisig** wrapped by a **48-hour TimelockController**.

**Deployment:**

```solidity
// Deploy TimelockController from OpenZeppelin
// constructor(minDelay, proposers, executors, admin):
TimelockController timelock = new TimelockController(
    2 days,                              // minDelay
    [multisig],                          // proposers (2-of-3 multisig)
    [address(0)],                        // executors (anyone after delay)
    address(0)                           // admin (renounced — no upgrade path)
);
```

**Multisig:**

Use Safe (formerly Gnosis Safe). 2-of-3 signers:
- 1 founder key (deployer)
- 1 operator key (separate machine, separate HSM)
- 1 emergency-only key (cold storage)

**Role rotation script:**

```bash
# fx-telarana/contracts/script/RotateAdminToTimelock.s.sol
# For each contract:
#   1. Grant timelock as DEFAULT_ADMIN_ROLE / OPERATIONS_ROLE
#   2. Revoke deployer EOA from those roles
# Order matters: grant first, revoke last (so we never lock ourselves out).
```

**Contracts touched (full list):**

| Contract | Roles to rotate |
|----------|-----------------|
| FxPerpClearinghouse | DEFAULT_ADMIN_ROLE, OPERATIONS_ROLE |
| FxOrderSettlement | DEFAULT_ADMIN_ROLE |
| FxMarginAccount | DEFAULT_ADMIN_ROLE, OPERATIONS_ROLE |
| FxFundingEngine | DEFAULT_ADMIN_ROLE |
| FxHealthChecker | DEFAULT_ADMIN_ROLE |
| FxLiquidationEngine | DEFAULT_ADMIN_ROLE, OPERATIONS_ROLE |
| FxSpotExecutor | DEFAULT_ADMIN_ROLE, OPERATIONS_ROLE |
| FxMarketRegistry | DEFAULT_ADMIN_ROLE |
| FxOracle | DEFAULT_ADMIN_ROLE |
| TurboFeeVault | DEFAULT_ADMIN_ROLE, FEE_DEPOSITOR_ROLE (keeper stays), INSURANCE_ADMIN_ROLE |
| FxHedgeHook | POOL_CONFIGURATOR_ROLE |
| LiquidationRouter | (no admin roles — already permissionless) |
| TelaranaGatewayHubHook | DEFAULT_ADMIN_ROLE |
| FxHubMessageReceiver | DEFAULT_ADMIN_ROLE |
| FxBentoRoomFactory | Ownable owner |
| FxBentoRoomEscrow | Ownable owner |
| FxBentoSettlementManager | Ownable owner |
| FxBentoRoundManager | Ownable owner |
| FxBentoCommitmentManager | Ownable owner |
| BuFxVenueRequestRouter | Ownable owner |
| BuFxTelaranaRequestRouter | Ownable owner |
| BuFxFeeConfig | Ownable owner |

**What STAYS with the keeper EOA** (not admin functions):

- `KEEPER_ROLE` on FxOrderSettlement (signs match settlements)
- `EXECUTOR_ROLE` on FxSpotExecutor (executes spot trades)
- `ATTESTOR_ROLE` on FxBentoSettlementManager (signs Bento results)
- `FEE_DEPOSITOR_ROLE` on TurboFeeVault (settlement contracts feed fees)

These are operational roles, not admin. They can be rotated independently if a
keeper key is compromised.

**Emergency pause path:**

Some contracts have `OPERATIONS_ROLE.pause()`. Keep a **separate emergency
multisig** (2-of-3) with ONLY pause permission, no admin. This allows fast
response to active exploits without waiting for the 48h timelock.

**Frontend:**

- Add "Admin parameters" page showing all admin-settable values + their next
  scheduled change (from timelock queue).
- Display timelock countdown for pending changes.
- Show emergency-pause multisig status (paused / unpaused).

**Tests:**

- `test_directAdminCallRevertsAfterRotation` — deployer EOA gets reverted on admin calls.
- `test_timelockProposalRequiresDelay` — proposed changes can't execute before delay.
- `test_emergencyMultisigCanPauseImmediately` — pause path bypasses timelock.

### Acceptance criteria

- [ ] Safe multisig deployed on Arc + Fuji (same address via CREATE2 if possible).
- [ ] TimelockController deployed with 2-day delay, multisig as proposer.
- [ ] All 22 listed contracts rotated to timelock as admin.
- [ ] Deployer EOA no longer holds DEFAULT_ADMIN_ROLE on any contract.
- [ ] Operational keeper roles untouched.
- [ ] Emergency pause multisig deployed and tested.
- [ ] Frontend admin page displays timelock state.
- [ ] Migration script tested on Tenderly Fuji vnet.
- [ ] Forge tests pass.

---

## Execution order

1. **Phase 1 (1-2 days)** — Lowest risk, highest visibility. Ship first to
   establish the "anyone can keep the protocol running" pattern.

2. **Phase 2 (2-3 days)** — Builds on Phase 1's external-keeper UX.
   Requires Envio indexer subscription work.

3. **Phase 3 (1 week)** — Highest risk (locked-out failure mode). Do AFTER
   Phase 1 + 2 are stable and traffic-tested. Execute on Tenderly vnet first,
   then Fuji testnet, then Arc.

**DO NOT** do Phase 3 first — if the timelock has bugs, you're locked out of
the protocol. Get external-keeper telemetry from Phase 1+2 first to validate
the protocol can run without the matcher's monopoly.

## Risks

| Risk | Mitigation |
|------|-----------|
| Timelock has a bug that bricks admin functions | Tenderly vnet test first; keep deployer EOA emergency key with 1-month grace period before final revoke |
| Bounty incentive too small / too large | Use a configurable bounty via the multisig (changeable through timelock) |
| External keeper races crash from bad gas estimation | `LiquidationRouter` already returns reward to specified recipient — keepers can simulate first |
| Multisig signers go offline | 2-of-3 means any 2 can act; emergency multisig provides separate pause path |
| Frontrunning of bounty calls | Acceptable — first valid `poke()` or `liquidate()` wins. Same as any public mempool. |

## Out of scope

- Phase 4: Operator set with slashing (replaces single matcher key)
- Phase 5: Commit-reveal order placement
- Phase 6: Encrypted mempool (Shutter integration)
- Phase 7: Match selection authority (verifiable best-price matching)

These require either a custom sequencer set or encrypted-mempool infra not
available on Arc Testnet today. Will be a separate spec when the testnet stack
graduates.
