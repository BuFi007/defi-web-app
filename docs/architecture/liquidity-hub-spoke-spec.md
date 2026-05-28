# BUFX Hub-and-Spoke Liquidity Strategy

> **Goal:** Bootstrap liquidity for every FX pair (JPYC, EURC, MXNB, AUDF, QCAD, cirBTC, …)
> across Arc + Avalanche hubs and 7 spoke chains, without holding inventory for
> assets that already have natural liquidity elsewhere. DRY + KISS. Toggle-able
> testnet→mainnet routes via a single registry.

## TL;DR

Two hubs (Arc, Avalanche), seven spokes, one asset registry. For each asset we
declare:
- **Liquidity home**: the chain where real on-chain depth exists
- **Bridge strategy**: how we move it to/from hub chains
- **Pool ownership**: are we the LP (testnet bootstrap) or routing to external (mainnet)

For each pair we declare:
- **Primary venue**: where the swap actually happens
- **Routing path**: how funds reach that venue
- **Self-LP fallback**: do we provide LP if external fails

Single contract reads this and routes. Same code on testnet and mainnet — only
the registry entries change.

---

## Liquidity geography (the audit from yesterday)

| Token | Real liquidity location | Liquidity depth | Bridge type |
|-------|------------------------|-----------------|-------------|
| **USDC** | Every chain (CCTP) | ∞ | CCTP V2 |
| **EURC** | Avalanche, Base, Ethereum | $3.3M on Avalanche UniV3 | CCTP V2 (Circle) |
| **JPYC** | Polygon | $17K on Polygon UniV3 | Axelar / native JPYC bridge |
| **MXNB** | Avalanche (Bitso home) | Sparse | Hyperlane warp route (we deploy) |
| **AUDF** | Polygon/Avalanche (Forte) | Sparse | Hyperlane warp route |
| **QCAD** | Polygon (Stablecorp) | Sparse | Hyperlane warp route |
| **cirBTC** | Multi-chain (Circle) | Multi-chain | Native Circle bridge |

**Key insight**: Only USDC + EURC + JPYC have natural external liquidity. The
other four (MXNB, AUDF, QCAD, cirBTC) we have to LP ourselves on hubs.
But that's OK — they're small markets and our LP can be small too ($100-500
per pool is enough for testnet demos and early mainnet trading).

---

## Architecture: 3 layered registries

### Layer 1: `AssetRegistry`

