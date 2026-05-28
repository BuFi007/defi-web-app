# FxSpotExecutor Redeploy + Route Migration Plan

> Wires the live spot stack to the multi-DEX `LiquidityRouter`. The deployed
> `FxSpotExecutor` predates the router refactor and is **not upgradeable**, so
> this is a redeploy + re-wire, not a setter call. Routes get registered in the
> same pass since nothing consumes them until the new executor is live.

## Why this is needed

The refactor in commit `582ec9a` added `setLiquidityRouter()` + a router-routed
path to `executeSpotFx`. But the deployed contract at
`0x4e7372108529C0e7cb3aa0fF92B1c52e06e9e72f` is pre-refactor bytecode —
`liquidityRouter()` reverts on it. FxSpotExecutor is a plain (non-proxy)
contract, so the only way to ship the new logic is a fresh deploy + migrate
every reference.

## Current live addresses (Arc 5042002)

| Thing | Address |
|-------|---------|
| FxSpotExecutor (OLD, pre-refactor) | `0x4e7372108529C0e7cb3aa0fF92B1c52e06e9e72f` |
| LiquidityRouter (live) | `0x50737c2fDf26e0Ba2cEd6855D4A1e2E2a9EAaB28` |
| PoolRegistry (live) | `0x05B71cA260EC64925CB961fbf85F2a8944F77103` |
| AssetRegistry (live) | `0x7618dfa920b6416b9924fafbf5aa56a6fe978efc` |
| TurboFeeVault | `0x929e222CBbC154f8e75a8DEF951288886Df70531` |
| TelaranaGatewayHubHook | `0x74E894aFf25c89d707873347cd2554d30E0541fa` |
| FxOracle (perps/spot) | `0x77b3A3B420dB98B01085b8C46a753Ed9879e2865` |
| USDC (Arc precompile) | `0x3600000000000000000000000000000000000000` |
| v4 PoolManager (hedge) | `0x403Aa1347a77195FB4dEddc362758AA9e0a48D2E` |

## ⚠️ Nonce contention warning

The deployer `0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69` (KEEPER) is shared with
the **liquidity-seeding session**. During seeding it fires ~1 tx / 5-6s on Arc,
which causes `nonce too low` failures on multi-tx forge scripts. Before running
this migration:

```bash
ARC_RPC="$ARC_RPC_URL"  # paid dRPC from .env.local
DEPLOYER=0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69
N1=$(cast nonce $DEPLOYER --rpc-url $ARC_RPC); sleep 6
N2=$(cast nonce $DEPLOYER --rpc-url $ARC_RPC)
[ "$N1" = "$N2" ] && echo "SAFE — KEEPER idle" || echo "BLOCKED — seeding active, wait"
```

If contended: either (a) pause the seeding session, or (b) run each step as a
single `cast send` with `--async` and re-fetch the pending nonce per tx. Do NOT
run a multi-tx forge broadcast against a busy KEEPER nonce.

## What references the OLD executor (the migration surface)

| Reference | Location | Action |
|-----------|----------|--------|
| `spotRoutesDestinationHub` | TelaranaGatewayHubHook on-chain | Re-point spot routes to NEW executor |
| `FEE_DEPOSITOR_ROLE` | TurboFeeVault on-chain | Grant to NEW executor, revoke from OLD |
| `EXECUTOR_ROLE` | OLD executor on-chain | Grant on NEW executor to keeper/matcher signer |
| `fxSpotExecutor` | `packages/contracts/src/index.ts:383` | Update address |
| FxSpotExecutor address | `services/envio-yield/config.yaml:309` | Update + re-deploy indexer |
| `FxSpotExecutor` | `deployments/turbo-fee-vault-5042002.json:3` | Update manifest |
| spot route IDs | `packages/contracts/src/index.ts` SPOT_FX_ROUTES | Verify still valid (route IDs are TGH-side, unchanged) |

## Migration sequence

### Step 0 — Pre-flight

```bash
cd ~/coding-dojo/fx-telarana/contracts
source ~/coding-dojo/defi-web-app/.env.local
forge build                       # must be clean
forge test --match-path "test/FxSpotExecutor*"   # must pass (refactor tests)
# Run the nonce-contention check above. Proceed only if SAFE.
```

### Step 1 — Deploy new FxSpotExecutor

Constructor args (from `src/spot/FxSpotExecutor.sol:206`):
`(usdc, oracle, tghAddress, initialAdmin, initialDefaultSpreadBps)`

