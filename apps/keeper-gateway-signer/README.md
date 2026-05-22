# `@bufi/keeper-gateway-signer`

Signs Circle Gateway `BurnIntent`s for the BUFI / FX Telaraña v4 swap pool
demo. Two modes live in this app:

1. **`src/index.ts`** — long-running rotation keeper (Wave N7c). Boots,
   reads every `attestations/*.json` artefact written by the CLI, polls
   Fuji on a 5-min cadence, and re-mints any artefact whose
   `expirationBlock - currentFuji < GATEWAY_ROTATION_BUFFER_BLOCKS` (default
   10_800 ≈ 6h). Each rotation runs the same `mintAttestation()` flow the
   CLI uses, so the persisted artefact always matches the latest live
   Circle attestation. See `## Keeper mode` below.
2. **`src/mint-attestation.ts`** — one-shot CLI that mints a real Circle
   Gateway attestation against the testnet API. **This is the Wave N2c
   deliverable** and is what produces the broadcast-ready attestation for
   `scripts/v4-swap-pool-demo-gateway.ts`. The CLI also exports
   `mintAttestation(opts)` which is what N7c's keeper calls.

## The Wave N2c flow (mint a real attestation)

```
                            +---------------------+
                            |  KEEPER_PRIVATE_KEY |
                            |   0x0646...ec69     |
                            +----------+----------+
                                       |
                                       v
   +-----------+   EIP-712    +--------+---------+   POST /v1/transfer
   | BurnIntent|----sign------>|  bun run mint   |--------> Circle Gateway
   +-----------+              |   (this CLI)    |          (testnet API)
                              +--------+---------+
                                       |
                                       | attestation, signature
                                       v
              apps/keeper-gateway-signer/attestations/<label>.json
                                       |
                                       v
                              .env.local
                              V4_SWAP_GATEWAY_ATTESTATION=0x...
                              V4_SWAP_GATEWAY_SIGNATURE=0x...
                                       |
                                       v
                  scripts/v4-swap-pool-demo-gateway.ts
                  PoolManager.swap(...) on Arc Testnet (5042002)
                  -> TelaranaGatewayHubHook.beforeSwap
                  -> CircleGatewayMinter.gatewayMint(attestation, signature)
                  -> USDC materializes atomically, no Iris poll
```

The CLI does NOT broadcast a deposit tx in the default path — it
assumes the keeper EOA already holds a non-zero unified Gateway balance
on Avalanche Fuji (`domain=1`). If the balance is short, the CLI exits
with a clear message pointing at the Fuji USDC faucet and the
`GatewayWallet.deposit(usdc, value)` call.

### Re-mint command

```bash
# from apps/keeper-gateway-signer/
bun run mint

# overrides
bun run mint -- \
  --amount 0.1 \
  --label wave-n2c-eur-usd-demo \
  --recipient 0xe895CB461AFF6E98167a7FA0Db252ba906714088 \
  --max-fee 2.01
```

Defaults:

| Flag                       | Default                                              |
|----------------------------|------------------------------------------------------|
| `--amount`                 | `0.1` USDC                                           |
| `--label`                  | `wave-n2c-eur-usd-demo`                              |
| `--recipient`              | `0xe895CB461AFF6E98167a7FA0Db252ba906714088` (Arc TelaranaGatewayHubHook per .env.local.example) |
| `--caller`                 | same as `--recipient`                                |
| `--destination-domain`     | `26` (Arc Testnet, per Circle Gateway domain table) |
| `--destination-chain-id`   | `5042002` (Arc Testnet)                             |
| `--max-fee`                | `2.01` USDC (matches the canonical max-fee from `~/.claude/skills/use-gateway/references/evm-to-evm.md`) |
| `--api-base`               | `https://gateway-api-testnet.circle.com/v1`         |

Env-var equivalents: `GATEWAY_AMOUNT_USDC`, `GATEWAY_LABEL`,
`GATEWAY_RECIPIENT`, `GATEWAY_CALLER`, `GATEWAY_DESTINATION_DOMAIN`,
`GATEWAY_DESTINATION_CHAIN_ID`, `GATEWAY_MAX_FEE_USDC`,
`GATEWAY_API_BASE`. Set any of them to skip the matching CLI flag.

To skip the unified-balance pre-check (only if you know the API call will
satisfy itself from a pending batch): `GATEWAY_SKIP_BALANCE_CHECK=1`.

### Artefact

Each mint run writes a JSON artefact at
`apps/keeper-gateway-signer/attestations/<label>.json`. Schema:

