# Cross-Chain Yield Distribution Spec

> TurboFeeVault lives on Arc. Fuji LPs cannot claim yield today.
> This spec designs the relay so every LP earns pro-rata, any chain.

## Problem

TurboFeeVault (0x929e...0531 on Arc) collects 40% of all trading
fees for LP distribution. But LPs who deposit via Fuji (or any spoke)
have no on-chain path to claim their share. Their Morpho position is
on Fuji; the yield is on Arc.

## Options Considered

### Option A -- Gateway Yield Relay (keeper-driven)

Fuji LPs register via TelaranaGatewayHubHook. A keeper calculates
pro-rata yield share off-chain, withdraws from TurboFeeVault on Arc,
bridges USDC via CCTP to Fuji, and distributes.

Pros: simplest, reuses existing keeper infra, ships in days.
Cons: centralized keeper is a trust assumption + liveness dependency.

### Option B -- Dual Vault

Deploy TurboFeeVault on both chains. Arc fees go to Arc vault, Fuji
fees go to Fuji vault. Cross-chain fee rebalancing via CCTP when one
vault accumulates disproportionate yield.

Pros: more decentralized, each chain is self-contained.
Cons: complex rebalancing logic, doubles audit surface, yield can
fragment if rebalancing lags.

### Option C -- LP Receipt Token

When a Fuji LP deposits, they receive a transferable receipt token
(ERC-20). They bridge the receipt to Arc and claim directly from the
Arc vault. Receipt is burned on claim.

Pros: trustless, no keeper dependency, LP controls timing.
Cons: requires receipt token contract + bridge integration, UX adds
an extra step (bridge then claim).

## Recommendation

**Testnet: Option A** -- fastest path, validates yield math, works
with the existing bufi-matcher Rust keeper.

**Mainnet: Option C** -- trustless, composable, no liveness risk.
Option A keeper can run as a convenience relay alongside Option C.

## Interface: IYieldRelay

```solidity
interface IYieldRelay {
    /// @notice Register a cross-chain LP position for yield accrual.
    /// @param sourceChain  CCTP domain ID of the LP's origin chain.
    /// @param lp           Address of the LP on the source chain.
    /// @param shares       LP share balance (mirrors TurboFeeVault shares).
    function registerPosition(uint32 sourceChain, address lp, uint256 shares) external;

    /// @notice Called by the keeper to relay yield to a remote chain.
    /// @param sourceChain  Destination CCTP domain.
    /// @param lp           Recipient on the destination chain.
    /// @return amount      USDC amount bridged.
    function relayYield(uint32 sourceChain, address lp) external returns (uint256 amount);

    /// @notice Pending yield for a cross-chain LP.
    function pendingRemoteYield(uint32 sourceChain, address lp) external view returns (uint256);

    event PositionRegistered(uint32 indexed sourceChain, address indexed lp, uint256 shares);
    event YieldRelayed(uint32 indexed sourceChain, address indexed lp, uint256 amount, bytes32 cctpNonce);
}
```

## Sequence Diagram (Option A -- Testnet)

```
Fuji LP          Fuji Gateway       Arc TurboFeeVault    Arc YieldRelay    CCTP
  |                  |                     |                   |              |
  |--deposit USDC--->|                     |                   |              |
  |                  |--CCTP bridge------->|                   |              |
  |                  |                     |--depositFee()---->|              |
  |                  |                     |  (trading fees    |              |
  |                  |                     |   accumulate)     |              |
  |                  |                     |                   |              |
  |                  |    [keeper cron every 6h]               |              |
  |                  |                     |<--claimYield()----|              |
  |                  |                     |   (on behalf of   |              |
  |                  |                     |    relay contract) |              |
  |                  |                     |                   |              |
  |                  |                     |---USDC----------->|--burnUSDC--->|
  |                  |                     |                   |              |
  |                  |                     |                   |  [attestation]
  |                  |                     |                   |              |
  |<--receive USDC---|<----CCTP mint----------------------------<--mintUSDC---|
  |                  |                     |                   |              |
```