```bash
forge create src/spot/FxSpotExecutor.sol:FxSpotExecutor \
  --rpc-url "$ARC_RPC_URL" --private-key "$KEEPER_PRIVATE_KEY" --broadcast \
  --constructor-args \
    0x3600000000000000000000000000000000000000 \
    0x77b3A3B420dB98B01085b8C46a753Ed9879e2865 \
    0x74E894aFf25c89d707873347cd2554d30E0541fa \
    0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69 \
    5
```

`initialDefaultSpreadBps=5` matches the current 5bps spot fee. Save the new
address as `$NEW_SPOT`.

### Step 2 — Wire the new executor's dependencies

```bash
# a) Point it at the live LiquidityRouter
cast send $NEW_SPOT "setLiquidityRouter(address)" \
  0x50737c2fDf26e0Ba2cEd6855D4A1e2E2a9EAaB28 \
  --rpc-url "$ARC_RPC_URL" --private-key "$KEEPER_PRIVATE_KEY"

# b) Point it at the TurboFeeVault (so spot fees route to the vault)
cast send $NEW_SPOT "setFeeVault(address)" \
  0x929e222CBbC154f8e75a8DEF951288886Df70531 \
  --rpc-url "$ARC_RPC_URL" --private-key "$KEEPER_PRIVATE_KEY"

# c) Grant EXECUTOR_ROLE to the matcher/keeper signer that calls executeSpotFx
#    EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE")
EXECUTOR_ROLE=$(cast keccak "EXECUTOR_ROLE")
cast send $NEW_SPOT "grantRole(bytes32,address)" $EXECUTOR_ROLE \
  <MATCHER_SIGNER_ADDRESS> \
  --rpc-url "$ARC_RPC_URL" --private-key "$KEEPER_PRIVATE_KEY"
```

### Step 3 — Grant the new executor FEE_DEPOSITOR_ROLE on TurboFeeVault

```bash
FEE_DEPOSITOR_ROLE=$(cast keccak "FEE_DEPOSITOR_ROLE")
cast send 0x929e222CBbC154f8e75a8DEF951288886Df70531 \
  "grantRole(bytes32,address)" $FEE_DEPOSITOR_ROLE $NEW_SPOT \
  --rpc-url "$ARC_RPC_URL" --private-key "$KEEPER_PRIVATE_KEY"
# (Optionally revoke from OLD executor after cutover is confirmed.)
```

### Step 4 — Re-point TelaranaGatewayHubHook spot routes to the new executor

The TGH delivers USDC to the spot `destinationHub` then the executor settles.
Re-point each spot route (EURC, JPYC, MXNB, CHFC) to `$NEW_SPOT`. The exact
setter is the one used in the original `spotRouteRepointTxHashes` migration
(see `deployments/turbo-fee-vault-5042002.json`). Use the same script with the
new hub address:

```bash
# Pattern — repoint each route's destinationHub
cast send 0x74E894aFf25c89d707873347cd2554d30E0541fa \
  "setSpotRouteDestinationHub(bytes32,address)" <routeId> $NEW_SPOT \
  --rpc-url "$ARC_RPC_URL" --private-key "$KEEPER_PRIVATE_KEY"
# Repeat for fujiToArcSpotFxEurc / Jpyc / Mxnb / Chfc route IDs.
```

(Confirm the exact function name against the TGH ABI — the original repoint used
the same setter; reuse it.)

### Step 5 — Register PoolRegistry routes (the actual point of all this)

`addRoute(tokenIn, tokenOut, Route)` where Route =
`(venue, pool, poolKey, targetChainId, spreadBps, enabled, preferred)`.
Venue `0` = SelfLP_V4.

```bash
POOL_REGISTRY=0x05B71cA260EC64925CB961fbf85F2a8944F77103
USDC=0x3600000000000000000000000000000000000000

# JPYC/USDC → self-LP'd v4 pool
cast send $POOL_REGISTRY \
  "addRoute(address,address,(uint8,address,bytes32,uint256,uint16,bool,bool))" \
  $USDC 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29 \
  "(0,0x403Aa1347a77195FB4dEddc362758AA9e0a48D2E,0xd19440c05e5c0d9549187e01162e8aeab29c196c3177cde6360db740b8aa3504,0,30,true,true)" \
  --rpc-url "$ARC_RPC_URL" --private-key "$KEEPER_PRIVATE_KEY"

# cirBTC/USDC → self-LP'd v4 pool
cast send $POOL_REGISTRY \
  "addRoute(address,address,(uint8,address,bytes32,uint256,uint16,bool,bool))" \
  $USDC 0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF \
  "(0,0x403Aa1347a77195FB4dEddc362758AA9e0a48D2E,0x33e42e1b20e3ea50b925963b583a033a8b959f53ffe76fb18cb97a6c6a171a8d,0,30,true,true)" \
  --rpc-url "$ARC_RPC_URL" --private-key "$KEEPER_PRIVATE_KEY"
```

