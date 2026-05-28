# BUFX Protocol Defensive Audit Report

**Date:** 2026-05-27
**Vnet ID:** `807011c1-b65f-4075-aeea-b75854a159f2`
**Chain:** Avalanche Fuji (43113) fork at block `0x3540f20`
**Admin RPC:** `https://virtual.avalanche-testnet.eu.rpc.tenderly.co/838b335f-6dab-4475-9344-ac8112ce088b`
**Auditor:** Claude Code (Opus 4.7)

---

## Summary

| Case | Description | Result | Key Tx Hash |
|------|-------------|--------|-------------|
| S1 | Morpho supply/withdraw integrity | **PASS** | `0xabaa4879...` (supply), `0x125b0d6a...` (withdraw) |
| S2 | Bento room lifecycle | **PARTIAL** | `0x14e56a07...` (create), `0xfa1bfe0f...` (lock), `0xcecd5508...` (cancel), `0xa8fb9305...` (refund) |
| S3 | CCTP gateway deposit | **PASS** | N/A (revert-only tests) |
| S4 | Access control | **PASS** | `0x265f9830...` (authorized setLimits) |
| S5 | Edge cases | **PASS** | N/A (revert-only tests) |

**Overall: 4 PASS, 1 PARTIAL (S2 blocked by PoolManager snapshot dependency)**

---

## Staging Artefacts

| # | Description | Method | Params |
|---|-------------|--------|--------|
| 1 | Fund Player 2 (AVAX) | `tenderly_setBalance` | `0xa00b6D3a...`, `0x8AC7230489E80000` (10 AVAX) |
| 2 | Fund Player 2 (USDC) | `tenderly_setErc20Balance` | USDC, `0xa00b6D3a...`, `0x5F5E100` (100 USDC) |
| 3 | Fund unauthorized tester (AVAX) | `tenderly_setBalance` | `0x19E7E376...`, `0x8AC7230489E80000` |
| 4 | Warp time +700s | `evm_increaseTime` | `0x2BC` (700 seconds) |

---

## Case S1: Morpho Supply/Withdraw Integrity

**Market tested:** M2 (USDC/EURC) `0x1700104c...`
- loanToken: USDC `0x5425890298aed601595a70AB815c96711a31Bc65`
- collateralToken: MockEURC `0x50C4BA39CAA7f56152d0df4914e1F6b907194992`
- oracle: `0xf0cDaA9CF9e8d52060dcb41a045e3a6d618A9f65`
- irm: IrmMock `0x0B5D18BBE92F07eC0111Ae6d2E102858268D6aCA`
- lltv: 860000000000000000 (86%)

### Pre-State

| Metric | Value |
|--------|-------|
| Deployer USDC | 10,000,000 USDC (1e13) |
| M2 totalSupplyAssets | 500,000 (0.50 USDC) |
| M2 totalSupplyShares | 500,000,000,000 (5e11) |
| Deployer supplyShares | 0 |

### Supply 1,000,000 USDC

- **Approve tx:** `0x981d0d7a089f0720691e13928b73f1ae9e36f1566d66d43805627aff7bf6ad5a`
- **Supply tx:** `0xabaa4879fc87a0f66187889b42b8bd6fc9f4b1ae5e1cf89434013d62241bd2cc`
- Gas: 106,458

| Metric | Post-Supply |
|--------|-------------|
| Deployer USDC | 9,000,000 USDC (9e12) |
| Deployer supplyShares | 1,000,000,000,000,000,000 (1e18) |
| M2 totalSupplyAssets | 1,000,000,500,000 (1,000,000.50 USDC) |
| M2 totalSupplyShares | 1,000,000,500,000,000,000 (1.0000005e18) |
| Morpho USDC balance | 1,000,000,500,000 |

### Withdraw All Shares

- **Withdraw tx:** `0x125b0d6ad13e39893981d2d12cf8b64f54da7e459b465890650dab770023c2ea`
- Gas: 84,303

| Metric | Post-Withdraw |
|--------|---------------|
| Deployer USDC | 10,000,000 USDC (1e13) -- **exact match** |
| Deployer supplyShares | 0 |
| M2 totalSupplyAssets | 500,000 (back to pre-state) |
| M2 totalSupplyShares | 500,000,000,000 (back to pre-state) |
| Funds left behind | **0** |