## Sequence Diagram (Option C -- Mainnet)

```
Fuji LP          Receipt Token     Arc TurboFeeVault    Bridge (CCTP)
  |                  |                     |                   |
  |--deposit-------->|                     |                   |
  |<--mint receipt---|                     |                   |
  |                  |                     |                   |
  |  [LP decides to claim]                |                   |
  |--bridge receipt--|--CCTP burn--------->|                   |
  |                  |                     |                   |
  |                  |  [receipt arrives on Arc]               |
  |                  |--claim(receipt)---->|                   |
  |                  |                     |--burn receipt     |
  |                  |                     |--USDC to LP------>|
  |                  |                     |                   |
  |<--receive USDC---|<----CCTP mint----------------------------
```

## Risk Analysis

### CCTP bridge downtime during yield distribution

**Impact**: Keeper cannot relay yield. LPs on remote chains stop
receiving distributions until the bridge recovers.

**Mitigation (Option A)**:
- Yield accrues in the YieldRelay contract on Arc. Nothing is lost.
- Keeper retries on a configurable interval (default 6h).
- After 24h of consecutive failures, emit `RelayStalled` event so
  monitoring catches it.
- LPs can bridge to Arc manually and claim directly as a fallback.

**Mitigation (Option C)**:
- LP receipt tokens are valid indefinitely. No time pressure.
- If CCTP is down, the LP simply waits. Yield keeps accruing.
- Worst case: LP bridges the receipt via a different bridge (Hyperlane
  is already deployed between Arc and Fuji for Telarana messages).

### Keeper compromise (Option A only)

**Impact**: Malicious keeper could call `relayYield` with wrong
amounts or skip certain LPs.

**Mitigation**:
- YieldRelay contract enforces pro-rata math on-chain. Keeper only
  triggers the relay; it cannot change the amount.
- `pendingRemoteYield()` is a view anyone can verify.
- Multi-sig or timelock on the keeper role for mainnet.

### Receipt token bridge exploit (Option C only)

**Impact**: If the bridge mints a receipt on Arc without a
corresponding burn on Fuji, attacker claims unearned yield.

**Mitigation**:
- Use CCTP (Circle-attested) for receipt bridging, same trust model
  as USDC bridging.
- Receipt contract tracks total minted vs total burned; circuit
  breaker if delta exceeds threshold.

## Keeper Requirements

Add to the existing `bufi-matcher` Rust binary (see
`rust-keeper-consolidation-spec.md`):

```
NEW MODULE: yield_relay
  - Runs as a periodic task (cron: every 6 hours)
  - Reads TurboFeeVault.totalYieldDistributed on Arc
  - Reads registered remote positions from YieldRelay contract
  - For each position with pendingRemoteYield > dust threshold:
    1. Call YieldRelay.relayYield(sourceChain, lp)
    2. The contract calls TurboFeeVault.claimYield() internally
    3. The contract calls CCTP TokenMessenger.depositForBurn()
    4. Log the CCTP nonce for attestation tracking
  - Attestation polling: wait for Circle attestation, then call
    MessageTransmitter.receiveMessage() on the destination chain
  - Emit metrics: relay_count, relay_total_usdc, relay_failures
```

Config additions to `bufi-matcher.toml`:

```toml
[yield_relay]
enabled = true
interval_secs = 21600          # 6 hours
dust_threshold_usdc = 100000   # 0.1 USDC (6 decimals)
max_batch_size = 50            # max LPs per relay cycle
cctp_attestation_timeout_secs = 900
```

## Migration Path

1. **Now (testnet)**: Deploy YieldRelay on Arc Testnet. Add
   `yield_relay` module to bufi-matcher. Wire to TurboFeeVault.
2. **Pre-mainnet**: Deploy ReceiptToken (Option C) alongside the
   keeper relay. Both paths work simultaneously.
3. **Post-mainnet**: Deprecate Option A keeper once Option C receipt
   flow is battle-tested. Keep keeper as optional convenience relay.