```jsonc
{
  "mintedAt":      "2026-05-21T18:50:06.163Z",
  "fuji": {
    "depositTxHash": null,          // null when burn was satisfied from a
    "depositAmount": "100000",      // pre-existing unified Gateway balance
    "depositor":     "0x0646FFe1...",
    "note":          "..."
  },
  "sourceDomain":          1,        // Fuji
  "destinationDomain":     26,       // Arc Testnet
  "destinationChain":      5042002,
  "destinationRecipient":  "0xe895CB46...",
  "destinationCaller":     "0xe895CB46...",
  "amountUsdc":            "100000", // 0.1 USDC raw
  "maxFee":                "2010000",
  "burnIntent":            { ... }, // full EIP-712 message
  "burnSignature":         "0x...",  // local EIP-712 sig
  "attestation":           "0x...",  // Circle's attestation payload
  "signature":             "0x...",  // Circle's attestation signature
  "circleResponse":        { ... },  // full /v1/transfer body
  "apiBase":               "https://gateway-api-testnet.circle.com/v1",
  "notes":                 "..."
}
```

The `attestation` + `signature` fields are what
`V4_SWAP_GATEWAY_ATTESTATION` + `V4_SWAP_GATEWAY_SIGNATURE` consume.

### Re-mint cadence (TTL)

Circle Gateway attestations are bounded by an `expirationBlock` on the
**source** chain (Fuji here). The persisted artefact records this under
`circleResponse.expirationBlock`. Fuji blocks land roughly every 2s;
24h ≈ 43_200 blocks, so an attestation minted at block N is good for
~24 hours.

Practical guidance: re-mint **at the start of each demo session** and
treat each attestation as single-use (Circle's `gatewayMint` rejects
replay). When automating, schedule a re-mint every 12h with a clean
artefact label so each run produces its own JSON file.

### Gas budget

| Step                                | Chain      | Token | Approx cost |
|-------------------------------------|------------|-------|------------|
| `GatewayWallet.deposit(usdc, value)`| Fuji       | AVAX  | ~0.0005 AVAX (one-time, only if no unified balance) |
| `USDC.approve(GatewayWallet, val)`  | Fuji       | AVAX  | ~0.0002 AVAX (one-time) |
| `POST /v1/transfer` (this CLI)      | off-chain  | -     | 0 gas; Circle charges a fee in USDC (`baseFee` + `transferFee`, e.g. 0.020005 USDC for a 0.1 USDC mint) |
| `gatewayMint(...)` on Arc           | Arc        | USDC  | ~0.005 USDC at current Arc gas prices (Arc bills USDC for gas) |

The Wave N2c artefact was minted from a pre-existing 2.78 USDC unified
balance on Fuji, so steps 1 + 2 were not exercised this run. Cumulative
balance burn for the artefact: 0.1 USDC + 0.020005 USDC fee = 0.120005
USDC.

### Safety

- `KEEPER_PRIVATE_KEY` is read from env only; never logged, never
  serialized to artefacts, never echoed in error paths.
- All network calls run under a 60s deadline + 3-attempt exponential
  backoff (the Wave N2c watchdog requirement).
- The CLI refuses to run if `--recipient` is not a 40-char hex address.
- Artefacts under `attestations/` are committed: the contents are
  public on-chain inputs (no private key material is present).

### Endpoint discrepancy note

The original Wave N2c brief specified
`POST https://gateway-api-testnet.circle.com/v1/burnIntents`. Probing
that path against the live testnet API returns
`{"success":false,"message":"Resource not found: POST /v1/burnIntents"}`.
The canonical endpoint per the Circle Gateway skill
(`~/.claude/skills/use-gateway/references/evm-to-evm.md`) is
`POST /v1/transfer` — which the CLI uses. This is the same endpoint
documented in Circle's developer portal.

## Keeper mode (Wave N7c)

The N2c CLI was a one-shot. For Hookathon demo ops + judging the
attestation needs to stay fresh — N6 (PR #101) had to re-mint by hand
because the first attestation's 24h TTL had elapsed. **N7c automates
that.**

```bash
# From the workspace root:
bun run keeper:gateway-signer

# From the app dir:
bun --cwd apps/keeper-gateway-signer dev
```

The keeper boots, reads every `attestations/*.json` file, exposes
`:9101/health`, and ticks every 5 minutes. On each tick:

1. Query Fuji's current block via viem (`getBlockNumber` against
   `getRpcUrl(43113)`).
2. For each tracked artefact, compute `remaining = expirationBlock - currentFuji`.
3. If `remaining < GATEWAY_ROTATION_BUFFER_BLOCKS` (default 10_800 ≈ 6h
   at 2s blocks), call `mintAttestation({ ...artefactFields, silentEnvBanner: true })`
   to re-mint. The CLI artefact at `attestations/<label>.json` is
   overwritten with the new attestation + signature.
4. A per-label cooldown (`GATEWAY_KEEPER_MIN_REMINT_MS`, default 1h) caps
   the maximum re-mint frequency. See "Block-clock caveat" below.

### Env

