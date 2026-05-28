# PoolRegistry + Hedge Subscription Spec

> **Thesis:** BUFX doesn't compete for spot liquidity. We tap whatever DEX has
> the best liquidity (Uniswap v4, Uniswap V3, Trader Joe, self-LP'd pools) via
> a pluggable registry, and we make external Uniswap LPs more profitable via a
> hedge subscription service. Capital-light by design, mainnet-ready day one.

## Why this exists

Three problems solved by one contract:

1. **Bootstrap on testnet without lying about mainnet** — same code on Arc testnet (self-LP'd pools) and Arc mainnet (real Uniswap v4 pools). Flip a registry entry, done.
2. **Multi-DEX routing** — Avalanche mainnet has JPYC liquidity on Trader Joe v2.2 TODAY. Route there from Arc via CCTP cross-chain spot.
3. **Hedge subscription service** — any Uniswap pool with FX exposure can register with FxHedgeHook and offload IL risk to the BUFX perps CLOB. New revenue surface, zero capital required.

## Contracts

### `PoolRegistry.sol`

Single source of truth for "which pool serves what trade." Admin-gated by
multisig timelock (Phase 3 of decentralization spec). Read by FxSpotExecutor
and FxHedgeHook.

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PoolRegistry
/// @notice Maps a canonical FX pair (tokenIn → tokenOut) to a venue + pool.
///         Lets FxSpotExecutor and FxHedgeHook route through different DEX
///         backends without protocol-level redeploys.
///
///         On Arc testnet: routes point at self-LP'd pools.
///         On Arc mainnet: routes point at real Uniswap v4 pools.
///         On Avalanche mainnet: routes point at Trader Joe or Pangolin.
contract PoolRegistry is AccessControl {
    bytes32 public constant ROUTE_ADMIN_ROLE = keccak256("ROUTE_ADMIN_ROLE");

    enum Venue {
        SelfLP_V4,      // BUFX-deployed Uniswap v4 pool (testnet bootstrap)
        UniswapV4,      // External Uniswap v4 pool (Arc mainnet, future)
        UniswapV3,      // External Uniswap v3 pool (Avalanche, Polygon)
        TraderJoeV22,   // Trader Joe v2.2 (Avalanche mainnet)
        PangolinV2,     // Pangolin V2 (Avalanche fallback)
        CrossChain      // Routes via CCTP to another chain's registry
    }

    struct Route {
        Venue venue;
        address pool;        // pool address on this chain
        bytes32 poolKey;     // v4-style poolKey if venue == V4
        uint256 targetChainId; // for CrossChain — destination chain
        uint16 spreadBps;    // venue-specific fee/spread to charge
        bool enabled;
        bool preferred;      // if true, route here even when other venues quote
    }

    /// keccak(tokenIn, tokenOut) → ordered list of routes (best first)
    mapping(bytes32 pairKey => Route[]) public routes;

    /// Venue address registry — Universal Router, Quoter, etc.
    mapping(Venue venue => address router) public venueRouters;

    event RouteAdded(bytes32 indexed pairKey, Venue venue, address pool, uint256 chainId);
    event RouteUpdated(bytes32 indexed pairKey, uint256 idx, Venue venue, address pool, bool enabled);
    event RouteRemoved(bytes32 indexed pairKey, uint256 idx);
    event VenueRouterSet(Venue indexed venue, address router);

    error PairNotFound(bytes32 pairKey);
    error VenueRouterNotSet(Venue venue);
    error InvalidRoute();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ROUTE_ADMIN_ROLE, admin);
    }

    // ── Admin (multisig timelock in production) ─────────────────────

    function addRoute(address tokenIn, address tokenOut, Route calldata route)
        external onlyRole(ROUTE_ADMIN_ROLE)
    {
        bytes32 key = pairKey(tokenIn, tokenOut);
        routes[key].push(route);
        emit RouteAdded(key, route.venue, route.pool, route.targetChainId);
    }

    function updateRoute(address tokenIn, address tokenOut, uint256 idx, Route calldata route)
        external onlyRole(ROUTE_ADMIN_ROLE)
    {
        bytes32 key = pairKey(tokenIn, tokenOut);
        if (idx >= routes[key].length) revert InvalidRoute();
        routes[key][idx] = route;
        emit RouteUpdated(key, idx, route.venue, route.pool, route.enabled);
    }

    function setVenueRouter(Venue venue, address router) external onlyRole(ROUTE_ADMIN_ROLE) {
        venueRouters[venue] = router;
        emit VenueRouterSet(venue, router);
    }

    // ── Read paths ─────────────────────────────────────────────────

    function pairKey(address tokenIn, address tokenOut) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenIn, tokenOut));
    }

    /// @notice Returns the first enabled route for a pair, or the preferred route if any.
    function bestRoute(address tokenIn, address tokenOut) external view returns (Route memory) {
        bytes32 key = pairKey(tokenIn, tokenOut);
        Route[] storage list = routes[key];
        if (list.length == 0) revert PairNotFound(key);

        // First pass: preferred + enabled
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i].enabled && list[i].preferred) return list[i];
        }
        // Second pass: first enabled
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i].enabled) return list[i];
        }
        revert PairNotFound(key);
    }

    function allRoutes(address tokenIn, address tokenOut) external view returns (Route[] memory) {
        return routes[pairKey(tokenIn, tokenOut)];
    }
}
```

### `LiquidityRouter.sol`

Thin adapter that dispatches `swap()` calls to the venue-specific routers
(Uniswap V4 Universal Router, Trader Joe LBRouter, etc.) based on the
PoolRegistry route. FxSpotExecutor calls this instead of holding inventory.

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoolRegistry} from "./PoolRegistry.sol";

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface ITraderJoeRouter {
    struct Path {
        uint256[] pairBinSteps;
        uint8[] versions;
        address[] tokenPath;
    }
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Path memory path,
        address to,
        uint256 deadline
    ) external returns (uint256 amountOut);
}

contract LiquidityRouter {
    using SafeERC20 for IERC20;

    PoolRegistry public immutable REGISTRY;

    error UnsupportedVenue(PoolRegistry.Venue venue);
    error RouteDisabled();
    error InsufficientOutput(uint256 received, uint256 minOut);

    constructor(PoolRegistry registry) {
        REGISTRY = registry;
    }

    /// @notice Swap exact amountIn of tokenIn for at least minAmountOut of tokenOut.
    /// @dev Caller must approve this contract for amountIn beforehand.
    ///      Dispatches to the registry's preferred route.
    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        PoolRegistry.Route memory route = REGISTRY.bestRoute(tokenIn, tokenOut);
        if (!route.enabled) revert RouteDisabled();

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        if (route.venue == PoolRegistry.Venue.UniswapV4 || route.venue == PoolRegistry.Venue.SelfLP_V4) {
            amountOut = _swapUniV4(tokenIn, tokenOut, amountIn, minAmountOut, recipient, deadline, route);
        } else if (route.venue == PoolRegistry.Venue.UniswapV3) {
            amountOut = _swapUniV3(tokenIn, tokenOut, amountIn, minAmountOut, recipient, deadline, route);
        } else if (route.venue == PoolRegistry.Venue.TraderJoeV22) {
            amountOut = _swapTraderJoe(tokenIn, tokenOut, amountIn, minAmountOut, recipient, deadline, route);
        } else if (route.venue == PoolRegistry.Venue.CrossChain) {
            amountOut = _swapCrossChain(tokenIn, tokenOut, amountIn, minAmountOut, recipient, deadline, route);
        } else {
            revert UnsupportedVenue(route.venue);
        }

        if (amountOut < minAmountOut) revert InsufficientOutput(amountOut, minAmountOut);
    }

    /// @notice Quote without executing. Useful for FxHedgeHook + UI.
    function quote(address tokenIn, address tokenOut, uint256 amountIn)
        external view returns (uint256 amountOut, PoolRegistry.Venue venue)
    {
        PoolRegistry.Route memory route = REGISTRY.bestRoute(tokenIn, tokenOut);
        venue = route.venue;
        // venue-specific quoter calls (UniswapV4Quoter, UniswapV3Quoter, TraderJoeQuoter)
        // omitted for brevity — implementation reads price from the pool's slot0 / reserves
        amountOut = 0; // stub
    }

    // ── Venue dispatch (stubs — flesh out per venue ABI) ────────────

    function _swapUniV4(/* args */ ...) internal returns (uint256) { /* call UniversalRouter */ }
    function _swapUniV3(/* args */ ...) internal returns (uint256) { /* call SwapRouter02 */ }
    function _swapTraderJoe(/* args */ ...) internal returns (uint256) { /* call LBRouter */ }

    /// @notice Cross-chain swap via Telarana gateway + CCTP.
    /// @dev Burns tokenIn on this chain, mints on targetChain, executes swap there,
    ///      bridges tokenOut back. Slow (~2 min) but taps real mainnet liquidity.
    function _swapCrossChain(/* args */ ...) internal returns (uint256) {
        // 1. Call TelaranaGatewayHubHook.depositToHub(targetChain, tokenIn, amountIn)
        // 2. Encode hubCalldata = LiquidityRouter.swapExactIn(...) on targetChain
        // 3. Set asyncBeneficiary to msg.sender
        // 4. Return synthetic receipt — actual delivery happens after CCTP attestation
        revert UnsupportedVenue(PoolRegistry.Venue.CrossChain); // until wired
    }
}
```

