# keeper-pyth — Pyth EUR/USD keep-warm on Arc Testnet

Long-running Bun process that pushes fresh Pyth price updates to the Arc
Testnet Pyth contract so `FxOracle.getMid(USDC, EURC)` never reverts
`StalePrice()` (`0x19abf40e`).

## Why

`FxSwapHook.beforeSwap` calls `FxOracle.getMid` directly. The oracle
computes USDC↔EURC as a cross-rate of (USDC/USD * USD/EUR), so BOTH the
USDC/USD and EUR/USD Pyth feeds must be fresh within `maxOracleAge` or
swaps revert before consuming reserves. This keeper keeps both warm on
a 30s schedule.

## Run

```bash
# From repo root:
bun keeper:pyth

# Or directly:
bun --cwd apps/keeper-pyth dev
```

Health: `GET http://localhost:9100/health` →
```
{ ok, lastUpdate, lastTxHash, eurUsdPrice, totalUpdates, totalGasUsdcWei }
```

## Env

| Var | Default | Purpose |
| --- | --- | --- |
| `PYTH_KEEPER_PRIVATE_KEY` | _(falls back to `KEEPER_PRIVATE_KEY`)_ | Funded Arc Testnet EOA that signs `updatePriceFeeds` txs |
| `PYTH_HERMES_WS_URL` | `wss://hermes.pyth.network/ws` | Pyth Hermes WS endpoint |
| `PYTH_ARC_CONTRACT` | `0x2880aB155794e7179c9eE2e38200202908C17B43` | IPyth proxy on Arc Testnet |
| `PYTH_FEED_IDS` | `<eurUsd>,<usdUsdc>` | CSV of 32-byte Pyth feed ids |
| `PYTH_KEEP_WARM_INTERVAL_MS` | `30000` | Minimum push cadence (ms) |
| `PYTH_KEEPER_HEALTH_PORT` | `9100` | HTTP port for `/health` |

Without a private key the keeper enters dry-run mode: it connects to
Hermes WS, prints one tick, and exits cleanly so CI can verify wiring.

## Cost

Arc Testnet native gas IS USDC. Per update: ~221k gas + 1 wei Pyth fee
per feed. At 1 nwei effective gas price that's ~$4.4 µUSDC per push;
at 30s cadence ~$13 mUSDC/day. The `pyth.update_pushed` log emits the
exact `gasUsed`, `gasCostWei`, and `totalCostWei` for each push so the
real burn rate can be tracked from logs.
