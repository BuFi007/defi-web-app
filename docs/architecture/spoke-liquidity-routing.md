# Spoke Liquidity Routing Spec

> Extension to `liquidity-hub-spoke-spec.md`. Defines how spoke-chain users
> reach liquidity homes (Polygon for JPYC, Avalanche for EURC) without us
> running a market maker on every chain.

## The problem

A user on Sepolia wants to buy JPYC. The real JPYC liquidity is on **Polygon**
(Uniswap V3, ~$17K depth). How does USDC on Sepolia end up as JPYC delivered
either to Sepolia or held at the hub?

Naive answer: bridge through 4 chains in sequence. UX disaster.
Smart answer: **hub-and-spoke with held positions**.

---

## Three roles per chain

| Role | Examples | Function |
|------|----------|----------|
| **Hub** | Arc Testnet, Arc mainnet, Avalanche C-Chain | User-facing trade settlement |
| **Spoke** | Sepolia, Arb/Base/OP Sepolia, Worldchain | Deposit origin only — no markets |
| **Liquidity Source** | Polygon (JPYC), Avalanche (EURC) | External Uniswap depth we tap |

A chain can wear multiple hats. Avalanche C-Chain is **both** a hub (we settle trades there) **and** a liquidity source (EURC depth lives there).

---

## Two bridge primitives

| Asset class | Bridge | Why |
|-------------|--------|-----|
| USDC + EURC | **CCTP V2** | Circle native, atomic, $0 fee, every spoke supports it |
| Everything else | **Hyperlane warp routes** (we deploy) | Permissionless, cheap, configurable security |

That's it. Two bridges. No Wormhole, no LayerZero, no Axelar (we drop Axelar — keep it simple, Hyperlane covers JPYC too).

---

## The asset matrix

For each asset, declare its bridge graph. Hub stays at the center, but the
graph extends to liquidity sources AND down to spokes.

### USDC (every chain via CCTP)

```
Sepolia ──CCTP──┐
Arb Sep ──CCTP──┤
Base Sep ─CCTP──┼──> Arc Hub <──CCTP──> Avalanche Hub
OP Sep ───CCTP──┤      ▲
Worldchain CCTP─┘      │
                       └──CCTP──> Polygon (when tapping JPYC route)
                       └──CCTP──> Ethereum (when tapping EURC route)
```

CCTP is dollars. Free, atomic, 2 min. No questions.

### EURC (CCTP-native asset since late 2024)

```
Sepolia ──CCTP──┐
Base Sep ─CCTP──┼──> Arc Hub <──CCTP──> Avalanche Hub (LIQUIDITY SOURCE: $3.3M Uniswap V3)
                       ▲
                       └──CCTP──> Ethereum mainnet (deeper depth, mainnet)
```

EURC follows the same CCTP topology. Avalanche is BOTH a hub and the liquidity
source — that simplifies our spec massively. From Arc, a "buy EURC" trade is:
1. Already on Avalanche? Just swap there.
2. Want EURC delivered to Arc? CCTP it back after swap.

### JPYC (Hyperlane warp routes — Polygon is liquidity source)

```
Sepolia*       Arb Sep*       Base Sep*       OP Sep*
   │              │               │              │
   └──CCTP USDC───┴───────────────┴──────────────┘
                            │
                            ▼
                    ┌─── Arc Hub ───┐
                    │   (settlement)│
                    └───────┬───────┘
                            │
                  Hyperlane warp route JPYC
                            │
                            ▼
                    Polygon (Uniswap V3 — $17K JPYC depth)
                            ▲
                  Hyperlane warp route JPYC
                            │
                    ┌─── Avalanche Hub ──┐
                    │   (settlement)     │
                    └────────────────────┘

* spokes use the closer hub (gas-price routing)
```

JPYC needs 3 Hyperlane warp routes for full coverage:
1. Arc ↔ Fuji (hub-to-hub liquidity sharing) — **the agent is deploying this now**
2. Arc ↔ Polygon (liquidity source tap, **MAINNET**)
3. Avalanche ↔ Polygon (liquidity source tap, **MAINNET**)

For testnet: route 1 only. Routes 2 + 3 are mainnet day-1.

### MXNB, AUDF, QCAD, cirBTC (self-LP'd, no external)

```
Sepolia*       Arb Sep*       Base Sep*       OP Sep*
   │              │               │              │
   └──CCTP USDC───┴───────────────┴──────────────┘
                            │
                            ▼
                    ┌─── Arc Hub ───┐
                    │  (Self-LP'd   │
                    │   v4 pool)    │
                    └───────┬───────┘
                            │
                  Hyperlane warp route asset
                            │
                            ▼
                    ┌─── Avalanche Hub ──┐
                    │  (Self-LP'd v4)    │
                    └────────────────────┘
```

These four don't have meaningful external liquidity anywhere. So:
- We provide LP on Arc + Avalanche hubs ($100-200 per pool)
- Hyperlane warp route lets the asset move between hubs
- Spokes use CCTP USDC to reach a hub, then trade there

---

## The user experience

### "Buy JPYC from Sepolia" — testnet (today)