Source of truth for "what is this token and where does it live."

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract AssetRegistry is AccessControl {
    bytes32 public constant ASSET_ADMIN_ROLE = keccak256("ASSET_ADMIN_ROLE");

    enum BridgeStrategy {
        None,           // not cross-chain transferrable
        CCTP,           // Circle CCTP V2 (USDC, EURC after 2025)
        CircleGateway,  // Circle's atomic gateway (USDC unified balance)
        Hyperlane,      // We deploy a warp route — most decentralized, we control
        Axelar,         // For tokens with official Axelar bridges (JPYC)
        LayerZeroOFT,   // For tokens issued as OFT (some stablecoins)
        Wormhole        // Fallback for assets only available on Wormhole NTT
    }

    struct AssetConfig {
        string symbol;             // canonical, e.g. "JPYC"
        uint8 decimals;            // 6 or 18 typically
        bytes32 canonicalAddress;  // if same on all chains (JPYC, EURC are same address everywhere)
        BridgeStrategy strategy;
        uint256 liquidityHomeChainId; // where the deepest pool lives
        address[] bridgeContracts; // per-chain bridge endpoints
        bool enabled;
    }

    // assetKey = keccak256(symbol)
    mapping(bytes32 assetKey => AssetConfig) public assets;

    // perChainAddress[assetKey][chainId] = token address on that chain
    mapping(bytes32 assetKey => mapping(uint256 chainId => address)) public perChainAddress;

    event AssetRegistered(bytes32 indexed assetKey, string symbol, BridgeStrategy strategy);
    event AssetEnabled(bytes32 indexed assetKey, bool enabled);
    event ChainAddressSet(bytes32 indexed assetKey, uint256 chainId, address tokenAddress);

    // Admin: register asset, enable per chain, etc.
}
```

**Why this exists**: a single source of truth tells the protocol "for asset X
on chain Y, use token address Z and bridge through method W to chain V if you
need to move it."

### Layer 2: `PoolRegistry` (the contract we built yesterday)

Maps `(tokenIn, tokenOut)` → `(venue, pool)`. Already shipped in commit
`c6acec7`. Lives at fx-telarana `src/hub/PoolRegistry.sol`.

The PoolRegistry now consults AssetRegistry to:
1. Resolve the canonical token addresses across chains
2. Discover bridge endpoints when a route requires cross-chain hop

### Layer 3: `LiquidityRouter` (also built yesterday)

Reads from PoolRegistry, dispatches to venue routers. Already shipped.

Extension: add a `_swapCrossChain` implementation that:
1. Reads `AssetRegistry.bridgeContracts[asset][sourceChain]`
2. Locks/burns asset on source chain
3. Calls bridge with target chain + recipient = AssetRegistry's hub address on target
4. After bridge attestation, swaps on target chain
5. Bridges result back

For mainnet, this can become **synchronous via intent system** (Across-style),
but for now we use async with the Telarana gateway pattern.

---

## Hub-to-hub liquidity sharing (Arc ↔ Avalanche)

The two hubs need shared USDC liquidity so traders can lend/borrow/trade on either side.

### USDC layer: CCTP V2 (already integrated)

Already done. Telarana gateway uses CCTP V2 for USDC.
- Arc → Avalanche: ~2 min, $0 fee (just gas)
- Avalanche → Arc: ~2 min, $0 fee

### Non-USDC asset layer: per-asset bridge

| Asset | Hub-to-hub bridge | Source contract |
|-------|-------------------|-----------------|
| USDC  | CCTP V2           | TokenMessengerV2 |
| EURC  | CCTP V2           | TokenMessengerV2 (Circle launched EURC CCTP late 2024) |
| JPYC  | Axelar / native   | JPYC's own multi-chain support |
| MXNB  | **Hyperlane warp route** (we deploy) | BUFX-owned ICA |
| AUDF  | Hyperlane warp route | BUFX-owned ICA |
| QCAD  | Hyperlane warp route | BUFX-owned ICA |
| cirBTC | Circle native bridge | TBD per Circle |

**Why Hyperlane for tokens we control?**
- Cheapest gas (~$0.05 per message vs $5 Wormhole)
- We choose the ISM (Interchain Security Module) — can use a multisig or a single validator on testnet, swap to Hyperlane's Aggregation ISM on mainnet
- Permissionless to deploy warp routes
- Already used by Berachain, Mode, Eclipse, etc.

---

## Spoke → Hub routing (7 spoke chains)

Spokes (Sepolia, Arb Sepolia, Base Sepolia, OP Sepolia, Worldchain, Tenderly Base, Unichain) host **no liquidity**. They route to a hub.

```
User on Sepolia wants JPYC:
  1. Sepolia → Arc (USDC via CCTP, ~2 min)
  2. Arc hub looks up JPYC route in PoolRegistry
  3. Best route: self-LP'd pool on Arc (testnet) or routed Polygon swap (mainnet)
  4. Hub delivers JPYC to user (either holds at hub or bridges back to Sepolia)
```

The Telarana gateway already does steps 1-4 atomically for USDC. We extend it
to deliver any AssetRegistry-registered token.

---

## The per-asset launch playbook

This is the DRY part — every asset launches the same way:

### Per-asset checklist

```
□ 1. Register asset in AssetRegistry
       - symbol, decimals, canonical address (if same across chains)
       - bridge strategy (CCTP / Hyperlane / Axelar / etc.)
       - liquidity home chain

□ 2. Set per-chain token addresses
       - Arc Testnet (current), Arc Mainnet (when launched)
       - Avalanche Fuji (current), Avalanche C-Chain (mainnet)
       - Polygon Mumbai/Amoy + Polygon mainnet (if liquidity home)

□ 3. Deploy bridge endpoints (one-time per asset)
       - Hyperlane: deploy warp route on hub chains
       - CCTP/Circle Gateway: nothing — Circle already deployed
       - Axelar: register asset via Axelar UI / SDK
       - LayerZero OFT: deploy OFT contract pair

□ 4. Create or register pools
       - Hub chains (Arc + Avalanche): deploy v4 pool with FxHedgeHook
       - Liquidity home chain: register existing Uniswap V3 pool address
       - Update PoolRegistry routes