### `FxHedgeSubscription.sol`

New contract — the subscription service. External Uniswap LPs register their
positions and offload IL risk to the BUFX perps CLOB. Revenue stream for BUFX,
hedged yield for LPs.

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {PoolRegistry} from "./PoolRegistry.sol";

/// @title FxHedgeSubscription
/// @notice External Uniswap LPs subscribe to offload IL risk.
///         BUFX opens an offsetting perp on the CLOB sized to the LP's
///         volatile-side exposure. LP earns Uniswap swap fees + BUFX hedge
///         service revenue share. BUFX charges 10-20 bps of LP earnings.
contract FxHedgeSubscription is AccessControl {
    bytes32 public constant SUBSCRIPTION_ADMIN = keccak256("SUBSCRIPTION_ADMIN");

    struct Subscription {
        address lp;
        bytes32 poolId;            // external Uniswap pool ID
        address volatileToken;     // the side we hedge (e.g., JPYC)
        address stableToken;       // usually USDC
        uint256 notionalE18;       // current hedged exposure
        bytes32 perpMarketId;      // BUFX perp that offsets this LP
        uint16 subscriptionFeeBps; // BUFX share of LP earnings (10-20 bps)
        bool active;
        uint256 subscribedAt;
    }

    mapping(bytes32 subKey => Subscription) public subscriptions;
    mapping(address lp => bytes32[]) public lpSubscriptions;

    event Subscribed(bytes32 indexed subKey, address indexed lp, bytes32 poolId, uint256 notional);
    event Unsubscribed(bytes32 indexed subKey, address indexed lp);
    event ExposureRebalanced(bytes32 indexed subKey, uint256 oldNotional, uint256 newNotional);
    event FeesPaidToBufx(bytes32 indexed subKey, uint256 amount);

    error NotSubscribed();
    error UnauthorizedLP();

    /// @notice Subscribe an external Uniswap LP position to BUFX hedge service.
    /// @dev Off-chain bot or LP-frontend calls this after LPing on Uniswap.
    ///      We index the LP's pool position via the v4 PoolKey or v3 NFT position ID.
    function subscribe(
        bytes32 poolId,
        address volatileToken,
        address stableToken,
        uint256 notionalE18,
        bytes32 perpMarketId
    ) external returns (bytes32 subKey) {
        subKey = keccak256(abi.encodePacked(msg.sender, poolId));
        subscriptions[subKey] = Subscription({
            lp: msg.sender,
            poolId: poolId,
            volatileToken: volatileToken,
            stableToken: stableToken,
            notionalE18: notionalE18,
            perpMarketId: perpMarketId,
            subscriptionFeeBps: 1500, // 15 bps default
            active: true,
            subscribedAt: block.timestamp
        });
        lpSubscriptions[msg.sender].push(subKey);

        // Trigger BUFX matcher to open a perp short equal to notionalE18.
        // The matcher listens for `Subscribed` and submits the perp order
        // signed by the BUFX hedge-treasury key.
        emit Subscribed(subKey, msg.sender, poolId, notionalE18);
    }

    /// @notice LP rebalances after adding/removing liquidity on Uniswap.
    ///         Triggers matcher to resize the offsetting perp.
    function rebalance(bytes32 subKey, uint256 newNotionalE18) external {
        Subscription storage sub = subscriptions[subKey];
        if (sub.lp != msg.sender) revert UnauthorizedLP();
        if (!sub.active) revert NotSubscribed();

        uint256 old = sub.notionalE18;
        sub.notionalE18 = newNotionalE18;
        emit ExposureRebalanced(subKey, old, newNotionalE18);
    }

    function unsubscribe(bytes32 subKey) external {
        Subscription storage sub = subscriptions[subKey];
        if (sub.lp != msg.sender) revert UnauthorizedLP();
        sub.active = false;
        // Matcher listens for Unsubscribed and closes the perp.
        emit Unsubscribed(subKey, msg.sender);
    }

    /// @notice BUFX collects subscription fees from LP's Uniswap rewards.
    /// @dev Called by an off-chain accountant or via Permit2.
    function collectFees(bytes32 subKey, uint256 lpEarnings) external {
        Subscription storage sub = subscriptions[subKey];
        uint256 fee = (lpEarnings * sub.subscriptionFeeBps) / 10_000;
        // Pull `fee` worth of stableToken from the LP (Permit2 or pre-approved).
        // Forward to TurboFeeVault.
        emit FeesPaidToBufx(subKey, fee);
    }
}
```

## Integration with existing contracts

### Refactor `FxSpotExecutor`

Currently the executor is a principal market maker holding token inventory.
Refactor to a thin wrapper around LiquidityRouter:

```solidity
// FxSpotExecutor.sol — executeSpotFx changes