**Note:** PoolRegistry ROUTE_ADMIN is KEEPER. These addRoute txs need the KEEPER
nonce — same contention caveat as above.

EURC/MXNB/AUDF/QCAD have no v4 pool yet → leave unregistered until those pools
are deployed + LP'd (separate task). The router reverts cleanly (`PairNotFound`)
for unregistered pairs, so the executor's inventory fallback still serves them.

### Step 6 — Update app + indexer references

| File | Change |
|------|--------|
| `packages/contracts/src/index.ts:383` | `fxSpotExecutor: "$NEW_SPOT"` |
| `services/envio-yield/config.yaml:309` | FxSpotExecutor address → `$NEW_SPOT`, set `start_block` to deploy block |
| `deployments/turbo-fee-vault-5042002.json` | `FxSpotExecutor` + `spotRoutesDestinationHub` → `$NEW_SPOT` |
| `deployments/registry-stack-5042002.json` | add `fxSpotExecutor` field |

Then re-deploy the Envio indexer (push to `envio` branch) so it indexes the new
executor's `SpotFxExecuted` + `SpotFeeRouted` events.

### Step 7 — Verify

```bash
# New executor knows its router + vault
cast call $NEW_SPOT "liquidityRouter()(address)" --rpc-url "$ARC_RPC_URL"   # → 0x50737c...
cast call $NEW_SPOT "feeVault()(address)" --rpc-url "$ARC_RPC_URL"          # → 0x929e22...

# Vault recognizes new executor as depositor
FEE_DEPOSITOR_ROLE=$(cast keccak "FEE_DEPOSITOR_ROLE")
cast call 0x929e222CBbC154f8e75a8DEF951288886Df70531 \
  "hasRole(bytes32,address)(bool)" $FEE_DEPOSITOR_ROLE $NEW_SPOT --rpc-url "$ARC_RPC_URL"  # → true

# Router resolves a registered route
cast call $POOL_REGISTRY \
  "bestRoute(address,address)((uint8,address,bytes32,uint256,uint16,bool,bool))" \
  $USDC 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29 --rpc-url "$ARC_RPC_URL"  # → JPYC route

# End-to-end: a small spot buy of JPYC routes through the v4 pool (needs pool LP'd)
```

### Step 8 — Cutover + cleanup

- Restart the matcher's spot_executor module pointing at `$NEW_SPOT` (env
  `FX_SPOT_EXECUTOR_ADDRESS` or equivalent in `services/matcher` config).
- After confirming the new executor settles a real spot trade, revoke
  `FEE_DEPOSITOR_ROLE` from the OLD executor on TurboFeeVault.
- Commit all manifest + config changes. Push. Merge to `envio` branch.

## Rollback

The OLD executor stays fully functional throughout — it still holds inventory
and its routes work. If the new executor misbehaves:
1. Re-point TGH spot routes back to `0x4e7372...`.
2. Restart matcher pointing at OLD executor.
3. No funds at risk: the new executor holds nothing until traffic flows.

## Dependencies / ordering vs other work

- **Liquidity seeding must free the KEEPER nonce** before Steps 2-5 (KEEPER-sent).
  Steps 1 (forge create) can run from a non-KEEPER funded key if needed, but the
  role grants in Steps 2-3 must come from a DEFAULT_ADMIN holder — and for
  consistency that's KEEPER.
- **v4 pool LP** for EURC/MXNB/AUDF/QCAD is a prerequisite for registering their
  routes (Step 5 covers only JPYC + cirBTC which already have pools).
- This migration is **independent of the FxHedgeSubscription** work — that's a
  new contract, not a change to the executor.

## Checklist

- [ ] Pre-flight: build clean, tests pass, KEEPER nonce idle
- [ ] Deploy new FxSpotExecutor (`$NEW_SPOT`)
- [ ] `setLiquidityRouter` on new executor
- [ ] `setFeeVault` on new executor
- [ ] Grant `EXECUTOR_ROLE` to matcher signer on new executor
- [ ] Grant `FEE_DEPOSITOR_ROLE` to new executor on TurboFeeVault
- [ ] Re-point TGH spot routes (EURC/JPYC/MXNB/CHFC) to new executor
- [ ] Register PoolRegistry routes (JPYC + cirBTC)
- [ ] Update `index.ts` + Envio config + manifests
- [ ] Re-deploy Envio indexer
- [ ] Verify all reads
- [ ] Restart matcher spot module at new executor
- [ ] Confirm a real spot trade settles via router
- [ ] Revoke `FEE_DEPOSITOR_ROLE` from old executor
- [ ] Commit + push all repos
