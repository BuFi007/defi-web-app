# Kawaii Avatar NFT — Token-Gated Beta + Gamification Plan

Status: **PLAN / pre-build**. Owner: criptopoeta. Date: 2026-05-29.

A gamified, cross-chain, ERC-1155 avatar NFT that gates the BUFX app, customizes
via trait layers, levels up with trading activity, and unlocks a VIP tier. Built
on Circle SCP (NFT) + Hyperlane (cross-chain link) + Uniswap v4 hooks (points +
perks) + Envio (leaderboard). Inspired by Tower Exchange's invite-gate UX, in
collaboration discussions with Tower (whitelist) + Uniswap v4 (hooks incubator).

## Locked decisions (round 2 — all confirmed)
- **NFT standard:** ERC-1155, on **Avalanche (hub)** + **Arc (spoke)**.
- **NFT platform:** Circle Smart Contract Platform (audited ERC-1155 template, `mintTo`, Gas Station sponsored mints). ✅
- **Cross-chain link:** Hyperlane mirror-mint (reuse existing Mailbox). ✅
- **Gate (Phase A first), built in `apps/web`:** off-chain whitelist + payment → Circle API mint. First whitelist address = **`0xcA02Be6cDBb806d4a327FC92E094D1A44EC37445`** (owner, for testing). ✅
- **Gate UI:** clone Tower's invite-only modal look (screenshots: centered card, logo, "invite-only" headline, "Checking wallet access…" spinner state, invite/mint card). **ADDITIVE ONLY — do not restyle existing UX.** The gate is a new overlay layered on top.
- **Payment:** free if whitelisted; else **5 USDC**, or **JPYC-equivalent − 20%**.
- **Swap + bridge, same view:** a small **USDC→JPYC swap on Avalanche Fuji** + a small **AppKit bridge toward Avax** — both inline in the mint view. **Ungated.** Reuse `desk-v1` swap (already on AppKit) + `TokenChip` + `BlockchainIcons`. (USDC↔JPYC math can reuse `FxFixedRateSwapAdapter` pattern.)
- **NFT REQUIRED for leaderboard + VIP.** ✅ The nanopay MCP trade path is open (no NFT); but to appear on the leaderboard / earn VIP you must hold the avatar.
- **Mint via MCP tool too** (IMPORTANT): expose avatar mint as an MCP tool so an AI agent can mint and thereby join the leaderboard. Mint surface = web UI **and** MCP.
- **Advertise the AI-MCP nanopayments gate** (Circle nanopay / `@bufi/x402`): "trade now via our AI MCP with nanopayments — no NFT needed." Surface it in/near the gate.
- **DB = the existing Prisma Postgres** (`db.prisma.io`, via `DATABASE_URL`/`POSTGRES_URL`/`PRISMA_DATABASE_URL`; `FX_BENTO_DATABASE_URL` already points there). NOT Neon (none provisioned), NOT the `bun:sqlite` `@bufi/db`. Use **Prisma ORM** (native fit → migrations + types). Whitelist + socials + mints + a Bento leaderboard mirror live here, seeded from a code file. ⚠️ No client/schema in committed code yet → Phase A sets it up. (`PONDER_SQL_URL` = separate Railway DB for the indexer; leave it.)
- **Perks:** ❌ NO loan/borrow rate perks. ✅ **VIP tier tied to account volume** → perp fee discount + cosmetics/status, via a v4 dynamic-fee hook.
- **Points/power:** trading (v4 hooks) + Bento boost → power tier → unlock trait layers + VIP. Leaderboard indexed by Envio (+ Vercel-Postgres mirror for app reads).

## NFT tiers — testnet vs mainnet (env-flagged)
A deploy flag (`NFT_MODE = testnet | mainnet+testnet`) drives which mint paths show.