function executeSpotFx(bytes32 requestId) external {
    SpotFxReceipt memory receipt = _loadReceipt(requestId);

    // OLD: pay from this.balance
    // IERC20(receipt.tokenOut).safeTransfer(receipt.recipient, amountOut);

    // NEW: route through LiquidityRouter
    IERC20(USDC).safeIncreaseAllowance(address(LIQUIDITY_ROUTER), receipt.amount);
    uint256 amountOut = LIQUIDITY_ROUTER.swapExactIn(
        address(USDC),
        receipt.tokenOut,
        receipt.amount,
        receipt.minAmountOut,
        receipt.recipient,
        block.timestamp + 5 minutes
    );

    // Fee routing through TurboFeeVault (unchanged)
    if (feeAmount != 0) _routeSpotFee(requestId, receipt.routeId, feeAmount);
}
```

### `FxHedgeHook` integration

The hedge hook stays on YOUR self-LP'd v4 pools (the demo).
The FxHedgeSubscription handles EXTERNAL LP positions on third-party pools
(the moat).

Same Rust matcher listens to `HedgeRebalanced` events from both contracts and
opens/resizes perps accordingly.

## Initial route configuration per chain

### Arc Testnet (5042002) — bootstrap with self-LP'd

```
USDC ↔ JPYC:    SelfLP_V4, pool=0xd19440c05e5c0d... (our deployed)
USDC ↔ EURC:    SelfLP_V4, pool=...
USDC ↔ cirBTC:  SelfLP_V4, pool=0x33e42e1b20e3ea50...
USDC ↔ MXNB:    SelfLP_V4, pool=...
USDC ↔ AUDF:    SelfLP_V4, pool=...
USDC ↔ QCAD:    SelfLP_V4, pool=...
```

Cost: $50-100 per pool one-time, just for the hookathon demo.

### Avalanche Fuji (43113) — testnet bootstrap, mirrors mainnet path

```
USDC ↔ JPYC:    CrossChain, targetChainId=43114 (Avalanche mainnet)
                Routes through Telarana gateway → CCTP → Avalanche → TraderJoe → bridge