**Verdict: PASS** -- Full round-trip supply/withdraw preserves USDC balance exactly. No rounding loss, no dust left behind.

---

## Case S2: Bento Room Lifecycle

### Room Creation

- **Tx:** `0x14e56a077dcacc99b9bf410cbe5c855c199e7d2bff706badf38b853787f0a92e`
- Room ID: 1
- Pool ID: `0x3df562a4...` (MockEURC/USDC, fee=3000, tickSpacing=60, hook=FXBentoHook)
- Entry fee: 5 USDC (5,000,000)
- Rake: 500 bps (5%)
- Payout: [10000] (100% to winner)
- Status: 0 (Open)

**Pool registration tx:** `0xbea13d2272fa7443c63c2c4af7b26063959f51536ac0e869d72bc0e49b2f7246`

### Join Flow

| Player | Address | Join Tx | USDC Transferred |
|--------|---------|---------|-----------------|
| P1 (deployer) | `0x0646FFe1...` | `0x36bd567d...` | 5,000,000 |
| P2 (demo maker) | `0xa00b6D3a...` | `0xed9f37db...` | 5,000,000 |

Post-join escrow: 10,000,000 (10 USDC)

### Lock Room

- **Tx:** `0xfa1bfe0fafb7cd4532d64936da253029a726638d1a7af4a5de93dd3fcab40221`
- Status transitioned: 0 -> 1 (Open -> Locked)
- Emitted: `RoomStatusUpdated(roomId=1, status=1)` + `RoomLocked(roomId=1, escrowed=10000000)`

### Round + Settlement (BLOCKED)

Round lifecycle (`startRound`, `recordAnchor`, `commitSelection`, `recordSettlement`) requires the Uniswap V4 PoolManager to have an active snapshot. On the forked vnet, no V4 pool has been initialized with liquidity, so:

- `startRound` -> `Error("NO_SNAPSHOT")`
- `recordAnchor` -> `Error("ROUND_NOT_ACTIVE")`
- `commitSelection` -> `Error("ROUND_NOT_ACTIVE")`
- `submitResults` -> `Error("ROUNDS_NOT_ENDED")`

**This is expected behavior** -- the contracts correctly enforce that rounds cannot start without a valid price snapshot from the V4 pool. Testing the full settlement flow requires initializing a V4 pool with liquidity first.

### Cancel + Refund Flow (Room 2)

Created room 2 for cancel testing. Verified:

1. **Cancel before start time:** `Error("START_PENDING")` -- correctly prevents premature cancellation
2. **Refund before cancel:** `Error("ROOM_NOT_CANCELLED")` -- correctly prevents premature refund
3. **After time warp (+700s):**
   - Cancel tx: `0xcecd5508232bc51f2aec629558e25aabef5c42931141017cdc2133b4e5fe96e3` (status -> 4 = Cancelled)
   - Refund tx: `0xa8fb93052421834c8691a50067514bb91f13fc1561c126049b6ec624c0342f87` (5 USDC returned)
   - USDC balance restored from 9,999,990,000,000 to 9,999,995,000,000

**Verdict: PARTIAL PASS** -- Room creation, join, lock, cancel, and refund all verified. Full round lifecycle blocked by V4 pool snapshot dependency (not a bug -- requires pool initialization).

---

## Case S3: CCTP Gateway Deposit Flow

### FxHubMessageReceiver Configuration

| Parameter | Value |
|-----------|-------|
| MARKET_REGISTRY | `0x7ba745b979e027992ECFa51207666e3F5B46cF0a` |
| MESSAGE_TRANSMITTER | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| USDC | `0x5425890298aed601595a70AB815c96711a31Bc65` |
| STRANDED_DEPOSIT_GRACE | 86,400 seconds (24 hours) |

### Validation Tests

| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Short message (20 bytes) | `0x0000...` (20B) | `MessageTooShort(20, 148)` | `MessageTooShort(20, 148)` | PASS |
| Medium message (180 bytes) | `0x00...` (180B) | `MessageTooShort(180, 216)` | `MessageTooShort(180, 216)` | PASS |
| Long message, wrong mint recipient | `0x00...` (256B) | `MintRecipientMismatch` | `MintRecipientMismatch(hub, 0x0)` | PASS |
| Sweep unknown nonce | nonce=0x01 | `NotStranded` | `NotStranded(0x01)` | PASS |
| depositState for unknown nonce | nonce=0x01 | 0 (None) | 0 | PASS |
| strandedDeposit for unknown nonce | nonce=0x01 | zero struct | `(0x0, 0, 0, 0)` | PASS |