□ 5. Seed initial liquidity (testnet) or LP-recruit (mainnet)
       - Testnet: BUFX provides $100-500 per pool, demo-grade
       - Mainnet: launch hedge subscription, recruit existing LPs

□ 6. Wire perps market (already done for 6 assets)

□ 7. Enable in UI
       - Add to trade/loan/spot dropdowns
       - Verify all routing paths work
```

### Per-asset bridge strategies

| Asset | Step 3 (bridge) | Effort | Notes |
|-------|-----------------|--------|-------|
| USDC | Already done (CCTP) | 0 | Use Telarana |
| EURC | Already done (CCTP) | 0 | Use Telarana — Circle ships EURC CCTP since late 2024 |
| JPYC | Use JPYC's official bridge | 1 day | Same address everywhere, contact JPYC team for the bridge endpoint |
| MXNB | Deploy Hyperlane warp route | 2 days | We control both ends |
| AUDF | Deploy Hyperlane warp route | 2 days | We control both ends |
| QCAD | Deploy Hyperlane warp route | 2 days | We control both ends |
| cirBTC | Native Circle bridge | 1 day | Check Circle's docs for bridge endpoint |

**Total bridge setup work: ~1 week for all 7 assets.**

---

## Decentralization scorecard for each bridge

| Bridge | Trust model | Cost per tx | Speed | BUFX best use |
|--------|-------------|-------------|-------|---------------|
| **CCTP V2** | Circle attestation (centralized issuer) | $0 + gas | ~2 min | USDC, EURC (Circle assets) |
| **Circle Gateway** | Same as CCTP + atomic hooks | $0 + gas | ~2 min | USDC unified balance |
| **Hyperlane** | Configurable ISM (multisig or PoS) | ~$0.05 | ~2 min | Tokens we control (MXNB, AUDF, QCAD) |
| **Axelar** | 50+ PoS validators | $0.50-2 | ~1 min | JPYC (their official choice) |
| **LayerZero** | DVN (configurable, often centralized default) | $0.10-1 | ~1 min | Avoid unless required by token |
| **Wormhole NTT** | 19 guardians (federated) | $5-10 | ~15 min | Last resort only |
| **Across** | Optimistic intent + relayers | $0.05-0.50 | ~30s | USDC fast routes (future) |

**Our defaults:**
- **CCTP** for Circle assets (USDC, EURC)
- **Hyperlane** for assets we control (MXNB, AUDF, QCAD, cirBTC if Circle doesn't have one)
- **Axelar** for JPYC if that's their official choice
- **Across** as a future fast-route layer (post-mainnet)

This stack is **maximally decentralized** without sacrificing UX:
- No single federated bridge for the whole protocol
- Each asset picks its strongest trust model
- Hyperlane gives us upgrade path: start with multisig ISM (1 day to deploy), graduate to Hyperlane PoS validators (no code change)

---

## Phased rollout per currency

We launch one currency at a time. Each launch follows the per-asset checklist.

### Phase 1 (now) — Hubs: USDC + JPYC + EURC

The three with real liquidity stories.

- **USDC**: already live everywhere
- **JPYC**: route to Polygon UniV3 from Arc, OR self-LP on Arc testnet for demos
- **EURC**: route to Avalanche UniV3 from Arc, OR self-LP on Arc testnet

### Phase 2 — Hubs: Self-LP'd assets (MXNB, AUDF, QCAD, cirBTC)

- Deploy Uniswap v4 pools on Arc + Avalanche
- Seed $100-500 per pool from BUFX
- Launch hedge subscription to recruit external LPs

### Phase 3 — Spoke deposits

- Wire 7 spoke chains via CCTP for USDC
- Per-asset bridge for non-USDC (Hyperlane warp routes deployed)
- UI shows "Deposit from any chain, swap on hub"

### Phase 4 — Cross-chain spot via intent system

Replace async bridge-swap-bridge with Across-style intent routing for instant
cross-chain spot. Sub-30-second UX.

---

## The contract changes needed (concrete code)

### 1. Deploy `AssetRegistry.sol`

New contract — write it in fx-telarana. ~200 lines.

### 2. Extend `PoolRegistry.sol`

Add a reference to AssetRegistry for cross-chain route resolution:

```solidity
contract PoolRegistry {
    AssetRegistry public immutable ASSETS;

    // When resolving a CrossChain route, consult AssetRegistry to figure out
    // which token address to use on the target chain.
    function resolveCrossChainTokenAddress(bytes32 assetKey, uint256 targetChainId)
        external view returns (address) {
        return ASSETS.perChainAddress(assetKey, targetChainId);
    }
}
```

### 3. Implement `LiquidityRouter._swapCrossChain`

Wire it to the Telarana gateway (already deployed). The gateway handles CCTP
USDC moves; we add hooks for Hyperlane warp route messages for other assets.

### 4. Deploy Hyperlane warp routes (per non-Circle asset)

For each of MXNB, AUDF, QCAD, cirBTC:
- Deploy `HypERC20Collateral` on the source chain (locks token, sends message)
- Deploy `HypERC20Synthetic` on the destination chain (receives message, mints synthetic)
- Wire them via Hyperlane's `Mailbox`

Hyperlane provides templates and tooling — total ~1 day per asset.

### 5. Update `FxSpotExecutor` to use LiquidityRouter

The refactor we deferred yesterday. Now becomes the unblock for everything else.

---

## What this gives you

**For the hookathon (immediate):**
- Self-LP'd pools on Arc Testnet for all 6 FX pairs — $300-1000 total capital
- Demo narrative: "BUFX routes spot to wherever liquidity lives. Today our pools, tomorrow Uniswap's"

**For mainnet (Week 2-4):**
- Flip PoolRegistry routes from `SelfLP_V4` → real Uniswap pools
- Hyperlane warp routes deployed for non-Circle assets
- Hub-to-hub USDC + EURC via CCTP, JPYC via Axelar
- Spoke chains route through gateway

**For Year 2+ (post-launch):**
- BUFX is pure infrastructure — every Uniswap LP can subscribe to hedge service
- Liquidity flows where the user is, BUFX coordinates
- Hedge subscription becomes primary revenue line

---

## What we ship this week

### Day 1: AssetRegistry (today)
Deploy AssetRegistry on Arc + Fuji. Seed it with all 7 assets and their bridge strategies.

### Day 1: PoolRegistry + LiquidityRouter on-chain
The contracts are built (commit `c6acec7`). Broadcast them. Wire them to AssetRegistry.

### Day 2: Self-LP'd pools on Arc Testnet
Deploy v4 pools for EURC, MXNB, AUDF, QCAD (the four without pools yet — JPYC and cirBTC already exist).
Seed each with ~$100 of LP. Total cost: ~$400-600.

### Day 3: Hyperlane warp routes for MXNB on Arc ↔ Avalanche
Pilot one asset to validate the deployment pattern. Document the recipe.

### Day 4: Replicate Hyperlane warp routes for AUDF, QCAD
Apply the recipe to the other two.

### Day 5: FxSpotExecutor refactor + UI integration
Spot trades now route through LiquidityRouter. UI shows the venue + ETA.

### Week 2: Cross-chain spot delivery for JPYC (Polygon) + EURC (Avalanche)
Wire the Telarana gateway to deliver non-USDC assets via Axelar / CCTP.

---

## Risks + mitigations

| Risk | Mitigation |
|------|-----------|
| Hyperlane warp route exploit | Use multisig ISM on testnet, Hyperlane PoS on mainnet |
| External pool drained mid-trade | LiquidityRouter has minAmountOut check; reverts cleanly |
| Bridge attestation delay | UI shows ETA; user signs once, gateway handles async |
| Self-LP'd pools sandwich attack | Hedge hook plus TWAP check we added in commit `a7b1499` |
| Wrong AssetRegistry config bricks routing | Multisig admin (Phase 3 of decentralization spec) |

---

## Bottom line

Three contracts (AssetRegistry, PoolRegistry, LiquidityRouter) + Hyperlane warp
routes + the existing Telarana CCTP gateway = full hub-and-spoke liquidity
system. Capital-light, decentralized per-asset, mainnet-ready by route flip.

**Estimated total testnet capital needed: $400-800 for self-LP'd pools.**
**Estimated total mainnet capital needed: $0** (route to external pools, hedge subscription is the revenue model).
