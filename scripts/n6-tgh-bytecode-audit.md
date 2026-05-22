# Wave N6 — TelaranaGatewayHubHook bytecode audit

**Date:** 2026-05-22
**Probed against:** `0xe895CB461AFF6E98167a7FA0Db252ba906714088` on Arc Testnet (chainId 5042002, RPC `https://rpc.testnet.arc.network`).

## Reconciliation verdict — **PATH A1**

The deployed TGH is **already PR-H8 (fx-telarana #33)**. M1 was correct; the N2c probe in the previous Gateway demo script (`scripts/v4-swap-pool-demo-gateway.ts` step `probe-pr-h8-ihooks-surface`) was returning a false "predates PR-H8" because of an ABI shape mismatch on the `getHookPermissions()` tuple decode (the script expected a typed `{beforeSwap, beforeSwapReturnDelta}` shape, while the canonical v4 `IHooks.Permissions` returns a flat 14-bool tuple).

No re-deploy needed. The address bits `0xe895CB...4088` already encode the right hook permission flags.

## Direct cast probes (raw evidence)

### Hook permissions

```bash
cast call 0xe895CB461AFF6E98167a7FA0Db252ba906714088 \
  "getHookPermissions()((bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool))" \
  --rpc-url https://rpc.testnet.arc.network
# → (false, false, false, false, false, false, true, false, false, false, true, false, false, false)
```

Positions (per `Hooks.Permissions` in v4-core):
| idx | flag                          | value |
|----:|-------------------------------|------:|
| 0   | beforeInitialize              | false |
| 1   | afterInitialize               | false |
| 2   | beforeAddLiquidity            | false |
| 3   | afterAddLiquidity             | false |
| 4   | beforeRemoveLiquidity         | false |
| 5   | afterRemoveLiquidity          | false |
| **6**   | **beforeSwap**            | **true** |
| 7   | afterSwap                     | false |
| 8   | beforeDonate                  | false |
| 9   | afterDonate                   | false |
| **10**  | **beforeSwapReturnDelta** | **true** |
| 11  | afterSwapReturnDelta          | false |
| 12  | afterAddLiquidityReturnDelta  | false |
| 13  | afterRemoveLiquidityReturnDelta | false |

This matches PR-H8's `getHookPermissions()` impl verbatim (`contracts/src/hub/TelaranaGatewayHubHook.sol` head ref `origin/feat/pr-h8-gateway-intrahook-liquidity`).

Address bit check: `0xe895CB461AFF6E98167a7FA0Db252ba906714088` low-14 bits = `0x4088 & 0x3fff = 0x0088 = BEFORE_SWAP_FLAG(0x80) | BEFORE_SWAP_RETURNS_DELTA_FLAG(0x08)`. ✓

### Other immutable state

```
GATEWAY_MINTER  →  0x0022222ABE238Cc2C7Bb1f21003F0a260052475B   (canonical Circle Gateway Minter, ✓)
POOL_MANAGER    →  0x3FA22b7Aeda9ebBe34732ea394f1711887363B34   (canonical Arc v4 PoolManager, ✓)
USDC            →  0x3600000000000000000000000000000000000000   (canonical Arc USDC, ✓)
EXECUTOR_ROLE   →  0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63
paused()        →  false
```

### Keeper roles

```
hasRole(EXECUTOR_ROLE,  keeper) → true
hasRole(DEFAULT_ADMIN,  keeper) → true
```

(Keeper EOA `0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69`.)

### M4-configured Gateway route

```
gatewayRoute(0xf78147c98547731be048740d9d9089e6258e5e712e0c66f7b9d9d57d6af3a968)
  sourceDomain               = 1   (Fuji)
  destinationDomain          = 26  (Arc)
  sourceUsdc                 = 0x5425890298aed601595a70ab815c96711a31bc65 (Fuji USDC)
  destinationUsdc            = 0x3600000000000000000000000000000000000000 (Arc USDC)
  sourceGatewayWallet        = 0x0077777d7eba4688bdef3e311b846f25870a19b9
  destinationGatewayMinter   = 0x0022222abe238cc2c7bb1f21003f0a260052475b
  destinationHub             = 0xe895cb461aff6e98167a7fa0db252ba906714088 (TGH itself)
  whitelistedCaller          = 0x0
  signerMode                 = 0   (EOA)
  enabled                    = true
  metadataRef                = 0x00…

gatewayContextProofMode(routeId) = 3 (SIGNED_INTENT_OR_HYPERLANE)
```

### Pool binding state (PRE Wave N6)

```
poolGatewayRouteBinding(0xd5e4a30d…1ef [M4 FxSwapHook pool])  → 0x0
```

The M4 pool (`0xd5e4a30d113d293ff50273c0aa3626e66c3a1cb8b6ba2bf22f2420ed4f92a1ef`) is hooked by **FxSwapHook**, not TGH — so even if it were bound, the v4 swap on that pool would never call TGH.beforeSwap. To prove the differentiator we needed a fresh pool with TGH as the `hooks` field of its PoolKey.

## Wave N6 actions (live broadcast)

| # | action                                  | tx                                                                 | block     |
|--:|-----------------------------------------|--------------------------------------------------------------------|----------:|
| 1 | Deploy FxV4RouterHarnessGateway v1      | `0xe066ddb3d3c27ab9bb0c2a149f59078cde62300e21a79eae3cfb0bbf4731e92c` | 43519...  |
| 1b | Deploy FxV4RouterHarnessGateway v2      | `0x61c34355494bb31aa1c5c7efd9d45f510255ef4d1963180ebf3f6af4e47c5d91` | 43520...  |
| 1c | Deploy FxV4RouterHarnessGateway v3 (final) | `0x0d615d950cb1ec4d35a1a6a28bffda7e5a566c87f668cbc72d9b1b0de1413ca5` | 43520...  |
| 2 | PoolManager.initialize(new pool, hooks=TGH) | `0x91f605e7556c5aec98fd2a93ea00777321b55cdaf501a371404b708d01ce2921` | 43520507  |
| 3 | TGH.setPoolGatewayRoute(newPoolId, routeId) | `0x1b885470b6a0c862fd31d06ace2a433c5c6912154bf96f38e076383bcb9533a5` | 43520512  |
| 4 | EURC.approve(harness, ...)             | `0xf1f200bb6693dc5447dda1fa95bd7dcd10ffdd3113fa46e23bfe2ae274e29e9b` | 43520518  |
| **5** | **harness.swapExactInputSingleWithHookData → TGH.beforeSwap → GatewayMinter.gatewayMint → settle** | **`0x66dc22ae835884c9b50641d062a53f8a80e3191a89a9a6337e81c95f2cf9bc09`** | **43521137** |

The new pool (Wave N6, TGH-hooked):

```
PoolKey: (USDC, EURC, fee=100, tickSpacing=1, hooks=TGH)
PoolId : 0xf6b13fe5ae3115d159b3a844a56588d1549293fb6725040f01c54ba31827f711
```

## Why the Foundry trace lies

`cast run` on tx `0x66dc22ae…` shows the call to USDC.mint reverting with `StackUnderflow` inside the Arc compliance precompile `0x1800000000000000000000000000000000000001::isBlocklisted(...)`. That trace output is misleading — it's a Foundry simulation artefact (the precompile interface model in `cast run` mishandles stack depth under deep call nesting). The **actual on-chain receipt has `status: 0x1` (success)** and the USDC mint did happen (USDC.Transfer 0x0 → TGH amount=100000 is in the canonical logs).

If you're debugging in the future and see this same StackUnderflow in `cast run` output, always cross-check with `cast receipt --rpc-url … <txHash>` — the real status will tell you which trace to trust.

## Key on-chain evidence the demo worked

From `cast receipt 0x66dc22ae835884c9b50641d062a53f8a80e3191a89a9a6337e81c95f2cf9bc09`:

```
USDC.Transfer  0x0000…0000  -> 0xe895cb46…4088  amount=100000   ← Gateway mint inside the hook
USDC.Transfer  0xe895cb46…4088  -> 0x3fa22b7a…3b34  amount=100000   ← TGH settle to PoolManager
USDC.Transfer  0x3fa22b7a…3b34  -> 0x0646ffe1…ec69  amount=100000   ← PM take to keeper
TGH event GatewayHubMintAttested        (0x920529b0…)
TGH event GatewayHubLiquidityReceived   (0x9893f54e…)
TGH event GatewayRoutedSwap             (0x0f0ffd9e…)
PoolManager event Swap                  (0x40e9cecb…) for poolId=0xf6b13fe5…7f711
```

All inside **a single transaction**. **No CCTP attestation poll. No off-chain settlement loop. Sub-block (single-tx) Gateway USDC delivery via a v4 hook.** That's the differentiator.
