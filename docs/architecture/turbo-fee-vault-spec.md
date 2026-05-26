# BUFX Unified Liquidity Layer — Yield Engine Spec

> Contracts live in **fx-telarana** or **BUFX** repo, NOT defi-web-app.
> The UI consumes yield data via the Envio indexer (services/envio-yield/).

## Core Thesis

Morpho lending markets and Uniswap v4 pools are **the same liquidity**.
One LP position. Three yield sources. One composite APY. The LP deposits
once and earns from lending interest, trading fees, and external hedge
volume — without managing three separate positions.

This is what makes BUFX infrastructure, not just an app.

## Architecture

```
                    UNISWAP V4 POOL
                    (EURC / USDC)
                   ┌──────────────┐
                   │ + Hedge Hook │ ← external pools hedge FX exposure here
                   │ + Fee Hook   │ ← routes trading fees to vault
                   │ + IRM Hook   │ ← connects to Morpho lending rate
                   └──────┬───────┘
                          │
                 LP deposits USDC
                          │
              ┌───────────┴───────────┐
              │   MORPHO BLUE MARKET  │
              │   (same EURC/USDC)    │
              │                       │
              │  Lending: IRM APY     │  ← borrower interest
              │  Trading: fee share   │  ← perps + spot fees
              │  Hedging: volume fees │  ← external pools hedging
              │                       │
              │  = ONE composite APY  │
              └───────────┬───────────┘
                          │
                    LP sees: 12.4% APY
                    (doesn't care where it comes from)
```

## Three Yield Sources

### Source 1: Morpho IRM (existing)

```
borrowAPR = f(utilization)
supplyAPR = borrowAPR × utilization × (1 - reserveFactor)
```

This is the base rate. Currently 0% because no borrows. Grows as
borrowing demand increases. Standard Morpho/Aave economics.

### Source 2: Trading Fee Share (TurboFeeVault)

Every perps trade and spot swap generates a fee (5-8 bps). The fee
splitter routes 40% to the LP yield pool.

```
fee_apy = (daily_fees_to_vault × 365) / total_lp_deposits
```

At $100K daily trading volume with 5bps fee:
  daily fees = $50, vault share (40%) = $20
  on $500K TVL: fee_apy = ($20 × 365) / $500K = 1.46%

At $1M daily volume: fee_apy = 14.6%

This is the growth engine — more volume = higher APY = more TVL.

### Source 3: External Hedge Volume (FX Hedge Hook)

Any Uniswap v4 pool with FX-denominated tokens can attach the BUFX
Hedge Hook. The hook opens perps positions on the BUFX CLOB to hedge
the pool's FX exposure. Every hedge = a perps trade = a fee.

This is the flywheel:
```
More external pools hedge → more CLOB volume → more fees
→ higher LP APY → more TVL → deeper liquidity → tighter spreads
→ more pools want to hedge through BUFX → repeat
```

The LP doesn't do anything extra to earn this. The hedge volume flows
through the same CLOB, generates the same fees, and the vault
distributes them to the same LPs.

## Fee Split

```
TRADER pays fee on every perps/spot trade
    ↓
FEE SPLITTER (on-chain, immutable logic)
    ├── 50% → Protocol Treasury (BUFX revenue, sustainability)
    ├── 40% → LP Yield Pool (distributed pro-rata to depositors)
    └── 10% → Insurance Fund (hedge failure protection buffer)
```

Why this split:
- **50% protocol**: sustainable business. Covers infra, team, development.
- **40% LPs**: competitive APY. This is the number users compare across protocols.
- **10% insurance**: small because FX has low volatility. Grows over time.
  Only pays out when the hedge hook's perps position fails (rebalance lag,
  funding spike, or liquidation — all rare for FX pairs).

## How the Uniswap v4 Listing Works

### The Pool IS the Market

The EURC/USDC Uniswap v4 pool is also the EURC/USDC Morpho lending market.
They share the same underlying liquidity. This is achieved via hooks:

1. **Swap Hook**: When someone swaps EURC→USDC through the Uniswap pool,
   the hook routes the execution through the BUFX spot executor. The LP
   earns the swap fee. BUFX earns the protocol share.

2. **Lending Hook**: The idle liquidity that isn't being used for swaps
   is deposited into the Morpho market to earn lending yield. This is
   similar to how Uniswap v4's "idle liquidity" hooks work.

3. **Hedge Hook**: External pools (on other chains) that have FX exposure
   open hedge positions through the BUFX CLOB. This generates trading
   volume and fees without requiring any action from the LP.

### What the LP Sees

```
BUFX App → Loan/Borrow tab → EURC/USDC pool
  APY: 12.4% (composite)
    ├── 3.2% lending (Morpho IRM — borrower interest)
    ├── 7.8% trading fees (perps + spot volume share)
    └── 1.4% hedge income (external pools hedging)

Uniswap Interface → EURC/USDC pool (same pool, different frontend)
  APY: 12.4% (same number)
  "Powered by BUFX Yield Hooks"
```

