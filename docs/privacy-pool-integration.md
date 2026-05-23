# Privacy Pool Integration

Status of the Privacy Hook v1 wiring between fx-Telaraña, the API, and
the Trade UI. Phase shipped: **read-only surface end-to-end** (addresses,
ABIs, live state). Next phase: client-side proof generation + actually
routing intents through the shielded path when Ghost Mode is on.

## What's deployed (verified live 2026-05-23)

| Surface | Arc Testnet | Avalanche Fuji |
|---|---|---|
| `FxPrivacyEntrypoint` proxy | `0xd11cddd1...0f2736` | `0x6d5e3d5b...87d3c953` |
| `FxPrivacyEntrypointImpl` | `0x4506441d...3ea79fa92a` | `0xcd04c6e2...7083c205a` |
| `FxFixedRateSwapAdapter` (v2, codex round-11 patched) | `0x3Fa1AcC8...306C27f2` | (not deployed) |
| `FxPrivacyPoolUSDC` | `0xc11c216c...51988f` | `0xc490be46...58ec7f` |
| `FxPrivacyPoolEURC` | `0x7B4582CD...242d234c` | (not deployed) |
| `WithdrawalVerifier` | `0x7f0326ce...d7bb6ee` | `0x18bd44dd...2ae64bf1` |
| `CommitmentVerifier` | `0x9056facd...d47ba8ea0` | `0x4c4e1ec5...5719ac71b` |
| `PoseidonT3` | `0x3333333C...e3B93` (PSE canonical CREATE2) | same |
| `PoseidonT4` | `0x4443338E...2ECF0` (PSE canonical CREATE2) | same |

**Arc:** shielded USDC + EURC pools with cross-currency atomic relay.
`relayCrossCurrency(USDC→EURC)` and vice versa work end-to-end at the
1.08 / 0.92 fixed-rate the adapter is seeded with.

**Fuji:** shielded USDC pool only (Option A deployment); no
cross-currency relay wired — `relayCrossCurrency` reverts
`SwapAdapterNotSet` until an adapter is configured.

## What's connected on the API side (this PR)

Three new read-only routes at `/privacy/*`:

```
GET /privacy/state?chain=arc|fuji
  → { chain, chainId, addresses, live: { latestRoot, configuredSwapAdapter } }
  Reads the live entrypoint state. Fuji's latestRoot reverts with
  0xa42a714f on the Option-A deployment (older entrypoint shape) —
  the route returns the error inline rather than 502'ing so the UI
  can render a "pool empty" placeholder.

GET /privacy/assets?chain=arc|fuji
  → { chain, chainId, assets: [{symbol, token, pool}], crossCurrencyEnabled }
  Static asset registry — what shielded pools exist on the chain.
  Arc returns USDC + EURC + crossCurrencyEnabled=true.
  Fuji returns USDC + crossCurrencyEnabled=false.

GET /privacy/pool?chain=arc&scope=<uint256>
  → { chain, chainId, scope, pool }
  Resolves a scope (per-asset namespace, derived client-side from
  asset+depth+chain) to its concrete pool address. Lets the UI lookup
  pool TVL via standard ERC-20 balanceOf without going through the
  entrypoint's internal mapping.
```

**ZERO write endpoints by design.** Shielded ops require client-side
Groth16 proofs over a user-held secret; routing them through the API
would defeat the privacy guarantee. The deposit/relay/relayCrossCurrency
calls live entirely in the user's browser via the `@bufi/fx-telarana-sdk`
`PrivacyTradeClient`. The API surfaces only the public read state the
UI needs to render the Ghost Mode panel.

## What's connected on the UI side (this PR)

Two pieces:

1. **`apps/web/lib/privacy/hooks.ts`** — React Query hooks
   `usePrivacyState(chain)`, `usePrivacyAssets(chain)`, and a
   `buildPrivacyPoolUrl()` helper. 30s refetch on state (root only
   advances on deposits), 5min staleTime on assets.

2. **`GhostModeContext.tsx`** — unchanged behavior (toggle still drives
   theme) but the comment block now clarifies that user intent
   (`isGhostMode`) and on-chain availability (`usePrivacyState`) are
   separate concerns. Consumers gate features by AND'ing both.

The existing **Ghost Mode toggle button** in the trade UI continues to
flip dark theme. The trade-routing wiring (the actual "user submits
shielded intent" path) is the next phase — see below.

## What's NOT wired yet (next phase)

The shielded trade-routing path requires:

1. **snarkjs in the browser** — Groth16 prover bundle (~600KB gzipped)
   served via Next.js dynamic import to keep the public bundle clean.
2. **`PrivacyTradeClient` adapter** — wrap the
   `@bufi/fx-telarana-sdk`'s privacy SDK in a React-friendly client
   helper that takes a viem `WalletClient` and exposes
   `deposit / relay / relayCrossCurrency` as mutations.
3. **Ghost Mode router fork in `usePlaceOrder`** — when
   `isGhostMode && privacyState.live.configuredSwapAdapter` is set,
   route the intent through `PrivacyTradeClient.relayCrossCurrency`
   instead of `/perps/intents`. Spot-FX only (perp orderbook intents
   are inherently public on the matcher).
4. **Pool TVL display** — render `balanceOf(privacy.poolUSDC)` and
   `balanceOf(privacy.poolEURC)` in the Ghost Mode side panel using
   the addresses from `usePrivacyAssets()`.

Estimate: 2-3 days of focused work once `@bufi/fx-telarana-sdk` is
published as a consumable npm/bun workspace dep. Today the SDK lives
at `~/coding-dojo/fx-telarana/packages/sdk/` and isn't yet linked into
the defi-web-app monorepo — that link is the first dependency.

## Verification commands

```bash
# Arc Privacy Hook state (latestRoot + swap adapter address)
curl -s 'http://localhost:3002/privacy/state?chain=arc' | jq .

# All shielded pools on Arc
curl -s 'http://localhost:3002/privacy/assets?chain=arc' | jq .

# Per-scope pool lookup (USDC pool scope = keccak256(asset, depth, chain))
curl -s 'http://localhost:3002/privacy/pool?chain=arc&scope=12345' | jq .
```

Live evidence (2026-05-23, against the running API on `:3002`):

```
$ curl -s 'http://localhost:3002/privacy/assets?chain=arc'
{
  "chain": "arc",
  "chainId": 5042002,
  "assets": [
    { "symbol": "USDC", "token": "0x3600...", "pool": "0xc11c216c..." },
    { "symbol": "EURC", "token": "0x89B50855...", "pool": "0x7B4582CD..." }
  ],
  "crossCurrencyEnabled": true
}
```
