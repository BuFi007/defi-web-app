# BUFX Admin Migration Spec

**Status:** draft, do not execute without explicit approval  
**Date:** 2026-05-28  
**Risk addressed:** R1 from `reports/AUDIT_REPORT.md`

## Problem

The current testnet deployments are administered by a single deployer EOA:

`0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69`

That key controls owner or default admin powers across the protocol surface:
Morpho markets, fx-telarana gateway/perps/spot contracts, TurboFeeVault,
FxHedgeHook, fx-bento room contracts, request routers, and operational role
granting. A compromise would allow parameter changes, role grants, fee
recipient changes, pausing/unpausing, or component replacement.

## Target Control Model

Move admin power to a Safe multisig behind a TimelockController. Keep fast
emergency pause power separate from economic/admin power.

| Role | Holder | Delay | Powers |
| --- | --- | ---: | --- |
| Protocol admin | TimelockController | 24h testnet, 48-72h mainnet | ownership, default admin, fee recipient, market config, registry config |
| Proposer | BUFX Safe | n/a | schedules timelock operations |
| Executor | BUFX Safe, optionally open executor after mainnet review | after delay | executes scheduled operations |
| Canceller | BUFX Safe + Security Council Safe | n/a | cancels malicious or mistaken scheduled operations |
| Pause guardian | Security Council Safe or dedicated guardian Safe | no delay | pause-only, no unpause, no fee/owner/role authority |
| Keepers | role-scoped EOAs or service wallets | n/a | execution-only roles such as liquidator, spot executor, gateway relayer |

Recommended initial testnet parameters:

| Parameter | Value |
| --- | --- |
| `minDelay` | 24 hours |
| proposer | BUFX Safe |
| executor | BUFX Safe |
| canceller | BUFX Safe + Security Council Safe |
| admin after bootstrap | TimelockController itself |

Recommended mainnet parameters:

| Parameter | Value |
| --- | --- |
| `minDelay` | 48-72 hours |
| proposer | BUFX Safe, 3-of-5 or stronger |
| executor | open executor or BUFX Safe |
| canceller | BUFX Safe + independent Security Council Safe |
| pause guardian | separate 2-of-3 or 3-of-5 Safe |

## Migration Inventory

Before scheduling changes, export a signed inventory of every admin-controlled
contract on Arc and Fuji.

| Surface | Contracts | Admin fields to inspect |
| --- | --- | --- |
| Perps | FxOrderSettlement, FxPerpClearinghouse, FxMarginAccount, FxFundingEngine, FxHealthChecker, FxLiquidationEngine, LiquidationRouter | owner/default admin, executor roles, keeper roles, fee vault, market configs |
| Spot | FxSpotExecutor | default admin, operations role, executor role, fee vault, token allowlist |
| Gateway/lending | TelaranaGatewayHubHook, FxHubMessageReceiver, FxMarketRegistry, MorphoBlue | owner/default admin, relayer roles, route configs, IRM/LLTV enablement, fee recipient |
| Hooks/vault | FxHedgeHook, TurboFeeVault | owner/default admin, vault split recipients, hedge config, keeper roles |
| Bento | FXBentoHook, PoolRegistry, ProtocolFeeVault, FXBentoRoomFactory, FXBentoRoomEscrow, FXBentoRoundManager, FXBentoSettlementManager | owner/authority, room limits, escrow/settlement links, challenge windows, pool allowlist |
| Routers | BuFxVenueRequestRouter, BuFxTelaranaRequestRouter | owner, venue config, route config |

The inventory must include:

- chain id and RPC used
- contract address
- current `owner()` if available
- current default admin holder if AccessControl
- current operational roles and members
- queued/scheduled timelock operation ids once migration starts
- transaction hashes for each grant, transfer, revoke, and ownership move

## Phase Plan

### Phase 0 - Dry-run on Tenderly

1. Fork Arc and Fuji at current deployment blocks.
2. Deploy TimelockController and Safe-compatible owner addresses on the fork.
3. Execute the full migration on the fork.
4. Run the existing smoke tests:
   - perps quote and settlement path
   - spot executor reserve and fee routing path
   - Morpho supply/withdraw path
   - Bento room create/join/lock/start-round path
   - gateway receive/stranded-deposit validation path
5. Export the final owner/role inventory and compare against expected state.

Exit criteria: no deployer EOA retains owner/default-admin power, and all
keeper roles remain limited to their operational functions.