### Validation Hierarchy

The hub correctly enforces this validation order:
1. Message length >= 216 bytes (CCTP V2 minimum)
2. Mint recipient == hub address (prevents misdirected funds)
3. CCTP MessageTransmitter attestation verification
4. Amount consistency + beneficiary matching

**Verdict: PASS** -- All error paths revert correctly. The validation hierarchy prevents: short messages, misdirected mints, unauthenticated CCTP messages, and sweep of non-stranded deposits.

---

## Case S4: Access Control Verification

### Ownership Map

| Contract | Owner | Expected |
|----------|-------|----------|
| MorphoBlue | `0x0646FFe1...` (deployer) | Correct |
| FxBentoRoomFactory | `0x0646FFe1...` (deployer) | Correct |
| FxBentoRoomEscrow | `0x0646FFe1...` (deployer) | Correct |
| FxBentoRoundManager | `0x0646FFe1...` (deployer) | Correct |
| FxBentoSettlementManager | `0x0646FFe1...` (deployer) | Correct |
| BuFxVenueRequestRouter | `0x0646FFe1...` (deployer) | Correct |
| BuFxTelaranaRequestRouter | `0x0646FFe1...` (deployer) | Correct |

### Unauthorized Call Tests

All tests use unauthorized address `0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A`:

| Test | Function | Contract | Error | Status |
|------|----------|----------|-------|--------|
| S4.1 | `setEntryToken` | Factory | `NotOwner` | PASS |
| S4.2 | `setLimits` | Factory | `NotOwner` | PASS |
| S4.3 | `setEscrow` | Factory | `NotOwner` | PASS |
| S4.4 | `setSettlementManager` | Escrow | `NotOwner` | PASS |
| S4.5 | `setChallengeWindow` | SettlementMgr | `NotOwner` | PASS |
| S4.6 | `setRoundManager` | SettlementMgr | `NotOwner` | PASS |
| S4.12 | `enableIrm` | Morpho | `not owner` | PASS |
| S4.13 | `setFeeRecipient` | Morpho | `not owner` | PASS |
| S4.14 | `enableLltv` | Morpho | `not owner` | PASS |

### Authorized Call Test

| Test | Function | Contract | Tx | Status |
|------|----------|----------|-----|--------|
| S4.9 | `setLimits(1000, 100)` | Factory | `0x265f9830...` | PASS (success) |

### Cross-Contract Access Control

| Test | Expected Restriction | Error | Status |
|------|---------------------|-------|--------|
| `transitionRoomStatus` from non-escrow | Only escrow can call | `NOT_ESCROW` | PASS |
| `settleRoom` from non-settlement-mgr | Only settlement manager | `NOT_SETTLEMENT_MANAGER` | PASS |

**Verdict: PASS** -- All admin functions are properly gated. Custom error `NotOwner` is used consistently across Bento contracts; Morpho uses string error `"not owner"`. Cross-contract authorization (escrow <-> factory, settlement <-> escrow) is enforced.

---

## Case S5: Edge Cases

| Test | Description | Expected | Actual | Status |
|------|-------------|----------|--------|--------|
| S5.1 | Supply 0 assets, 0 shares | Revert | `inconsistent input` | PASS |
| S5.2 | Withdraw 0 assets, 0 shares | Revert | `inconsistent input` | PASS |
| S5.3 | Borrow without collateral | Revert (oracle) | `CalldataMustHaveValidPayload` | PASS |
| S5.4 | Double join locked room | Revert | `ROOM_NOT_LOBBY` | PASS |
| S5.5 | Double refund from cancelled room | Revert | `NO_REFUND` | PASS |
| S5.6 | Leave a locked room | Revert | `ROOM_STARTED` | PASS |
| S5.7 | Withdraw more shares than held | Revert | `Panic(17)` (underflow) | PASS |
| S5.8 | Supply to non-existent market | Revert | `market not created` | PASS |