```

### Avalanche C-Chain (43114) — ⭐ LIVE LIQUIDITY EXISTS NOW

```
USDC ↔ JPYC:    TraderJoeV22, pool=<find on dex.traderjoe.xyz>
USDC ↔ EURC:    TraderJoeV22, pool=<find>
```

You don't need to deploy anything on Avalanche mainnet — just register the
existing Trader Joe pool addresses.

### Arc Mainnet (future)

```
USDC ↔ JPYC:    UniswapV4, pool=<Arc mainnet Uniswap v4>
USDC ↔ EURC:    UniswapV4, pool=<Arc mainnet Uniswap v4>
```

Day-1 migration: admin calls `updateRoute()` to swap from SelfLP_V4 to
UniswapV4. Same FxSpotExecutor code path. No redeploy.

## Migration sequence

| Step | When | What |
|------|------|------|
| 1 | Day 1 | Deploy PoolRegistry + LiquidityRouter on Arc + Fuji |
| 2 | Day 1 | Register self-LP'd v4 pools as routes on Arc |
| 3 | Day 2 | Refactor FxSpotExecutor to use LiquidityRouter (gated by a `useRouter` flag for safe rollback) |
| 4 | Day 3 | LP $50-100 into each self-deployed v4 pool on Arc for the hookathon demo |
| 5 | Day 4 | Deploy PoolRegistry on Avalanche mainnet (43114) + register TraderJoe routes |
| 6 | Day 5 | Wire `CrossChain` venue dispatch — Telarana gateway → mainnet swap → bridge back |
| 7 | Week 2 | Launch FxHedgeSubscription, recruit 1-2 pilot LPs from Trader Joe |
| 8 | Arc mainnet launch day | Update routes from SelfLP_V4 → UniswapV4. No protocol redeploy. |

## What this strategy gives you

1. **Mainnet-ready protocol** on day one — no architectural change needed.
2. **Bootstrap with $50-300 of self-LP** instead of millions for real depth.
3. **Tap Avalanche mainnet liquidity TODAY** via cross-chain routing.
4. **Hedge subscription revenue** without holding inventory — pure infrastructure play.
5. **Killer hookathon narrative**: "We don't compete for spot. We make Uniswap LPs more profitable."

## Risks + mitigations

| Risk | Mitigation |
|------|-----------|
| Cross-chain swap is slow (~2 min) | Show ETA in UI, set user expectations. For instant trade, use synthetic perp. |
| Trader Joe / external pool drained while route is preferred | LiquidityRouter checks min output reverts. Add a venue health check that disables routes when slippage > 5%. |
| LP in subscription unsubscribes mid-trade | Subscribe/unsubscribe are atomic on-chain — no partial state. |
| Cross-chain bridge for tokenOut delivery has a failure mode | Use TelaranaGatewayHubHook's existing `stranded → swept` recovery path. |
| Off-chain matcher delay opening offsetting perp | Same delay risk as today's FxHedgeHook on self-LP'd pools — accepted. |
| LP earnings tracking for fee collection | Permit2 + signed earnings reports from the LP's wallet, or pull-based via Uniswap fee accrual reads. |

## Out of scope

- Concentrated liquidity range optimization (out of scope — that's the LP's job)
- Custom v4 hooks beyond FxHedgeHook (we don't compete with Uniswap's hook market)
- Smart order routing across multiple venues per trade (start with single-best-venue routing)