| Var                                | Default      | Purpose                                                              |
|------------------------------------|--------------|----------------------------------------------------------------------|
| `GATEWAY_KEEPER_PRIVATE_KEY`       | (falls back to `KEEPER_PRIVATE_KEY`) | Hex signer key. When unset the keeper exits 0 in dry-run mode. |
| `KEEPER_PRIVATE_KEY`               | (none)       | Used when the dedicated var above is unset. Same dual-key pattern N2b uses. |
| `GATEWAY_KEEPER_HEALTH_PORT`       | `9101`       | TCP port for the `/health` endpoint (Bun.serve).                    |
| `GATEWAY_ROTATION_BUFFER_BLOCKS`   | `10800`      | Rotate when `expirationBlock - currentFuji` drops below this.        |
| `GATEWAY_KEEPER_INTERVAL_MS`       | `300000`     | Tick cadence (5 min by default). Propagated to `KEEPER_POLL_MS`.    |
| `GATEWAY_KEEPER_MIN_REMINT_MS`     | `3600000`    | Per-label cooldown between rotations (caps fee burn if block math is off — see caveat below). |
| `CIRCLE_GATEWAY_API_URL` / `GATEWAY_API_BASE` | (testnet URL) | Override Circle's API base. The CLI also reads this. |

### Health endpoint

`GET :9101/health` returns a JSON snapshot:

```jsonc
{
  "ok": true,
  "bootAt": "2026-05-22T15:10:12.234Z",
  "signerConfigured": true,
  "lastTickAt": "2026-05-22T15:10:13.137Z",
  "lastTickError": null,
  "lastMint": "2026-05-22T15:10:13.137Z",
  "lastTxId": "b146cf70-f867-4729-b164-34057b9a021c",
  "nextRotationEta": "2026-05-22T15:10:18.170Z",
  "currentBlocks": { "fuji": "55651332" },
  "rotationBufferBlocks": "10800",
  "intervalMs": 300000,
  "attestations": [
    {
      "label": "wave-n2c-eur-usd-demo",
      "destinationDomain": 26,
      "destinationChainId": 5042002,
      "destinationRecipient": "0xe895CB461AFF6E98167a7FA0Db252ba906714088",
      "amountUsdc": "0.1",
      "expirationBlock": "43524365",
      "blocksRemaining": "-12126967",
      "dueForRotation": true,
      "mintedAt": "2026-05-22T15:08:09.007Z",
      "apiBase": "https://gateway-api-testnet.circle.com/v1"
    }
  ],
  "recentRotations": [ /* last 5 rotation log entries */ ]
}
```

`200` when healthy, `503` if the last tick errored.

### Dry-run mode

If neither `GATEWAY_KEEPER_PRIVATE_KEY` nor `KEEPER_PRIVATE_KEY` is set,
the keeper prints
`GATEWAY_KEEPER_PRIVATE_KEY not configured — dry-run mode; would rotate <N> attestations on next tick`
and exits 0. Use for CI smoke testing or when wiring the keeper into
infra before the signer key is provisioned. Production deploys MUST set
the key.

### Block-clock caveat

Smoke-testing N7c surfaced a discrepancy that's worth documenting before
anyone re-spec's the rotation logic:

* The N2c artefact stores `circleResponse.expirationBlock: "43390606"`.
* Re-minting today yields `expirationBlock: "43524365"`.
* Fuji's live RPC `getBlockNumber()` returns `~55_651_282`.

The N2c README assumed Circle's `expirationBlock` was a Fuji block number
(`24h ≈ 43_200 blocks`). The numbers don't match — Circle appears to
track its own block clock (possibly an internal attestation height or
the Avalanche P-chain), which is currently ~12M blocks behind Fuji C-chain
head. As a result the naive `expirationBlock < currentFuji + buffer`
check ALWAYS triggers on a fresh keeper boot, which would burn one
0.020005 USDC `/transfer` fee per tick forever.

`GATEWAY_KEEPER_MIN_REMINT_MS` (default 1h) is the safety belt: the
keeper refuses to re-mint the same label more than once per hour. At
default cadence that caps the worst-case burn at ~$5.76/day per label
($0.48/h × 24h × 0.020005 USDC ÷ 0.1 USDC fee), and once Circle confirms
the correct block clock the rotation buffer math becomes exact and the
cooldown is redundant.

Follow-up: query Circle's `/balances` (or whichever endpoint surfaces the
correct block reference) on each tick and compare against THAT, not
Fuji's RPC. Out of N7c scope.

### Gas budget at default cadence

| Scenario | Rotations/day | USDC burn/day |
|----------|---------------|---------------|
| Block clock matches (intended): 24h TTL, 6h buffer | ~4 | ~0.080 USDC |
| Block clock mismatches (current behaviour, capped by cooldown) | 24 | ~0.480 USDC |

Per rotation: `0.020005 USDC` Circle fee + `~0.005 USDC` Arc gas if the
attestation is consumed on-chain (the consumer pays that, not the keeper).
The keeper itself does no on-chain writes — it only POSTs to Circle.
