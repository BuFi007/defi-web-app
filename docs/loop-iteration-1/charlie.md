# Team CHARLIE — Iteration 1

Branch: `feat/wk1n14-privacy-pools-live`. Headless audit only — `/en` blank (ALPHA).
Test EOA = KEEPER `0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69` (resolved from `$KEEPER_PRIVATE_KEY`, never echoed).

## CHARLIE.1 — Dynamic connect

- Environment id source: `NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID` (read in `apps/web/constants/Env.ts:1-7`, consumed in `apps/web/context/DynamicProviders.tsx:72`). Value present in both `.env.local` files (masked: `8f49…d709`).
- Chain whitelist contains Arc 5042002: **YES** — `apps/web/context/DynamicProviders.tsx:48-55` lists `ArcTestnet` (definition `apps/web/constants/Chains.ts:260-276`, chainId=5042002, RPC `https://rpc.testnet.arc.network`, explorer `https://testnet.arcscan.app`). Also in wagmi config `apps/web/lib/wagmi.ts:35,43`.
- Auto-switch hook: NONE. `apps/web/hooks/use-dynamic-network.ts` only **reads** `network` from Dynamic, never prompts a switch. Only `components/money-market/bento-1/card/index.tsx:50,105` (legacy Dynamic `useSwitchNetwork`) and `components/trade-island/multiplayer.tsx:700` (wagmi `useSwitchChain`) call a switch — both feature-local, no global "you're on the wrong chain" guard.
- Status: **YELLOW** — Dynamic wired correctly; missing global wrong-chain UX.

## CHARLIE.2 — Network switcher

`ArcTestnet` constant (`apps/web/constants/Chains.ts:260-276`):

| field | value | OK |
|---|---|---|
| chainId / networkId | 5042002 | YES |
| rpcUrls | `https://rpc.testnet.arc.network` | YES |
| nativeCurrency.symbol | `USDC` | YES |
| nativeCurrency.decimals | **18** | **WRONG — Arc USDC is 6dp** (verified on-chain: `decimals()=6`). MetaMask "Add Network" will register USDC as 18dp on the user's wallet. Fix to 6. |
| blockExplorerUrls | `https://testnet.arcscan.app` | YES |

Other: no mainnet/testnet drift; RPC hardcoded (no `NEXT_PUBLIC_ARC_TESTNET_RPC_URL` override — minor, OK for testnet).

## CHARLIE.3 — Asset balances

UI reads `@bufi/location/deployments` via `apps/web/components/stablecoin-balances/deployments.ts:64-69` → `useBalance` in `stablecoin-balances/index.tsx:85`. Source-of-truth `@bufi/contracts` (`packages/contracts/src/index.ts:360-368`) has MXNB/QCAD/cirBTC/AUDF on Arc — **the UI's deployments table is missing 3 of 6**.

| asset | address (Arc) | on-chain decimals | hook | balanceOf(KEEPER) | UI source ok? |
|---|---|---|---|---|---|
| USDC | `0x3600…0000` | 6 | useBalance | 7.908387 | YES |
| EURC | `0x89B5…D72a` | 6 | useBalance | 31.090414 | YES |
| MXNB | `0x836F…A461` | 6 | useBalance | 0 | **NO — missing from `packages/location/src/deployments.ts` 5042002 block; renders "Pending"** |
| QCAD | `0x23d7…825d` | 6 | useBalance | 0 | **NO — missing** |
| cirBTC | `0xf0C4…32BF` | **8** | useBalance | 0 | **NO — missing; AND default decimals fallback is 6 → off by 100× when added** |
| AUDF | `0xd2a5…456b` | 6 | useBalance | 0 | YES |

## Handoffs

- **To BRAVO**: Two address-table fixes needed in `packages/location/src/deployments.ts:63-67` — add `MXNB`/`QCAD`/`cirBTC` for chainId 5042002 (addresses above). `cirBTC` MUST be `decimals: 8`. Also `apps/web/constants/Chains.ts:269` — `ArcTestnet.nativeCurrency.decimals` should be `6`, not `18`. No private keys in these edits.
- **To ECHO**: Once `/en` renders, in `/browse` verify: (1) wallet popover shows MXNB/QCAD/cirBTC rows as non-Pending after BRAVO's fix; (2) connecting on Ethereum mainnet doesn't trigger the Dynamic mismatch overlay; (3) "Add Arc to MetaMask" registers USDC at 6dp; (4) chain-switch on cold-start has no global prompt — confirm whether a global wrong-chain banner is required for beta.