The LP can deposit from either interface. Same pool. Same yield. BUFX
gets distribution through Uniswap's massive user base.

## Risks That Can Break This

### 1. Oracle manipulation
If the Pyth oracle price is manipulated, the hedge hook opens positions
at wrong prices. The LP loses money on the hedge AND the Morpho
liquidation engine fires incorrectly.

**Mitigation**: Pyth has multi-publisher median. Add a TWAP sanity check
in the hook. Pause hedging if price deviates > 2% from TWAP.

### 2. Hedge-pool desync
The Morpho market and Uniswap pool must stay in sync. If one has
liquidity the other doesn't, arbitrageurs extract value.

**Mitigation**: The hook enforces that withdrawals from one drain from
both. Single LP token represents both positions.

### 3. Funding rate regime change
If funding rates on FX perps flip persistently negative (shorts pay
longs), the hedge cost eats into LP yield. LPs withdraw. Liquidity
drops. Death spiral.

**Mitigation**: Insurance fund absorbs funding cost during adverse
periods. The hook can also switch from perps to options-based hedging
if funding exceeds a threshold.

### 4. Smart contract risk
Three interacting contracts (Morpho + Uniswap + BUFX hooks) = large
attack surface. A bug in any one affects the entire yield stack.

**Mitigation**: Each layer is independently audited. The hooks are
stateless (they don't hold funds — Morpho and Uniswap do). The vault
is the only contract that holds fee revenue.

### 5. Regulatory risk
Combining lending + trading fees + hedging into one yield product
could be classified as a security (Howey test: investment of money
in a common enterprise with expectation of profits from the efforts
of others).

**Mitigation**: Fully on-chain, permissionless, non-custodial. No
admin keys on the fee split. Legal opinion needed before mainnet.

## Contract Interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITurboFeeVault {
    // --- Fee ingress (called by settlement contracts) ---
    function depositFee(address token, uint256 amount, bytes32 marketId) external;

    // --- LP staking (deposit = stake, same action) ---
    function deposit(uint256 assets) external returns (uint256 shares);
    function withdraw(uint256 shares) external returns (uint256 assets);
    function claimYield() external returns (uint256 claimed);

    // --- Views ---
    function pendingYield(address user) external view returns (uint256);
    function compositeApy() external view returns (uint256); // 18 decimals
    function totalDeposits() external view returns (uint256);

    // --- Events ---
    event FeeDeposited(bytes32 indexed marketId, address token, uint256 amount, uint256 vaultShare);
    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event Withdrawn(address indexed user, uint256 shares, uint256 assets);
    event YieldClaimed(address indexed user, uint256 amount);
    event InsurancePayout(bytes32 indexed marketId, uint256 amount, string reason);
}
```

## Envio Integration

The yield engine at services/envio-yield/ indexes:

| Event | Source | What it tracks |
|-------|--------|---------------|
| MatchSettled | FxOrderSettlement | Perps volume + fees per market |
| SpotFxExecuted | FxSpotExecutor | Spot volume |
| FundingPoked | FxPerpClearinghouse | Funding rate history |
| Supply/Withdraw/Borrow/Repay | MorphoBlue | Lending TVL + utilization |
| FeeDeposited | TurboFeeVault | Fee accrual per market per day |
| Deposited/Withdrawn | TurboFeeVault | Vault TVL |
| YieldClaimed | TurboFeeVault | Distribution tracking |

Derived metric exposed via GraphQL:
```graphql
query {
  dailyMarketSnapshot(where: { marketId: "0x565a..." }) {
    date
    perpFees
    spotVolume
    totalSupply
    annualizedFeeApy    # (daily_vault_inflow × 365) / total_deposits
  }
}
```

The web UI reads this to display the composite APY breakdown in the
lending table and the yield chart.

## Implementation Order

> All phases execute in the **fx-telarana** repo, not defi-web-app.
> The UI consumes results via Envio GraphQL.

### Phase 0: Deploy Uniswap v4 on Arc Testnet (PREREQUISITE)

Uniswap v4 is NOT deployed on Arc Testnet (chain 5042002) as of
2026-05-26. The canonical PoolManager address has no code on Arc.
However, the CREATE2 deployer IS present at
`0x4e59b44847b379578588920cA78FbF26c0B4956C` — so we can deploy
v4 ourselves at deterministic addresses.

**Verified on-chain (2026-05-26):**

| Chain | CREATE2 Deployer | PoolManager | Status |
|-------|-----------------|-------------|--------|
| Arc Testnet (5042002) | EXISTS | NOT DEPLOYED | We deploy |
| Avalanche Fuji (43113) | EXISTS | NOT DEPLOYED | We deploy |

Deploy on BOTH chains. Arc is the primary CLOB venue. Fuji has
Morpho lending pools + Telarana gateway contracts. Multi-chain
demo strengthens the hookathon pitch (hedge on Arc, lend on Fuji).

**Deployment steps (fx-telarana repo, next session):**

```bash
# 1. Clone v4-core and deploy PoolManager
git clone https://github.com/Uniswap/v4-core
cd v4-core && forge install