### S5.7 Note: Arithmetic Underflow

Withdrawing more shares than held triggers `Panic(17)` (arithmetic underflow). While this correctly prevents the operation, it is a Solidity-level panic rather than a named revert. Morpho Blue relies on Solidity 0.8.x checked arithmetic as its guard here rather than an explicit require. This is standard Morpho behavior and not a vulnerability, but it produces a less informative error message for integrators.

**Verdict: PASS** -- All edge cases revert correctly. No zero-amount exploits, no double-spend paths, no state corruption from invalid inputs.

---

## Risks Surfaced

| # | Class | Severity | Surface | Description |
|---|-------|----------|---------|-------------|
| R1 | Centralization | **Medium** | All contracts | All 7 audited contracts share a single owner EOA (`0x0646FFe1...`). Compromise of this key grants full admin control over Morpho markets (IRM/LLTV changes, fee recipient), Bento room parameters (entry tokens, rake limits, escrow address), and gateway configuration. The deployment config notes a rotation plan to TimelockController / multisig but this has not been executed yet. |
| R2 | Oracle dependency | **Low** | MorphoBlue borrow path | Borrow operations revert with `CalldataMustHaveValidPayload` when the oracle (Pyth/Redstone push-style) has no fresh calldata appended. This means borrows are gated by oracle freshness, which is correct but means a stale oracle effectively freezes the borrow market. Supplies and withdrawals are not affected. |
| R3 | Arithmetic guard | **Info** | MorphoBlue `withdraw` | Over-withdrawal triggers Solidity `Panic(17)` (underflow) instead of a named revert. Not exploitable but produces opaque errors for integrators. Standard Morpho behavior. |
| R4 | V4 pool dependency | **Medium** | Bento `startRound` | The round lifecycle requires a V4 PoolManager snapshot. If the V4 pool is not initialized with liquidity, or if the pool is drained, rounds cannot start and the room becomes stuck in Locked state. The `cancelRoom` + `refund` path provides an escape hatch after the start time passes, but the rescue mechanism (`rescueFailedSettlement`) requires the `settlementRescueDelay` (86,400s) to expire. |
| R5 | Missing fee recipient | **Low** | MorphoBlue | `feeRecipient()` returns `address(0)`. If market fees are ever enabled (currently 0), they would accrue but be unclaimable until a fee recipient is set. Not currently exploitable since all market fees are 0. |
| R6 | Stranded deposit grace | **Info** | FxHubMessageReceiver | Grace period is 86,400s (24h). A stranded deposit cannot be swept for 24 hours, locking user funds. This is by design (gives time for retry) but worth documenting for user-facing communications. |

---

## Adversarial Findings (Codex Pass)

**Pass date:** 2026-05-27
**Adversarial-base snapshot:** `0x7116dd337940a93e821624d4da78f0a0bebbc9ef2ae4a1592b9cff8b6955ed33`
**Note:** Tenderly vnet write quota was exhausted mid-pass. Findings marked "(static)" relied on `eth_call` simulations rather than committed transactions. All committed findings have tx hashes.

### Challenged PASS Rows

