# Operator runbook — raise OI caps for live dogfood

The four live Arc sprint-1 perp markets are deployed in **ultra-safe
config**: max open interest of 250-1000 USDC per side. That's enough
to verify settlement plumbing but trips `OiCapBreach` on anything but
the smallest test intent. Raising the caps is a one-call-per-market
admin operation against `FxPerpClearinghouse.configureMarket`.

**Caller role required:** `DEFAULT_ADMIN_ROLE`.
**Today's admin:** `0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69`
(deployer). Confirm before invoking.

## Current state (on-chain, verified 2026-05-23)

| Market | marketId | current `maxOpenInterestUsd` (6-dec) | Human |
|---|---|---|---|
| EURC/USDC | `0x565a6e2f...` | `1_000_000_000` | 1,000 USDC |
| TJPYC/USDC | `0x9ccad283...` | `500_000_000` | 500 USDC |
| TMXNB/USDC | `0xb698dfdb...` | `500_000_000` | 500 USDC |
| CIRBTC/USDC | `0x238aacf1...` | `250_000_000` | 250 USDC |

## Recommended sprint-2 caps (for live dogfood)

Choose based on insurance-fund headroom + max single-trader exposure:

| Tier | maxOpenInterestUsd (6-dec) | Human | Notes |
|---|---|---|---|
| **Generous test** | `1_000_000_000_000` | 1,000,000 USDC | Recommended for live dogfood. 1k× current. |
| Conservative | `100_000_000_000` | 100,000 USDC | If insurance fund is thin. |
| Production | `10_000_000_000_000` | 10,000,000 USDC | Mirror Hyperliquid HLP per-market sizing. |

Same value for `maxSkewUsd` keeps the long/short imbalance gate
proportional.

## The call

`FxPerpClearinghouse.configureMarket(bytes32 marketId, MarketConfig calldata config)`
requires you to pass the FULL `MarketConfig` struct, not just the new
cap. The struct shape is:

```solidity
// IFxPerpClearinghouse.sol:5
struct MarketConfig {
    address baseToken;
    bool    enabled;
    uint16  initialMarginBps;
    uint16  maintenanceMarginBps;
    uint16  tradingFeeBps;
    uint32  maxLeverageBps;
    uint256 maxOpenInterestUsd;  // <-- the field you want to raise
    uint256 maxSkewUsd;
}
```

### Raise EURC/USDC to 1M USDC (cast example)

```bash
DEPLOYER=$KEEPER_PRIVATE_KEY  # from .env.local
RPC=https://rpc.testnet.arc.network
CLEARING=0x39dc43E2133CF860c1d17d4DB75Ef4204eebD46A

# Pull the existing config so we only mutate the caps
EURC_MID=0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8
CFG=$(cast call $CLEARING "marketConfig(bytes32)((address,bool,uint16,uint16,uint16,uint32,uint256,uint256))" $EURC_MID --rpc-url $RPC)
echo "Current EURC config: $CFG"

# Parse the tuple — example assumes current is
# (0x89B50855..., true, 500, 300, 5, 200000, 1000000000, 1000000000)
# Replace last two fields with 1_000_000_000_000:
cast send $CLEARING \
  "configureMarket(bytes32,(address,bool,uint16,uint16,uint16,uint32,uint256,uint256))" \
  $EURC_MID \
  '(0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a,true,500,300,5,200000,1000000000000,1000000000000)' \
  --private-key $DEPLOYER \
  --rpc-url $RPC
```

### Repeat for the other three markets

| Market | baseToken | marketId |
|---|---|---|
| TJPYC | `0xB176f6E0c8ecc2be208F72Ad34c54e5F10F1882a` | `0x9ccad283...` |
| TMXNB | `0xe8F76f90553F50E76731afbeF1ac83a9152fFBEb` | `0xb698dfdb...` |
| CIRBTC | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` | `0x238aacf1...` |

Each call costs ~0.001 USDC native gas. Total < 0.01 USDC for all four.

## Verify after each call

```bash
cast call $CLEARING "maxOpenInterest(bytes32)(uint256)" $EURC_MID --rpc-url $RPC
# Expected: 1000000000000  (= 1M USDC quantums)
```

## Matcher behaviour after the raise

Once the cap is `1_000_000_000_000` quantums (1M USDC), the LP gate
`invariant 1` accepts any single fill whose notional (after the gate's
`base_wad_to_usdc_e6` conversion) plus current OI fits under the cap.

The unit-mismatch fix in commit `fix(matcher): LP gate OI unit
mismatch` (Step 3.7) is what makes the math correct — without it,
even a 1-trillion-USDC cap would still trip on small intents because
the gate was comparing 6-dec USDC quantums against 18-dec base WAD.

## Rollback

`configureMarket` is overwrite-in-place; re-running with the old
values restores the original ultra-safe config. No upgrade hook needed.
