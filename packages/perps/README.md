# @bufi/perps

Worktree owner: `feature/perps-backend-final`

## Scope

FX/stablecoin perpetuals backend domain. This package owns market metadata, EIP-712 trade intents, the quote engine, and indexer-fed position state. It does NOT own the contract — Solidity lives elsewhere.

## What to build

| File | Status | What it does |
|---|---|---|
| `src/schemas.ts` | ✅ active | Zod request/response shapes, including Phase E `SignedOrder` fields |
| `src/service.ts` | ✅ active | `PerpsService` for quotes, intent persistence, nonce/idempotency |
| `src/onchain.ts` | ✅ active | viem readers for `quoteFee`, oracle freshness, and `nonceBitmap` |
| `src/typed-data.ts` | ✅ active | Phase E `SignedOrder` EIP-712 typed data + digest |
| `src/markets.ts` | ✅ active | Configured Arc clearinghouse market IDs exposed as perps markets |
| `src/orderbook.ts` | ✅ active | Price-time priority matching with partial-fill accounting |
| `src/positions.ts` | ⬜ TODO | read Ponder, reconcile w/ contract |
| `src/liquidation.ts` | ⬜ TODO | health-factor scanner |

## Live protocol deployment

`livePerpsMarkets()` is grounded in `fx-telarana/reports/CONFIG_ARC_PHASE_B_E_PERP_MARKETS.md` and currently exposes the configured Arc clearinghouse markets:

- `EURC/USDC` - `0x565a6e2fab61800aa18813603b5b485af5bed7dea1aa0845bdaa61502063cab8`
- `tJPYC/USDC` - `0x9ccad283db415085bf69329b696bfc7a34bff2d476f5cf7b1d4a3ba9bc0b70ab`
- `tMXNB/USDC` - `0xb698dfdbcbae088741081a53b9f1da11df8ff7c92c9278b66e15a34077ea5ca3`
- `tCHFC/USDC` - `0x992a2a93cd7a43a9ca827907f708a00ef88e9757e8aadab780ec4f58b161c7dd`

Arc Phase B-E engine addresses are now live from `fx-telarana` PR 19's `deployments/perps-5042002.json`:

- `FxPerpClearinghouse` - `0x25cDf2ad4Fd446e85273c4D7C77a03F22C742865`
- `FxMarginAccount` - `0x1869D0253286dF29ce0AB8d29207772C7fD9dc35`
- `FxFundingEngine` - `0x725822e8BC6edbcBa52914149e25f2671290C6D2`
- `FxHealthChecker` - `0x9cc0D71e2Af1532e74C2Af8aE7248ACB501039d5`
- `FxLiquidationEngine` - `0x01f71c1E74350633bBC9d554ca35DA40412DCFB7`
- `FxOrderSettlement` - `0x49ad97Fa2b67252373f4683bD4a4B49AA3AF5565`

The backend also accepts that flat deployment manifest shape through `CONTRACT_ADDRESSES_JSON` and maps it into `5042002.perps.*`.

Admin configuration and live trading smoke passed on Arc on 2026-05-17:

- Market params: initial margin `500` bps, maintenance margin `300` bps, trading fee `5` bps, max leverage `200000` bps.
- Funding params: enabled, max funding rate `1` bps/second, funding velocity `1` bps.
- Liquidation params: bounty `500` bps, bounty cap `5000000`, flag delay `0`.
- Post-smoke readback: `protocolLiquidity() = 101200327`, victim position cleared, victim liquidatable `false`.
- EIP-712 domain: `TelaranaFxOrderSettlement`, version `1`, struct field `sizeDeltaE18`.
- API quote/intent requests must include `sizeDelta`, the contract-native signed `sizeDeltaE18`; `sizeUsdc` is retained as UI/read-model metadata and is not used to invent a base-size conversion.
- Matcher uses price-time priority, records `filledSizeDelta` / `remainingSizeDelta`, and marks residuals as `partially_filled`. The current settlement contract consumes the nonce on any fill, so residual quantity is recorded for re-sign/replacement rather than reusing the consumed signature.
- Replacement workflow: after the matcher settles a partial fill, it writes a durable `bufx.perps.replacement_needed` event and logs the same structured event. A wallet can read its queue at `GET /perps/replacement-needed`, then call `POST /perps/intents/:id/replacement/prepare` with a fresh nonce/deadline to get EIP-712 typed data for the exact `remainingSizeDelta`; after the trader signs it, call `POST /perps/intents/:id/replacement`. Stored replacements carry `replacementOf` and duplicate active replacements for the same residual are rejected. The web shell mounts `PerpsReplacementAgent`, which performs that poll/prepare/sign-prompt/submit loop for connected wallets.

Wire `createPerpsService()` into `apps/api/src/routes/perps.ts`.

## Definition of done

- All routes under `/perps/*` return live data (no 501s).
- `/perps/quote/premium` reads `FxPerpClearinghouse.quoteFee` when Phase B-E addresses are configured.
- `/perps/intents` verifies a Phase E `SignedOrder` EIP-712 signature and rejects local or on-chain nonce reuse.
- `/perps/liquidations/candidates` matches a contract read of every returned position.
- Tests cover: quote determinism, intent signature verify, HF math.

## Money rules

- No client-supplied price is trusted.
- Oracle freshness must be enforced (`oracle.freshness` MCP tool).
- All intents have a deadline and a nonce — both verified server-side before forwarding to the contract.
- Liveblocks is NEVER source of truth for positions.