```
1. UI: User on Sepolia, has 100 USDC
2. UI sends: TelaranaGatewayHubHook.depositToHub(Arc, USDC, 100, hubCalldata)
   hubCalldata encodes: LiquidityRouter.swapExactIn(USDC → JPYC, recipient)
3. CCTP burns USDC on Sepolia, mints on Arc (~2 min)
4. FxHubMessageReceiver on Arc executes the hubCalldata
5. LiquidityRouter swaps USDC → JPYC via SelfLP_V4 pool
6. JPYC delivered to user's address on Arc (held at hub)
7. UI shows "1000 JPYC available at Arc"
8. If user wants delivery to Sepolia: Hyperlane warp route JPYC Arc → Sepolia
```

### "Buy JPYC from Sepolia" — mainnet (when Polygon route lands)

Same up to step 4. Then:

```
5. LiquidityRouter sees JPYC liquidity home = Polygon
6. Bridges USDC Arc → Polygon via CCTP (~2 min)
7. Swaps USDC → JPYC on Polygon Uniswap V3
8. Bridges JPYC Polygon → Arc via Hyperlane (~2 min)
9. JPYC arrives at Arc hub, available to user
```

Total: ~6 min, all liquidity from Polygon Uniswap. Zero BUFX inventory.

---

## What we deploy this week

### Already done (testnet)
- Hyperlane core on Arc Testnet ✅
- Hyperlane core on Fuji ✅ (official)
- Trust ISM Arc ↔ Fuji ✅

### In flight (this morning's agent)
- Hyperlane warp routes Arc ↔ Fuji for JPYC, MXNB, AUDF, QCAD, cirBTC

### Next (this week)
- Self-LP'd v4 pools on Arc for the 4 illiquid assets (MXNB, AUDF, QCAD, cirBTC)
- Self-LP'd v4 pools on Fuji (mirror)
- AssetRegistry + PoolRegistry config

### Mainnet day-1 list
- Hyperlane warp route **Arc ↔ Polygon** for JPYC
- Hyperlane warp route **Avalanche ↔ Polygon** for JPYC
- (EURC routes via CCTP — no warp route needed)
- (USDC routes via CCTP — already done)

---

## Spoke chains: what they need to wire

Per spoke, the wiring is identical:

| Chain | Needs | Status |
|-------|-------|--------|
| Sepolia | FxSpoke contract + CCTP TokenMessenger reference | Deployed |
| Arb Sepolia | Same | Deployed |
| Base Sepolia | Same | Deployed |
| OP Sepolia | Same | Deployed |
| Worldchain Sepolia | Same | Deployed |
| Tenderly Base | Same | Deployed |
| Unichain Sepolia | Same | TODO |

Spokes only know USDC + the hub address. No asset-specific code.

---

## The five-asset launch matrix

Per asset, here's what we need to flip on/off for testnet vs mainnet.

| Asset | Testnet route | Mainnet route | Hyperlane warps needed |
|-------|--------------|---------------|------------------------|
| USDC | CCTP everywhere | CCTP everywhere | 0 (CCTP only) |
| EURC | CCTP + self-LP Arc | CCTP, swap on Avalanche UniV3 | 0 (CCTP only) |
| JPYC | Self-LP Arc, warp Arc↔Fuji | Warp Arc↔Polygon (UniV3 swap there) | Arc↔Fuji, Arc↔Polygon, Avalanche↔Polygon |
| MXNB | Self-LP Arc+Fuji | Self-LP Arc+Avalanche mainnet | Arc↔Fuji, Arc↔Avalanche |
| AUDF | Self-LP Arc+Fuji | Self-LP Arc+Avalanche mainnet | Arc↔Fuji, Arc↔Avalanche |
| QCAD | Self-LP Arc+Fuji | Self-LP Arc+Avalanche mainnet | Arc↔Fuji, Arc↔Avalanche |
| cirBTC | Self-LP Arc+Fuji | Self-LP Arc+Avalanche mainnet | Arc↔Fuji, Arc↔Avalanche |

**Total Hyperlane warp routes for mainnet day 1**: ~8 warp route deployments
(2-3 per asset). At ~$5 gas each on mainnet that's $40 in capital.

---

## The KISS pattern (single line per route)

Every route in the system can be expressed as one row in a registry:

```
Asset    From       To              Bridge       Pool
─────    ────       ──              ──────       ────
USDC     <any>      Arc Hub          CCTP         (n/a, just bridge)
JPYC     Arc Hub    Polygon          Hyperlane    (n/a, bridge only)
JPYC     Polygon    UniswapV3        n/a          0xfda7E76F...02eB6
EURC     Arc Hub    Avalanche Hub    CCTP         (n/a, just bridge)
EURC     Avalanche  UniswapV3        n/a          0x975d4286...11b3
MXNB     Arc Hub    Self-LP'd v4     n/a          0x<arc pool>
MXNB     Arc Hub    Avalanche Hub    Hyperlane    (n/a, bridge only)
```

The PoolRegistry + AssetRegistry combination encodes this. LiquidityRouter
walks the graph at execution time. Adding a new asset = add rows to both
registries. Switching testnet → mainnet = flip `enabled` bits.

---

## TL;DR for our current launch

1. **Today's warp routes (Arc↔Fuji)**: prove the mechanic on testnet
2. **Self-LP on Arc** ($100 × 4 pools): JPYC, MXNB, AUDF, QCAD, cirBTC, EURC = $600
3. **Mainnet day**: deploy 8 warp routes, flip route preference from SelfLP → external
4. **Spokes**: already wired via CCTP for USDC; non-USDC delivery via warp routes only on-demand

This is the full spec. No new bridge primitives. Two registries + LiquidityRouter + existing Telarana gateway = complete cross-chain spot system.
