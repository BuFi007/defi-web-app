# @bufi/keeper-telarana-liquidator

Long-running keeper that liquidates unhealthy Telaraña money-market positions.

## What it does

Each tick:

1. Pulls liquidation candidates from `GET ${TELARANA_API_URL}/telarana/liquidations/candidates`.
2. Re-reads each candidate's health factor directly via the Telaraña SDK (`getAccountPosition`) — race protection against fresh oracle ticks.
3. Calls `FxLiquidator.liquidate(...)` for every position whose health factor is still strictly below 1.0 (1e18).
4. Logs a single structured `telarana_liquidator.tick` event per loop iteration.

Mirrors the runtime + bootstrap shape of `@bufi/keeper-perps-liquidator`.

## Env vars

| Name | Required | Default | Notes |
| --- | --- | --- | --- |
| `KEEPER_PRIVATE_KEY` | yes | — | Liquidator EOA, 0x-prefixed 32-byte hex. Must hold the loan token + approval to `FxLiquidator`. |
| `TELARANA_API_URL` | no | `http://localhost:3001` | Base URL for the apps/api candidate source. |
| `TELARANA_CHAIN_ID` | no | `43113` (Fuji) | `43113` or `5042002` (Arc). Pins the chain the keeper liquidates on. |
| `LIQUIDATOR_INTERVAL_MS` | no | `30000` | Sleep between ticks. Matches the perps keeper cadence. |
| `LIQUIDATOR_DRY_RUN` | no | `false` | If `true`, logs candidates but never submits a tx. |
| `KEEPER_POLL_MS` | no | `5000` | Runtime loop floor — kept short; per-tick sleep dominates. |
| `PORT` | no | — | If set, exposes `/health` for liveness probes. |
| `PONDER_RPC_URL_AVAX_FUJI` / `PONDER_RPC_URL_ARC_TESTNET` | no | public defaults | RPC override for the target chain. |

## Run

```bash
bun run --filter ./apps/keeper-telarana-liquidator dev
# or
bun run --filter ./apps/keeper-telarana-liquidator start
```

## Deployment

Needs a long-running container (no cron — the loop is in-process). Suggested host: Railway, Fly.io, or any always-on worker dyno. Provision `KEEPER_PRIVATE_KEY` as a secret, set `PORT` so `/health` can back a liveness probe, and pre-fund the liquidator EOA with the loan token plus an unlimited approval to the `FxLiquidator` contract for that chain.
