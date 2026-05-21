# `@bufi/keeper-gateway-signer`

Signs Circle Gateway `BurnIntent`s for the BUFI / FX Telaraña v4 swap pool
demo. Two modes live in this app:

1. **`src/index.ts`** — long-running keeper stub. Wakes on a fixed
   `KEEPER_POLL_MS` cadence, logs the boot config once, and stays silent.
   This is the placeholder for the future
   `LockedForRemote → Circle /transfer → gatewayMint` relay loop.
2. **`src/mint-attestation.ts`** — one-shot CLI that mints a real Circle
   Gateway attestation against the testnet API. **This is the Wave N2c
   deliverable** and the only path currently wired up to produce a
   broadcast-ready attestation for `scripts/v4-swap-pool-demo-gateway.ts`.

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