| Defensive Case | Defensive Result | Adversarial Verdict | Evidence |
|---|---|---|---|
| S1 (Morpho supply/withdraw) | PASS | **UPHELD** | First-depositor inflation attack (ERC-4626 style) attempted: attacker supplied 1 wei (`0x9da6efad...`), then donated 100 USDC directly to Morpho (`0xe3f788b3...`). Morpho Blue tracks `totalSupplyAssets` internally, not via `balanceOf(token)`. Donated USDC is unreachable surplus -- share ratio unchanged. Victim's 50 USDC deposit (`0x42c23158...`) received correct shares (50000000000000). **Inflation attack mitigated by design.** |
| S2 (Bento room lifecycle) | PARTIAL | **BROKEN -- see F1** | Owner set `settlementRescueDelay` to 0 (`0x012299c0...`) then called `rescueFailedSettlement` on Locked room 1 (`0x31ac1768...`). Room transitioned from Locked (1) to Cancelled (4). Static call confirms refund would succeed. Full PoC chain: `setSettlementRescueDelay(0)` -> `rescueFailedSettlement(roomId)` -> room cancelled -> players refund. |
| S3 (CCTP gateway deposit) | PASS | **UPHELD (with correction)** | Three-tier length validation confirmed: (1) `>= 216 bytes` first check, (2) `mintRecipient == hub` at offset, (3) `>= 376 bytes` second check for hookData. Crafted 400-byte message with correct mintRecipient reverted with `HookDataMismatch` (`0xbab6cd03`). hookData malleability is blocked. Defensive report stated min check as 148 -- actual first tier is 216. |
| S4 (Access control) | PASS | **UPHELD (with nuance)** | Critical setters (`setSettlementManager`, `setEscrow`) are **one-shot** -- revert with `SETTLEMENT_MANAGER_SET` / `ESCROW_SET` after first call. This mitigates the worst R1 scenarios. However, `setChallengeWindow`, `setRoundManager`, `setSettlementRescueDelay`, `setLimits`, and `setEntryToken` are all **repeatable** by owner. See F1 and F2. |
| S5 (Edge cases) | PASS | **UPHELD** | Zero-fee room creation reverted (`0xec03e43e...`, status 0x0). Non-player refund on cancelled room reverted (`0xa7ef4f1e...`, status 0x0). Settle on cancelled room reverted (`0x011a7c88...`, status 0x0). Cancel of locked room by non-owner reverted (`0x0b111d92...`, status 0x0). All edge-case guards held. **Exception:** 1-wei entry fee room creation SUCCEEDED (`0xbc2471aa...`) -- see F3. |

### New Findings

| # | Class | Severity | Surface | One-liner | Preconditions | PoC Trace | Recommended Fix |
|---|---|---|---|---|---|---|---|
| F1 | Governance griefing | **High** | FxBentoSettlementManager: `setSettlementRescueDelay` + `rescueFailedSettlement` | Owner can set rescue delay to 0 and immediately force-cancel any Locked room, griefing all active games | Compromised or malicious owner EOA | `0x012299c0...` (setDelay=0), `0x31ac1768...` (rescue room 1: Locked->Cancelled) | Add minimum floor to `setSettlementRescueDelay` (e.g., >= 3600s). Alternatively, enforce a timelock on this setter via TimelockController. |
| F2 | Governance griefing | **Medium** | FxBentoSettlementManager: `setChallengeWindow` | Owner can set challenge window to 0, allowing instant finalization of results with no dispute period | Compromised or malicious owner EOA | Static call `setChallengeWindow(0)` returns 0x (success) | Add minimum floor (e.g., >= 300s). Pair with timelock. |
| F3 | Spam / DoS | **Low** | FxBentoRoomFactory: `createRoom` | Rooms can be created with 1 wei entry fee (effectively free). Attacker can spam room creation, polluting UI/indexer | Anyone (permissionless) | `0xbc2471aa...` (room 3 created with entryFee=1) | Add minimum entry fee check (e.g., >= 1 USDC = 1000000). |
| F4 | Fee misconfiguration | **Low** | MorphoBlue: `setFee` + `feeRecipient` | Owner can enable non-zero market fees while `feeRecipient` is `address(0)`. Fees accrue but are permanently unclaimable (burned). | Owner calls `setFee` before `setFeeRecipient` | Static call `setFee(marketParams, 1e17)` returns 0x (success) while `feeRecipient()` is `address(0)` | Gate `setFee` to require `feeRecipient != address(0)`, or set fee recipient before any fee activation. |
| F5 | Centralization | **Medium** | FxBentoSettlementManager: `setRoundManager` | Owner can change the round manager to an arbitrary address at any time (repeatable setter). A malicious round manager could manipulate round outcomes. | Compromised owner EOA | Static call `setRoundManager(attacker)` returns 0x (success) | Make `setRoundManager` one-shot (like `setSettlementManager`) or add timelock. |

### Severity Reassessments

