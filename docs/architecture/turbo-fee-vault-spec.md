# TurboFeeVault Spec — Yield Engine for BUFX

> This contract lives in the **fx-telarana** or **BUFX** repo, NOT defi-web-app.
> The UI consumes it via the Envio yield engine (services/envio-yield/).

## Overview

The TurboFeeVault is an on-chain fee splitter + yield distribution contract that routes a configurable percentage of trading fees (perps + spot) to lenders who stake their Morpho supply shares. It creates a composite APY: `Morpho IRM base rate + trading fee boost`.

## Fee Flow

```
TRADER pays fee on every perps/spot trade
    ↓
FxOrderSettlement / FxSpotExecutor
    ↓ fee transferred to TurboFeeVault
    ↓
TURBO FEE VAULT (on-chain, immutable split)
    ├── 50% → Protocol Treasury (protocolRecipient)
    ├── 20% → Yield Pool (for stakers)
    ├── 20% → Insurance Fund (insuranceRecipient)
    └── 10% → LP Incentive Pool (lpRecipient)
```

## Contract Interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITurboFeeVault {
    // --- Admin ---
    function setSplitBps(
        uint16 protocolBps,
        uint16 yieldBps,
        uint16 insuranceBps,
        uint16 lpBps
    ) external; // onlyOwner, sum must = 10000

    // --- Fee ingress ---
    function depositFee(
        address token,
        uint256 amount,
        bytes32 marketId
    ) external; // called by settlement contracts

    // --- Staking ---
    function stake(uint256 morphoShares) external;
    function unstake(uint256 morphoShares) external;
    function claimYield() external;

    // --- Views ---
    function pendingYield(address user) external view returns (uint256);
    function totalStaked() external view returns (uint256);
    function currentApy() external view returns (uint256); // annualized, 18 decimals

    // --- Events ---
    event FeeDeposited(bytes32 indexed marketId, address token, uint256 amount, uint256 yieldShare);
    event Staked(address indexed user, uint256 shares);
    event Unstaked(address indexed user, uint256 shares);
    event YieldClaimed(address indexed user, uint256 amount);
    event SplitUpdated(uint16 protocolBps, uint16 yieldBps, uint16 insuranceBps, uint16 lpBps);
}
```

## Yield Distribution Mechanics

### Staking
- Lenders who supply to Morpho pools receive Morpho supply shares
- They can stake those shares in the TurboFeeVault
- Staked shares continue to earn Morpho IRM yield (shares aren't transferred, just registered)
- The vault tracks each staker's pro-rata share of the yield pool

### Distribution
- Fees accrue in the vault's yield pool in USDC
- Distribution is continuous (no epoch/claiming windows)
- `pendingYield(user) = yieldPool × (userStake / totalStaked) - alreadyClaimed`
- Users call `claimYield()` to withdraw their pending USDC

### APY Calculation
```
base_apy = morpho_irm_supply_rate (from on-chain IRM)
fee_apy  = (daily_yield_pool_inflow × 365) / total_staked_value
composite_apy = base_apy + fee_apy
```

## Envio Integration

The Envio yield engine (services/envio-yield/) indexes:
- `FeeDeposited` events → tracks fee accrual per market per day
- `Staked` / `Unstaked` events → tracks TVL in the vault
- `YieldClaimed` events → tracks distribution
- Derives `annualizedFeeApy` per market in `DailyMarketSnapshot`

The web UI reads from Envio's GraphQL API to display:
- Per-market composite APY in the lending table
- Historical yield charts
- User's pending yield + claim button

## Deployment Plan

1. **Contract**: Deploy TurboFeeVault on Arc Testnet (chain 5042002)
2. **Integration**: Update FxOrderSettlement to call `vault.depositFee()` after each trade
3. **UI**: Add "Boost APY" column in the lending table, "Stake" button in the action card
4. **Indexer**: Add TurboFeeVault contract to Envio config.yaml

## Security Considerations

- The vault holds USDC (not supply shares) — simpler attack surface
- Split percentages are admin-controlled but bounded (no single recipient > 60%)
- Staking is non-custodial (Morpho shares stay with the user, vault just tracks registration)
- No lock-up period (unstake anytime)
- Insurance fund share provides solvency buffer for LP losses

## Legal Notes

- Fee redistribution to stakers is similar to Aave Safety Module or Curve gauge
- The mechanism is fully on-chain, non-custodial, permissionless
- Protocol keeps 50% (sustainable business model)
- Legal review recommended before mainnet deployment
- Consider: is the staked position a security? Depends on jurisdiction.
  The "efforts of others" prong is arguable since trading volume is market-driven,
  not protocol-managed. But US securities law is aggressive on DeFi yield.

## Future: Uniswap v4 Yield Hooks

The LP Incentive Pool (10% of fees) can fund:
- IL insurance hook premiums for FX AMM LPs
- Fee-smoothing hook that converts volatile per-block fees into steady yield
- Delta-neutral hedging hook that auto-hedges LP exposure via the perps CLOB
- YieldBasis-style fixed-rate vaults using the fee pool as variable buffer

These hooks would live in the fx-telarana repo alongside the Morpho/Uniswap contracts.

## Future: FX Hedge Hook (Cross-Protocol Volume Flywheel)

The highest-leverage idea: a Uniswap v4 hook that lets ANY pool with FX-denominated tokens (EURC/WETH, JPYC/USDC, MXNB/anything) auto-hedge their FX exposure via BUFX perps.

### How It Works

1. LP deposits into a Uniswap v4 pool with a stablecoin that has FX risk (e.g. EURC/WETH)
2. The FX Hedge Hook detects the LP's EUR exposure from their position
3. The hook opens a corresponding EUR/USD short perp on the BUFX CLOB
4. The LP is now delta-neutral on EUR/USD — they only earn swap fees, no FX IL
5. The hedge position pays/receives funding rate on BUFX

### Economics

```
LP earns:  Uniswap swap fees - BUFX funding rate cost
LP avoids: EUR/USD impermanent loss (hedged by the perp)
BUFX earns: Trading fee on hedge open/close + funding rate spread
Vault gets: More perps volume → more fees → higher staker yield
```

### Why This Is Infrastructure

- Any pool on ANY chain with FX-denominated assets can use the hook
- BUFX becomes the "FX hedge layer for DeFi" — not just a trading app
- Volume flywheel: more hedging pools → more CLOB volume → tighter spreads → more pools want to hedge
- The hook can be permissionless — anyone deploys a pool with the BUFX FX Hedge Hook attached
- Cross-chain via CCTP: hedge on Arc, pool on Ethereum/Base/Arbitrum

### Implementation Notes

- The hook needs read access to the BUFX CLOB (via the WS gateway or API)
- Settlement happens off-chain (signed EIP-712 intents) — the hook signs on behalf of the LP
- Hedge rebalancing on every significant position change (swap that moves the LP's FX delta)
- The hook contract holds the perps margin (USDC) — funded by the LP or from a shared vault
- Gas cost: hook execution on the Uniswap chain + cross-chain message to Arc for the hedge

### Relationship to Uniswap Foundation Priorities

This directly addresses the Foundation's 2026 frontier themes:
- **IL insurance**: The hedge IS the insurance — perps position cancels FX IL
- **Delta-neutral hedging**: Core mechanism
- **Fee-smoothing**: The funding rate creates a predictable cost/income stream
- **Sustainable LP economics**: LPs earn swap fees without FX risk — the holy grail

This hook + the TurboFeeVault + Morpho lending = a complete yield stack that turns BUFX from a trading app into FX infrastructure for all of DeFi.
