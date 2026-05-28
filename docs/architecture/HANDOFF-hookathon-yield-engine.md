# Session Handoff: Hookathon + Yield Engine + Envio Migration

> Copy this entire file as the opening prompt for the next session.
> Works in Claude Code, Cursor, or Codex. Start from the repo root.

## Context

You are resuming work on BUFX — an agentic forex stablecoin trading platform.
The previous session shipped: Hybrid CLOB (5 phases), ConnectKit wallet,
full i18n (6 locales), dynamic SEO, Envio HyperIndex scaffolding, and three
architecture specs. Everything is on `main`, deployed to Vercel + Railway.

## Repos

```
~/coding-dojo/defi-web-app/     — Next.js web app + Rust matcher + Envio indexer
~/coding-dojo/fx-telarana/      — Solidity contracts (Morpho, gateway, perps, hooks)
```

Both repos need a new branch: `feat/hookathon-yield-engine`

## Architecture Specs (read these first)

```
defi-web-app/docs/architecture/
  ├── hybrid-clob-spec.md                  — DONE, shipped
  ├── turbo-fee-vault-spec.md              — Unified liquidity layer spec
  └── rust-keeper-consolidation-spec.md    — Keeper migration plan
```

## What to Build (in order)

### Phase 0: Deploy Uniswap v4 on Arc Testnet + Fuji (fx-telarana repo) ✅ DONE

Deployed via `contracts/script/DeployUniswapV4.s.sol`.
- Arc: `0x403Aa1347a77195FB4dEddc362758AA9e0a48D2E`
- Fuji: `0x5A517f51edca02880542effb8b6a3bdFaAcaD8B2`

```bash
# Arc Testnet (5042002)
forge script script/DeployPoolManager.s.sol \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key $DEPLOYER_PRIVATE_KEY --broadcast

# Avalanche Fuji (43113)
forge script script/DeployPoolManager.s.sol \
  --rpc-url https://api.avax-test.network/ext/bc/C/rpc \
  --private-key $DEPLOYER_PRIVATE_KEY --broadcast
```

Also deploy PositionManager from v4-periphery on both chains.

### Phase 1: TurboFeeVault.sol (fx-telarana repo)

Fee splitter: 50% protocol / 40% LP yield / 10% insurance.
Interface at `docs/architecture/turbo-fee-vault-spec.md`.
Wire `FxOrderSettlement.settleMatch()` to call `vault.depositFee()`.

### Phase 2: FxHedgeHook.sol + cirBTC/USDC Pool (fx-telarana repo)

THE HOOKATHON DEMO. Uniswap v4 hook that auto-hedges LP exposure:
- `beforeAddLiquidity`: open BTC/USD short perp on BUFX CLOB
- `afterSwap`: rebalance hedge if exposure changed
- `beforeRemoveLiquidity`: close hedge proportionally

Create cirBTC/USDC pool on Arc with hook attached. Demo script:
1. LP without hook → BTC drops → show IL loss
2. LP with hook → BTC drops → IL neutralized
3. Both earned swap fees. Only hedged LP kept theirs.

### Phase 3: LiquidationRouter.sol (fx-telarana repo)

Atomic `flagAccount + liquidate` in one tx. Eliminates the gap
between flag and liquidation where price can move further.

### Phase 4: Deploy Envio to Hosted Service (defi-web-app repo)

```bash
cd services/envio-yield
npx envio deploy  # or envio dev with Docker for local
```

Envio indexes: MatchSettled, SpotFxExecuted, FundingPoked,
MorphoBlue Supply/Withdraw/Borrow/Repay, TurboFeeVault events.

### Phase 5: Wire UI to Envio (defi-web-app repo)

Replace Ponder GraphQL queries with Envio endpoint.
Show composite APY in lending table (IRM + fee boost).

### Phase 6: Rust Liquidator (defi-web-app/services/matcher/)

Migrate `keeper-perps-liquidator` to Rust module inside the matcher.
Event-driven via Pyth WS feed. Envio for position set.

## Key Contract Addresses (Arc Testnet 5042002)

```
FxOrderSettlement:    0xCeae7846c8ED2Dd9E6f541798a657875305EA0d8
FxPerpClearinghouse:  0x7707d108F6Ce3d95ceA38D3965448F00C21CaFdC
FxSpotExecutor:       0x4e7372108529C0e7cb3aa0fF92B1c52e06e9e72f
FxMarginAccount:      0x77BBAef17257AD4800BE12A5D36AF87f3a49FBb7
FxFundingEngine:      0xE08a146B9081A8dd32203fC5e7B5988352489518
MorphoBlue:           0x65f435eB4FF05f1481618694bC1ff7Ee4680c0A4
FxOracle:             0xF181caF51bD2450211CB9e72d5Cc853d3789698B
FxHealthChecker:      0x234E06a0761cde322E4Fc5065A8256247669F362
FxLiquidationEngine:  0x18DEA7845c36d45AaDbcCeC04aC6cFc103748D80
FeeConfig:            0xa589040434735710aEF173e31e421a2d0a20Dd17
FeeCollector:         0x1894C8c84F3a8DD1e17B237008a197feD2E299B6
```