| Defensive # | Defensive Severity | Adversarial Verdict | Justification |
|---|---|---|---|
| R1 | Medium | **Medium-High** | The one-shot protection on `setSettlementManager` and `setEscrow` prevents the worst-case fund theft. However, `setSettlementRescueDelay(0)` + `rescueFailedSettlement` (F1) demonstrates a concrete griefing path that can cancel ALL active rooms instantly. The repeatable setters (`setChallengeWindow`, `setRoundManager`, `setSettlementRescueDelay`) expand the attack surface beyond what "Medium" implies. Upgrade contingent on timelock deployment. |
| R2 | Low | **Low (confirmed)** | Stale oracle freezes borrows but does not create exploitable conditions. Liquidations also freeze (no undercollateralized positions can be seized during oracle outage), which is actually a safety property. Combined with R5 (zero fee recipient): no amplification -- stale oracle + zero fee recipient is additive, not multiplicative. |
| R3 | Info | **Info (confirmed)** | Panic(17) underflow on over-withdrawal is standard Morpho behavior. Not exploitable. |
| R4 | Medium | **Medium (confirmed with F1 amplification)** | V4 pool dependency can lock rooms in Locked state. The escape hatch (rescue) was intended to require 86400s delay, but F1 shows the owner can bypass this. Without F1 fix, R4 + R1 = owner can lock rooms (by draining V4 pool) then immediately rescue-cancel them. |
| R5 | Low | **Low (confirmed, see F4)** | Fee recipient at address(0) is currently harmless since fees are 0. F4 documents that fees CAN be enabled before a recipient is set, which would permanently burn accrued fees. No fund theft risk. |
| R6 | Info | **Info (confirmed)** | 24h stranded deposit grace period is by-design. Cannot be shortened by attacker (no setter for `STRANDED_DEPOSIT_GRACE` -- it's immutable/constructor-set). |

### Attack Vectors Tested but Not Exploitable

| Vector | Agenda # | Result | Trace |
|---|---|---|---|
| First-depositor inflation (Morpho) | 5 | **Not exploitable** -- Morpho Blue uses internal accounting, not `balanceOf`. Direct USDC donation trapped as unreachable surplus. | `0x9da6efad...`, `0xe3f788b3...`, `0x42c23158...` |
| CCTP hookData malleability | 6 | **Not exploitable** -- Three-tier validation: length >= 216, mintRecipient == hub, length >= 376 + hookData consistency check (`HookDataMismatch`). | Static calls with 148/216/256/375/400 byte messages |
| Morpho reentrancy via callbacks | 7 | **Not exploitable** -- Supply/liquidate callbacks are pull-style (caller must transfer tokens during callback). Loan token is USDC (standard ERC-20, no reentrancy hooks). FlashLoan rejects 0-amount. | Flash loan 0-amount revert: `"zero assets"` |
| Cancel Locked room as non-owner | 4 | **Not exploitable** -- Reverts. | `0x0b111d92...` (status 0x0) |
| Refund from Locked room | 4 | **Not exploitable** -- Reverts. | `0x4c188788...` (status 0x0) |
| Non-player refund from Cancelled room | 4 | **Not exploitable** -- Reverts. | `0xa7ef4f1e...` (status 0x0) |
| Direct `transitionRoomStatus` bypass | 4 | **Not exploitable** -- `NOT_ESCROW` revert. | `0xa57641b1...` (status 0x0) |
| Settlement manager swap to drain escrow | 3 (R1) | **Not exploitable** -- `setSettlementManager` is one-shot, reverts with `SETTLEMENT_MANAGER_SET`. | Static call revert |
| Escrow redirect to drain funds | 3 (R1) | **Not exploitable** -- `setEscrow` is one-shot, reverts with `ESCROW_SET`. | Static call revert |
| Escrow emergency drain functions | 2 | **Not exploitable** -- No `emergencyWithdraw`, `sweep`, or `rescue` functions exist on escrow contract. | Static call reverts (function not found) |

### Staging Artefact Weaponization Assessment

| Artefact | Production Equivalent | Weaponizable? | Notes |
|---|---|---|---|
| `tenderly_setBalance` | Governance mint / airdrop | **No** | Self-funding doesn't bypass Morpho internal accounting or escrow access control |
| `tenderly_setErc20Balance` | Token admin mint | **No** | Same as above -- Morpho tracks assets internally, escrow tracks per-room |
| `evm_increaseTime` | Natural time passage | **Partially** | Enables rescue after delay. Combined with F1 (delay=0), this is moot -- attacker doesn't even need time manipulation |
| `evm_snapshot/revert` | N/A (no production equivalent) | **No** | State branching is a test-only capability |

---

## Sign-off

| Pass | Status |
|------|--------|
| Defensive | Complete |
| Adversarial | Complete |
