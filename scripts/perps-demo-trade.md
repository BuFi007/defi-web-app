# `perps-demo-trade.ts` — Arc Testnet perp open + close demo

The hackathon demo crown-jewel script. Submits a real maker/taker matched
perp position on `FxOrderSettlement` (chain id `5042002`, Arc Testnet),
holds it for `~30s`, then closes it. Emits a JSON artifact with both tx
hashes ready for screenshot.

## What it does

1. Loads `KEEPER_PRIVATE_KEY`, `DEMO_MAKER_PRIVATE_KEY`,
   `DEMO_TAKER_PRIVATE_KEY` from repo-root `.env.local`.
2. Verifies the keeper EOA holds `SETTLER_ROLE` on
   `FxOrderSettlement` (`0x49ad97Fa2b67252373f4683bD4a4B49AA3AF5565`).
3. Probes USDC balances + already-deposited margin for both traders;
   aborts with a clear funding hint if either is under 10 USDC.
4. Idempotently approves + deposits USDC margin into `FxMarginAccount`
   (`0x1869D0253286dF29ce0AB8d29207772C7fD9dc35`).
5. Reads the live `FxOracle.getMid(base, USDC)` price for the chosen
   market (default `EURC/USDC`).
6. Both traders sign EIP-712 `SignedOrder`s (maker long, taker short)
   matching the on-chain typehash exactly — including the `maxFee`
   field that the existing `@bufi/perps` typed-data builder omits.
7. Keeper calls `FxOrderSettlement.settleMatch(...)`; script asserts
   `MatchSettled` + ≥1 `PositionIncreased` events fire.
8. Dwells `DEMO_DWELL_MS` (default 30s) so funding accrues.
9. Both traders sign reduce-only close orders against the fresh
   oracle mid; keeper submits the second `settleMatch`; script
   decodes `PositionDecreased` events and reports realized PnL.
10. Writes `scripts/perps-demo-trade.output.json` with chain IDs,
    addresses, tx hashes, explorer URLs, decoded event args.

## Setup (one-time)

### 1. Generate two demo trader wallets

```bash
cast wallet new
# → repeat twice; keep both private keys + addresses
```

Add to **`.env.local`** at the repo root:

```bash
DEMO_MAKER_PRIVATE_KEY=0x…  # trader A
DEMO_TAKER_PRIVATE_KEY=0x…  # trader B
```

`KEEPER_PRIVATE_KEY` is already present in `.env.local`.

### 2. Fund both wallets on Arc Testnet

Go to <https://faucet.circle.com>, select **Arc Testnet**, request
USDC for each demo address. ≥10 USDC each is enough for the default
1e18 (1 unit) fill size at any FX rate.

### 3. Verify the keeper EOA has `SETTLER_ROLE`

If you see a `blocked: keeper EOA … does not hold SETTLER_ROLE` error,
have a `DEFAULT_ADMIN_ROLE` holder grant it:

```bash
cast send 0x49ad97Fa2b67252373f4683bD4a4B49AA3AF5565 \
  'grantRole(bytes32,address)' \
  0x47b0d4a4f17a6cb1b66cefce5ed4ba8843e6e0a8a87b1f0a1d44d2b6b7baca31 \
  <KEEPER_ADDRESS> \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key <ADMIN_PRIVATE_KEY>
```

(`SETTLER_ROLE` = `keccak256("SETTLER_ROLE")` — computed at runtime by
the script.)

## Run

From the repo root:

```bash
bun run scripts/perps-demo-trade.ts
```

The script is re-runnable. Deposits are skipped if margin is already
satisfied, approvals are skipped if allowance is sufficient, and
nonces are fetched fresh per-run from the on-chain `nonceBitmap`.

## Env knobs

| var | default | purpose |
|---|---|---|
| `KEEPER_PRIVATE_KEY` | required | settler EOA, must hold `SETTLER_ROLE` |
| `DEMO_MAKER_PRIVATE_KEY` | required | maker trader EOA |
| `DEMO_TAKER_PRIVATE_KEY` | required | taker trader EOA |
| `ARC_TESTNET_RPC_URL` | `https://rpc.testnet.arc.network` | RPC override |
| `DEMO_MARKET_SYMBOL` | `EURC/USDC` | one of `EURC/USDC`, `tJPYC/USDC`, `tMXNB/USDC`, `tCHFC/USDC` |
| `DEMO_DWELL_MS` | `30000` | ms between open and close |
| `DEMO_FILL_SIZE_E18` | `1000000000000000000` | size in 1e18 units |

## Output

`scripts/perps-demo-trade.output.json`:

**Success:**

```json
{
  "status": "ok",
  "chain": "arc-testnet",
  "chainId": 5042002,
  "marketId": "0x565a…cab8",
  "marketSymbol": "EURC/USDC",
  "trader": { "maker": "0x…", "taker": "0x…", "settler": "0x…" },
  "deposits": [...],
  "open": {
    "tx": "0x…",
    "explorer": "https://testnet.arcscan.app/tx/0x…",
    "events": { "MatchSettled": {...}, "PositionIncreased": [...] }
  },
  "close": {
    "tx": "0x…",
    "explorer": "https://testnet.arcscan.app/tx/0x…",
    "pnlAtomic": "…",
    "events": { "MatchSettled": {...}, "PositionDecreased": [...] }
  }
}
```

**Blocked (any precondition fails):**

```json
{
  "status": "blocked",
  "reason": "…",
  "needed": ["..."],
  "hint": "…"
}
```

Exit code `2` on blocked, `1` on fatal, `0` on success.

## Known gotchas / pre-existing repo bugs surfaced

- `packages/perps/src/typed-data.ts` `SIGNED_ORDER_TYPES` is missing
  the `maxFee` field. The on-chain `FxOrderSettlement.SIGNED_ORDER_TYPEHASH`
  has 9 fields including `maxFee`. The package's hash will NOT verify
  on-chain. This script inlines a corrected `SIGNED_ORDER_TYPES`. The
  fix belongs in `@bufi/perps` and is contracts-track follow-up.
- `apps/keeper-perps-matcher/src/index.ts` already sends `maxFee: 0n`
  inside `intentToSignedOrder`, so the ABI struct is correct; only the
  EIP-712 *types* (signing surface) are wrong in `@bufi/perps`.

## What this artifact proves

- A working keeper-settled perpetual orderbook on a USDC-as-gas chain.
- Two-side EIP-712 sigs verified on-chain (no centralized matching
  trust).
- Real position lifecycle: open → dwell → close → realized PnL.
- Decoded events from `FxOrderSettlement.MatchSettled` and
  `FxPerpClearinghouse.PositionIncreased` / `PositionDecreased`.
- All on Arc Testnet (chain `5042002`), not a fork — side-by-side
  vs Synthra's public Uniswap-v3 fork.