### Phase 0 Deployments (Uniswap v4 PoolManager)

```
Arc Testnet (5042002):  0x403Aa1347a77195FB4dEddc362758AA9e0a48D2E
Avalanche Fuji (43113): 0x5A517f51edca02880542effb8b6a3bdFaAcaD8B2
```

### Phase 1 Contracts (TurboFeeVault)

Source: `fx-telarana/contracts/src/hub/TurboFeeVault.sol`
Interface: `fx-telarana/contracts/src/interfaces/ITurboFeeVault.sol`

Deployed: `0x929e222CBbC154f8e75a8DEF951288886Df70531`

Wired consumers:

- `FxPerpClearinghouse`: `0x7707d108F6Ce3d95ceA38D3965448F00C21CaFdC`
- `FxSpotExecutor`: `0x4e7372108529C0e7cb3aa0fF92B1c52e06e9e72f`

Arc TGH `SPOT_FX` routes for EURC, JPYC, MXNB, and CHFC now point at the same
fee-vault-enabled `FxSpotExecutor` (`0x4e7372108529C0e7cb3aa0fF92B1c52e06e9e72f`).
Readback verified on Arc block `44186984`.

JPYC (official):      0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29

Pyth BTC/USD feed: `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`
Pyth JPY/USD feed: `0xef2c98c804ba503c6a707e38be4dfbb16683775f195b091252bf24693042fd52`

## NEW: Official JPYC on Arc Testnet

JPYC is deployed at the same address on ALL supported chains:
- Arc Testnet (5042002): 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29
- Avalanche Fuji (43113): 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29
- Sepolia (11155111): 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29
- Polygon Amoy (80002): 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29
- Kaia Kairos (1001): 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29

Faucet: https://faucet.jpyc.co.jp (1 tx/day)
User has 6M JPYC available for seeding.

This replaces the old test synthetic `tJPYC`. Deploy the hookathon with
BOTH demo pairs:

- **cirBTC/USDC** — crypto hedge (BTC volatility, dramatic IL demo)
- **JPYC/USDC** — FX hedge (JPY stability, sustainable yield demo)

The JPYC pair is the stronger product story: real FX stablecoin,
real issuer token, low volatility = cheap hedge = pure yield play.
cirBTC is the dramatic demo. JPYC is the production use case.

## Key Decisions Already Made

- Morpho pools ARE Uniswap v4 pools (same liquidity, hooks connect them)
- Arc = execution hub (CLOB + spot + hooks + vault)
- Fuji = lending hub (Morpho + gateway)
- 7 spoke chains feed deposits via CCTP
- Fee split: 50% protocol / 40% LP yield / 10% insurance
- cirBTC/USDC is the hookathon demo pair
- Perps are zero-sum contracts, not loans. Insurance covers liquidation failures only.
- Delta neutral: hedge cancels price risk, LP keeps swap fees
- Envio over Ponder (158x faster, Arc HyperSync at https://5042002.rpc.hypersync.xyz)
- ConnectKit for wallet (replaced Dynamic Labs)

## Environment

```bash
# defi-web-app
MATCHER_WS_BIND=127.0.0.1:3007
MATCHER_CHAIN_ID=5042002
NEXT_PUBLIC_REOWN_PROJECT_ID=552cc1a2e5cd90a14345caa96a055f3c
NEXT_PUBLIC_MATCHER_WS_URL=ws://127.0.0.1:3007/v1/markets

# fx-telarana
ARC_RPC_URL=https://rpc.testnet.arc.network
FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
DEPLOYER_PRIVATE_KEY=$KEEPER_PRIVATE_KEY  # same key
```

## Start Command

```bash
# Create branches in both repos
cd ~/coding-dojo/defi-web-app && git checkout -b feat/hookathon-yield-engine
cd ~/coding-dojo/fx-telarana && git checkout -b feat/hookathon-yield-engine

# Read the specs
cat ~/coding-dojo/defi-web-app/docs/architecture/turbo-fee-vault-spec.md
cat ~/coding-dojo/defi-web-app/docs/architecture/rust-keeper-consolidation-spec.md

# Start with Phase 0: deploy Uniswap v4 on Arc
```