| | **Testnet NFT (Arc Testnet)** | **Mainnet NFT (Avalanche real; Arc mainnet after launch)** |
|---|---|---|
| Purpose | Play / try the app | The real OG "kawaii punk" |
| Pay | **100 test-USDC** (large on purpose — faucet only drips 20 at a time, so it's a commitment signal) or JPYC −20%, **on Arc Testnet only** | **5 USDC** or JPYC −20%, paid **on Avalanche** (real) |
| Powers | Yes — but **sandbox only** (test the customization/power UX) | Yes — real |
| **Leaderboard** | ❌ **NO** — reserved for real OGs / real kawaii punks | ✅ Yes |
| Upgrade to mainnet NFT | ❌ Never. **No value after mainnet launch, no upgrade** — must pay on Avalanche for the real one | n/a (it is the real one) |
| Social requisites | **Discord + Telegram + X follow (ALL three)** | **X follow required + choose one of Discord/Telegram** (CONFIRM) |

**Messaging (must be explicit in the UI):** "This testnet avatar is for trying the app — it has no value after mainnet, won't be upgraded, and the leaderboard is reserved for real kawaii punks. Want the real one? Mint on Avalanche."

## Social-requisite gating (new)
Minting requires verified socials (off-chain, stored in Vercel Postgres per wallet):
- **Discord** — OAuth connect + guild-membership check.
- **Telegram** — bot deep-link join check.
- **X** — OAuth connect + follow check.
- Testnet ⇒ all 3 verified before mint enables. Mainnet ⇒ X + one of {Discord, Telegram}.
- Whitelist still controls *payment* (free vs pay); socials are a *separate* gate — CONFIRM whether whitelisted addresses also need socials (assume yes for testnet).

## Earnings recipient (mint payments → agent SCA, validated on-chain)
- **Testnet** mints (Arc Testnet 100 USDC / JPYC−20%) → `0xb79e4987bC58057a322cd9bcfAce4944DD6a6cc7` (agent SCA, active Arc Testnet + Fuji).
- **Mainnet** mints (Avalanche 5 USDC / JPYC−20%) → `0x5C7bd2D9147d650cA6814619D591AE4e6FCD47e3` (agent `tomas.cordero.esp`, active Avalanche).
- Both are smart-contract accounts; ERC-20 transfers to them settle normally.

## Reference repo #2 — `desk-v1` @ branch `private-multisig` (groundwork)
Path: `~/coding-dojo/desk-v1`. Lift these patterns into `apps/web`:
| Need | desk-v1 path |
|---|---|
| **DB = Supabase** (resolves the DB question) | `apps/app/src/lib/db/dashboard.ts` (`@bu/supabase/server` `createClient`) — use Supabase for whitelist + socials + Bento. (Supabase MCP available.) |
| AppKit (swap + bridge wallet) | `apps/app/src/lib/reown-config.ts`, `hooks/use-appkit.ts`, `context/WagmiSetup.tsx` (`@reown/appkit` + `@reown/appkit-adapter-wagmi`, avalanche/Fuji, `isMainnet` flag) |
| Circle modular wallet | `apps/app/src/actions-client/wallet-setup/circle-modular-public-config.ts` |
| Swap modal (quote→confirm→final) | `apps/app/src/components/modals/swap/` |
| TokenChip | `apps/app/src/components/tokenChip/index.tsx` |
| Swap quote action (Pasillo) | `apps/app/src/app/actions/swap-events.ts` (branch `feat/swap-quote-via-pasillo`) |

## Reusable code (lift from `sendero` — NFT side)
| Need | Source file | Notes |
|---|---|---|
| Pin image+manifest to IPFS | `apps/app/workflows/stamps/steps/pin-to-ipfs.ts` | `PinataSDK.upload.public.file/json` → CID; content-addressed = retry-safe |
| Art→blob→pin→mint orchestration | `apps/app/workflows/stamps/generate-stamp.ts` | adapt: compose kawaii layers instead of stamp art |
| Circle SCP mint (ERC-1155) | `packages/arc/src/identity.ts::mintStamp` + `execContract` + `waitForCircleTx` | `mintTo(address,uint256,string,uint256)`, `type(uint256).max` = new token id, Gas Station sponsored |
| Circle wallet client | `@sendero/circle/wallets` (`getCircle`) | `createContractExecutionTransaction({walletId, contractAddress, abiFunctionSignature, abiParameters})` |
| Env config | `packages/env/src/index.ts` | `PINATA_JWT`, `PINATA_GATEWAY`, Circle keys |
| Metadata serve route | `apps/app/app/agents/[kind]/[id]/metadata.json/route.ts` + `stamps/[tokenId]/` | cached IPFS-backed metadata + OG image |

Assets: `~/coding-dojo/nft-kawaii/layers/{background,base,brows,eyes,hair_front,hair_back,ears,companions,fx,jewelry,neckwear,outerwear_details,tops,head_accessories,eyeglasses,face_marks,handhelds,special}` — needs light photoshop cleanup; each folder = one trait class.

## Architecture (where logic lives)
```
            ┌──────────────────────── BUFX app (apps/web) ────────────────────────┐
            │  Gate modal (Tower-style)  →  whitelist check  →  mint flow          │
            └───────────────┬─────────────────────────────────┬───────────────────┘
                            │ (off-chain orchestration)        │
            whitelist table │                                  │ payment (USDC / JPYC -20%)
            (easy append)   ▼                                  ▼
                    ┌───────────────┐                  USDC→JPYC swap (ungated, FxFixedRate-style)
                    │  Mint service │ ── Circle API ──► Circle SCP ERC-1155 (Avalanche) ──┐
                    └───────────────┘    (Gas Station)                                    │ Hyperlane
                            │ pin layers+manifest → IPFS (Pinata)                          ▼
                            ▼                                            mirror-mint on Arc (same owner/traits)
                        IPFS CID (tokenURI)
            ───────────────────────────────────────────────────────────────────────
            Gamification:  v4 hooks (afterSwap) + Bento  →  PointsRegistry  →  Envio leaderboard
                           power tier  →  unlock trait layers + VIP tier  →  perp dynamic-fee discount
```
**Gate logic is off-chain** (Circle mints via Dev-Controlled Wallet API), so the whitelist is just an appendable store — no contract redeploy to add addresses.

## Whitelist extensibility (the "add easily over time" requirement)
- Source of truth: a **Supabase/Postgres `whitelist` table** (`address`, `source`, `added_at`, `tier`) — append rows anytime via an admin route / CLI. First row = owner.
- App reads it at gate-check time; whitelisted ⇒ free mint path.
- Optional on-chain mirror later (Merkle root, owner-updatable) if we want trustless free-mint proofs; not needed for the off-chain-mint beta.
- Seed sources: Tower Exchange top traders (via their API/list), Arc app users, Avalanche allies, manual adds.

## Phased build
**Phase A — Token-gated TESTNET beta (ship first; `NFT_MODE=testnet`):**
1. **Vercel-Postgres client + schema** (NEW — none in code yet): tables `whitelist`, `social_verifications`, `mints`, `bento_*`. Prisma (matches `PRISMA_DATABASE_URL`) or postgres-js. Seed `whitelist` from a code file (first row = owner `0xcA02…7445`).
2. Deploy Circle SCP ERC-1155 "KawaiiAvatars" on **Arc Testnet** via Console/API.
3. Layer-composition step (compose selected `nft-kawaii/layers` PNGs → avatar PNG via sharp/canvas) — adapt `generate-stamp.ts`.
4. Port `pin-to-ipfs.ts` → pin avatar PNG + ERC-1155 manifest → CID.
5. Mint service (port `mintStamp`/`execContract`) → `mintTo` via Circle API + Gas Station. Exposed as **(a) web action and (b) an MCP tool** (so AI agents can mint).
6. **Social-requisite gate** (Discord + Telegram + X OAuth/verify → Vercel DB).
7. Gate modal UI (Tower clone: invite-only card, "Checking wallet access…", mint card) — **additive overlay, no restyle**. Explicit "testnet has no value / leaderboard is for real OGs" messaging.
8. Payment: free (whitelist) | **100 test-USDC** | JPYC −20%, **Arc Testnet only**.
9. **Swap + bridge inline in the mint view** — reuse `desk-v1` (AppKit) + `TokenChip` + `BlockchainIcons`: USDC→JPYC swap on **Avax Fuji** + small bridge toward Avax. Ungated.
10. **Advertise the AI-MCP nanopay gate** in/near the modal ("trade via our AI MCP with nanopayments — no NFT needed").

**Phase A′ — mainnet path** (`NFT_MODE=mainnet+testnet`): 5 USDC / JPYC−20% on Avalanche; X + one social; the real leaderboard-eligible NFT.

**Phase B — Cross-chain link:** Hyperlane dispatch on Avalanche mint → Arc receiver mirror-mints identical token/traits to same owner; bind as one identity.

**Phase C — Points + leaderboard:** PointsRegistry (on-chain, hook-readable) updated by v4 `afterSwap` (volume) + Bento boost; Envio indexes → leaderboard; power tier unlocks trait layers.

**Phase D — VIP perks:** volume/power tier → perp **dynamic-fee discount** (OZ `BaseDynamicFee` hook reading PointsRegistry) + exclusive cosmetics/status.

## Decision 3 — VIP tier (replaces lending perks), tied to our code + GTM
We already have the substrate: v4 hooks (capture volume), Envio (leaderboard), the
dynamic-fee hook pattern. So VIP = **cumulative account volume tier** computed from
indexed hook events, surfaced as avatar power + a VIP badge, redeemed as a **perp
trading-fee discount** via the dynamic-fee hook (clean, on-chain, no Morpho changes).
**GTM angle:** VIP is the aspirational status — top-volume beta traders climb the
leaderboard, level up their avatar, and earn cheaper perps; ties the gate, the game,
and trading into one loop. Tower/Arc beta testers seed the top of the board.
**Anti-wash:** count oracle-priced notional with a fee floor, cap per-epoch, weight
by distinct counterparties — so self-trading can't farm VIP. (Detailed in Phase C.)

## Blockers — RESOLVED
- ✅ `desk-v1` located (`~/coding-dojo/desk-v1` @ `private-multisig`) — AppKit/swap/TokenChip/DB refs mapped above.
- ✅ DB = **Supabase** (desk-v1 pattern; Supabase MCP available) for whitelist + socials + Bento.
- ✅ Earnings recipients validated (agent SCAs, per env).

## All confirms RESOLVED (2026-05-29)
1. Mainnet social = **X + one of {Discord, Telegram}**. ✅
2. Whitelisted addresses **still must verify socials** (both tiers). ✅
3. Social verification = **real OAuth for each** (Discord OAuth, X OAuth, Telegram bot). ✅
4. DB = **Prisma Postgres** (`db.prisma.io`, already wired incl. a Bento URL) via Prisma ORM. **Mirror** leaderboard-relevant Bento data here; leave the `bun:sqlite` game store running. ✅
5. Earnings recipient = agent SCA per env (validated). ✅

→ **Plan is final. Ready to build Phase A.**

## Factory decision + Rare/SuperRare lessons + reserved bases (2026-05-29)
**Factory: NO (now) — Circle SCP IS our factory.** Verified: our contract is an EIP-1167 clone of the explorer-verified `TokenERC1155` impl `0xCCf28A443e35F8bD982b8E8651bE9f6caFEd4672` — i.e. Circle SCP already clones a verified impl per deploy. Avatar "bases" are token-id/metadata families inside ONE ERC-1155, not separate collections, so a custom factory adds nothing. We deploy just 2 collections (Arc + Avalanche).
- **How Rare/SuperRare do it (for reference):** `SovereignBatchMintFactory` deploys per-creator ERC-721 collections (`SovereignBatchMint` = ERC-721 + batch mint + IPFS + protocol registry); `SuperRareBazaar` runs reserve-price auctions; agent-friendly CLI (`rare deploy erc721`, `rare mint`). Their factory exists to let each *creator deploy their own separate contract* (SuperRare 2.0 "series").
- **Borrow now:** agent-driven mint (our MCP mint tool ✓), IPFS metadata + a registry (✓), EIP-2981 royalty defaults (TokenERC1155 supports it). **Defer:** the Bazaar auction house + per-creator factory.
- **Factory trigger (flip to YES later):** per-creator/per-artist *separate* avatar collections (own contract/royalties), self-serve sub-collections, or on-chain auctions.

### Reserved bases + CID-attack protection (workflow-designed)
- **Bases are a backend abstraction**; the contract has no "base" concept and `mintTo(to,tokenId,uri,amount)` takes the caller's `uri` → **reserved-base protection lives in the MINT SERVICE (the only Circle-cred holder), never on-chain/UI.**
- **Reserved** (visible, locked, non-mintable by others): `criptopoeta` (X, real wallet), `daniss` (danissblue/Behance, MOCK), `mcduck` (Jeremy Allaire/X, MOCK), `circle` (Circle team/X, MOCK). See `RESERVED_BASES` in `lib/kawaii/config.ts`. **`mock:true` bases are locked for everyone** (placeholder owner) until the real wallet is set — mint service must refuse them; replace daniss/jeremy/circle wallets when provided.
- **Mint-service rules:** reject any client `uri`/`cid`/`tokenId`/`to` (log it); validate `baseId` enum; reserved `baseId` ⇒ `caller == RESERVED_OWNER[baseId]` else 403 + mint-once; server-compute the CIDv1 `ipfs://` uri (regex-guarded, no gateway/ipns/query); always pass `type(uint256).max` sentinel; idempotency key; record `reservedTokenId/reservedCid` in the same txn.
- **Verified badge = 3-way match** (tokenId ∈ registry ∧ on-chain `uri(tokenId)` == `ipfs://reservedCid` ∧ signed attestation), server-computed. Reserved CIDs pinned to 2 services, never unpinned. Owner line links to the holder's public X/Behance claim.

### Contract verification — 4/4 PASS
EIP-1167 proxy → impl `0xCCf28A44…d4672` (live, 22.7KB); Blockscout `proxy_type:eip1167`, proxy + impl `is_verified:true` (75 ABI entries); `supportsInterface(ERC1155)`=true, `name()`="Kawaii Punks", `symbol()`="KAWAII", `contractURI()` set; admin/owner `0xa439…29f0`; `mintTo` selector `0xb03f4528` present. Only nit: not yet in Blockscout's token index (no Transfer yet) — re-check after first mint.

## Build progress
- ✅ **A.1 — Prisma + whitelist** (commit `9a999c0`): Prisma 6 on Prisma Postgres; tables `gate_whitelist`/`social_verifications`/`mints`/`bento_mirror` applied additively (migrate-diff + db-execute — avoided a `db push` that would've dropped live `fx_bento_worker_jobs`). Owner seeded as row 1. Client `apps/web/lib/prisma.ts`, seed `apps/web/prisma/seed.ts`.
- ✅ **A.2 — Circle SCP ERC-1155 on Arc Testnet**: **KawaiiPunks `0x01b6991451e8a0f45C37bb11bf5CeC1aA4D9024e`** (Circle contractId `019e74f4-40b6-74f7-99f4-f22aba89a19f`, walletId `4cbcd349-3bbe-541f-9baa-acc1fff72333`, mint authority/DCW `0xa439…29f0`, earnings → testnet agent). Deploy script `sendero/scripts/deploy-kawaii-template.ts`. Config `apps/web/lib/kawaii/config.ts`.
- ⏭ Next: A.3 art-compose + Pinata pin; A.4 mint service (web action + MCP tool); A.6 social OAuth; A.7 gate modal (Tower clone, additive); A.8 payment; A.9 swap+bridge (desk-v1 reuse); A.10 nanopay advert.

## Confirmed
- First whitelist = `0xcA02Be6cDBb806d4a327FC92E094D1A44EC37445` (owner). · Testnet 100 USDC / mainnet 5 USDC, JPYC −20%. · `apps/web`, additive-only. · Hyperlane, Circle SCP. · NFT required for leaderboard+VIP; nanopay MCP open. · Mint via MCP tool. · DB = Vercel Postgres for whitelist+Bento.
