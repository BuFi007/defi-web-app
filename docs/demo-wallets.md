# Demo Wallets

Three actors drive the BUFI / FX Telaraña / BUFX multi-actor demo. Addresses
are stable across waves; private keys live only in `.env.local` (gitignored).

| Role   | Address                                      | Notes                                                                  |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------- |
| KEEPER | `0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69` | Hyperlane relayer, AccessControl admin, CREATE2 deployer, funding hub. |
| MAKER  | `0xa00b6D3a1C999DEc09EE1178d61EDC520c7d7AB9` | Demo perps maker / FX initiator.                                       |
| TAKER  | `0xca437B03CDb1f2BCddB49dc45e267fc7038291fD` | Demo perps counterparty / FX recipient.                                |

## Per-role funding target (every demo session)

| Chain          | Asset                | Target each (MAKER + TAKER) | Funding source                                |
| -------------- | -------------------- | --------------------------- | --------------------------------------------- |
| Fuji (43113)   | AVAX (gas)           | 0.05                        | Keeper transfer (keeper holds >> 0.15 AVAX).  |
| Fuji (43113)   | USDC (Circle)        | 1.0                         | **Faucet** — keeper rarely has enough.        |
| Arc (5042002)  | USDC (native gas)    | 1.0                         | Keeper transfer.                              |
| Arc (5042002)  | EURC                 | 0.5                         | Keeper transfer.                              |

Live audited state is in `scripts/demo-wallet-balances.json` — re-run that
script (or the cast commands below) to verify before any multi-actor demo.

## Re-funding instructions

1. Source the keeper key: `set -a; source .env.local; set +a` (must define
   `KEEPER_PRIVATE_KEY`).
2. Audit current balances via cast (see snippet in `scripts/demo-wallet-balances.json`).
3. Run `scripts/fund-demo-wallets.ts` (reproducible TS helper); it sends the
   four Arc transfers + two Fuji AVAX transfers and prints tx hashes. Pass
   `--dry` to preview.
4. For Fuji USDC, faucet manually:
   - https://faucet.circle.com → Avalanche Fuji → USDC → paste MAKER then TAKER.
5. Re-audit and update `scripts/demo-wallet-balances.json` with the new
   `auditedAt`, `balancesAfter`, and tx hashes.

## Manual funding gaps (as of Wave Wk1-N5)

- MAKER + TAKER both need **1.0 USDC on Fuji** via `https://faucet.circle.com`.
- AVAX faucet (https://faucet.avax.network/) is only needed if keeper drops below
  `0.15 AVAX` on Fuji.

## Constraints

- Never echo private keys.
- Never fund keeper here — it stays put.
- Always check the keeper's reserve before transferring; refuse to drain below
  the documented operating threshold.