# Deploy on Arc Testnet
forge script script/DeployPoolManager.s.sol \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast

# Deploy on Avalanche Fuji
forge script script/DeployPoolManager.s.sol \
  --rpc-url https://api.avax-test.network/ext/bc/C/rpc \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast

# 2. Clone v4-periphery and deploy PositionManager (both chains)
git clone https://github.com/Uniswap/v4-periphery
cd v4-periphery && forge install

forge script script/DeployPositionManager.s.sol \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast

forge script script/DeployPositionManager.s.sol \
  --rpc-url https://api.avax-test.network/ext/bc/C/rpc \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast

# 3. Verify on block explorers
# Arc:  https://testnet.arcscan.io/address/0x000000000004444c5dc75cb358380d2e3de08a90
# Fuji: https://testnet.snowtrace.io/address/0x000000000004444c5dc75cb358380d2e3de08a90
```

**Why deploy ourselves:**
- Uniswap v4 contracts are open source and permissionless
- Anyone can deploy on any EVM chain
- CREATE2 gives deterministic addresses matching other chains
- No need to wait for Uniswap team — we unblock ourselves
- The hookathon demo needs v4 on Arc, not a promise of v4 on Arc

**Alternative if deploy scripts need adaptation:**
- Use `forge create` directly with the PoolManager bytecode
- Or use the scaffold-hook template which includes deployment helpers
- Arc is EVM-compatible, no custom opcodes to worry about

### Phase 1: TurboFeeVault (fx-telarana repo)
Deploy the vault contract on Arc Testnet. Wire FxOrderSettlement to
call depositFee() after each trade. UI shows "Fee Boost APY" column.

### Phase 2: FxHedgeHook + cirBTC/USDC Pool (HOOKATHON DEMO)

The hookathon demo uses the cirBTC/USDC pair — a LIVE perps market
on the BUFX CLOB with real Pyth BTC/USD oracle feeds.

```bash
# Deploy the hook using CREATE2 with HookMiner for correct address flags
forge script script/DeployFxHedgeHook.s.sol \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast

# Create the cirBTC/USDC pool with the hook attached
# Pool uses the PoolManager deployed in Phase 0
```

**FxHedgeHook.sol:**
- `beforeAddLiquidity`: calculate BTC exposure → open BTC/USD short perp on BUFX CLOB
- `afterSwap`: rebalance hedge if LP exposure changed significantly
- `beforeRemoveLiquidity`: close hedge proportionally

**Demo script (the hookathon presentation):**
1. Deposit LP into cirBTC/USDC WITHOUT hook → BTC drops 10% → show IL loss
2. Deposit LP into cirBTC/USDC WITH FxHedgeHook → BTC drops 10% → IL neutralized
3. Both earned swap fees. Only the hedged LP kept theirs.
4. Show the perps trade on the BUFX CLOB that executed the hedge
5. Show the fee flowing through TurboFeeVault to the LP yield pool

**What already exists on Arc Testnet:**
- cirBTC token (deployed)
- USDC (native gas token)
- CIRBTC/USDC perps market (live on CLOB, matcher settles it)
- BTC/USD Pyth oracle feed (`0xe62df6c...`)
- Hybrid CLOB sequencer (WS gateway + batch flusher)
- Morpho lending pools (USDC liquidity)

Everything on one chain. No cross-chain. No bridging. Real trades.

### Phase 3: Fee Hook + Uniswap Pool Listing
Deploy EURC/USDC and other FX pools on Uniswap v4 with the Fee Hook.
The Fee Hook routes swap fees through the TurboFeeVault. LPs can
deposit via Uniswap interface or BUFX app — same pool, same yield.

### Phase 4: Lending Integration Hook
Connect idle pool liquidity to Morpho lending. The hook auto-deposits
unused USDC into the Morpho market and withdraws when needed for swaps.
This is where the Morpho vault and Uniswap pool become one.

### Phase 5: Testnet Launch (Arc Testnet ONLY)
Full integration on Arc Testnet:
- All FX pairs + cirBTC pool with hooks
- TurboFeeVault distributing fees
- Envio indexing composite yield
- UI showing blended APY
- Delta-neutral hedging working end-to-end

Mainnet deployment is a separate decision requiring:
- Security audit of all hook contracts
- Legal review of fee redistribution mechanism
- Production Envio deployment
- Insurance fund adequacy testing

## Why This Wins

1. **For LPs**: One deposit, three yield sources, no active management.
   Higher APY than Morpho alone or Uniswap alone.

2. **For traders**: Deep liquidity from combined Morpho+Uniswap TVL.
   Tighter spreads. More markets.

3. **For BUFX**: 50% of all trading fees as protocol revenue. Volume
   flywheel from external hedgers. Distribution through Uniswap.

4. **For DeFi**: The first FX-native yield infrastructure. Every protocol
   that touches FX stablecoins can plug into BUFX for hedging and yield.