### Phase 1 - Deploy Admin Infrastructure

Deploy one TimelockController per chain unless the chain-specific owner graph
requires separate controls.

Required constructor shape:

```solidity
TimelockController(
  minDelay,
  proposers,
  executors,
  admin
)
```

Bootstrap rules:

- `admin` may be the deployer only for the bootstrap transaction batch.
- Immediately grant admin role to the timelock itself.
- Revoke bootstrap admin from the deployer after proposer/executor/canceller
  roles are installed and verified.

### Phase 2 - Grant Timelock Authority

For AccessControl contracts:

1. Grant `DEFAULT_ADMIN_ROLE` to TimelockController.
2. Grant required admin-scoped roles to TimelockController only if the contract
   does not derive them from default admin.
3. Verify TimelockController can grant and revoke a harmless test role on fork.
4. Revoke deployer default-admin power.

For Ownable contracts:

1. Schedule `transferOwnership(timelock)`.
2. Execute after delay.
3. Verify `owner() == timelock`.

For AccessManager/Authority-based contracts:

1. Set the authority/admin manager to the TimelockController or an
   AccessManager owned by the TimelockController.
2. Verify role-to-function permissions on fork.
3. Revoke deployer manager permissions.

### Phase 3 - Separate Emergency Pause

Pause guardians must not be able to:

- change owners
- change fee recipients
- enable new markets
- grant keeper/admin roles
- withdraw protocol funds
- alter settlement or escrow wiring

Where contracts currently only expose owner-only pause, either:

1. leave pause behind timelock for testnet, or
2. add a future contract change introducing `PAUSE_GUARDIAN_ROLE` with
   pause-only authority.

No fast unpause authority should be granted. Unpause remains timelocked.

### Phase 4 - Keeper Role Hygiene

Keeper wallets stay operational, not administrative.

| Keeper class | Allowed roles | Explicitly forbidden |
| --- | --- | --- |
| Perps liquidator | liquidation execution role | default admin, owner, fee recipient |
| Telarana liquidator | liquidation execution role | registry admin, owner |
| Spot executor | `EXECUTOR_ROLE` only | `OPERATIONS_ROLE`, default admin |
| Gateway signer/relayer | relay caller role only | route admin, owner |
| Arcade settler | settlement submitter role only if present | factory/escrow owner |

Production keeper flags remain off until explicitly approved:

- `TELARANA_LIQUIDATOR_ENABLED`
- `SPOT_EXECUTOR_ENABLED`
- `GATEWAY_SIGNER_ENABLED`
- `ARCADE_SETTLER_ENABLED`

### Phase 5 - Cutover Verification

After migration, verify on each chain:

```bash
cast call <contract> "owner()(address)"
cast call <contract> "hasRole(bytes32,address)(bool)" <DEFAULT_ADMIN_ROLE> <timelock>
cast call <contract> "hasRole(bytes32,address)(bool)" <DEFAULT_ADMIN_ROLE> <deployer>
```

Expected:

- owner/default admin is TimelockController
- deployer EOA has no admin role
- operational keeper roles are unchanged unless explicitly migrated
- fee recipients are non-zero where fees can accrue
- all scheduled operation ids are archived with transaction hashes

## Rollback Plan

Before revoking deployer admin:

1. Keep a queued rollback operation that restores deployer admin on the fork
   only for validation.
2. Do not queue a live rollback that grants EOA ownership unless governance
   explicitly approves it.
3. Use the canceller role to cancel erroneous scheduled operations before
   execution.

After deployer revocation:

- rollback must go through the timelock path.
- emergency action is limited to pause-only if a pause guardian exists.
- all ownership recovery must be a scheduled multisig operation.

## Acceptance Criteria

- TimelockController deployed and verified on every target chain.
- BUFX Safe controls proposer/executor roles.
- Security Council Safe can cancel scheduled operations.
- Deployer EOA no longer owns or default-admins audited contracts.
- Keeper EOAs retain only narrow execution roles.
- Tenderly fork proves:
  - perps trading and liquidation still execute
  - Morpho supply/withdraw still execute
  - gateway receive validation still works
  - Bento room lifecycle can start after the v4 pool snapshot dependency is met
- A final owner/role inventory is committed under `reports/`.

## Non-Goals

- No migration is executed by this spec.
- No production keeper flags are enabled.
- No private keys are introduced into repository files.
- No contract upgrade or redeploy is required unless a contract lacks the role
  separation needed for pause-only emergency control.
