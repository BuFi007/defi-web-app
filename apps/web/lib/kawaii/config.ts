/**
 * Kawaii Punks NFT gate — deployment config (single source of truth for the
 * gate UI + mint service + MCP mint tool). See docs/architecture/kawaii-nft-gate-plan.md.
 *
 * Mints go through the Circle SCP API (Dev-Controlled Wallet `mintAuthority`,
 * gas sponsored by Gas Station). Earnings (mint payments) settle to the agent
 * SCA per env. New-token-id sentinel for ERC-1155 mintTo = type(uint256).max.
 */
export const KAWAII_NEW_TOKEN_ID = (1n << 256n) - 1n; // Circle ERC-1155 "create new id" sentinel

export const KAWAII_GATE = {
  testnet: {
    chainId: 5042002, // Arc Testnet
    nft: "0x01b6991451e8a0f45C37bb11bf5CeC1aA4D9024e", // ERC-1155 (Circle SCP template clone)
    circleContractId: "019e74f4-40b6-74f7-99f4-f22aba89a19f",
    circleWalletId: "4cbcd349-3bbe-541f-9baa-acc1fff72333", // Dev-Controlled SCA
    mintAuthority: "0xa43980f1b1d437b92369e9083f989a1cc27829f0", // mints via Circle API
    earningsRecipient: "0xb79e4987bC58057a322cd9bcfAce4944DD6a6cc7", // testnet agent SCA
    usdc: "0x3600000000000000000000000000000000000000", // native gas token on Arc (6-dec ERC20)
    priceUsdc: 10_000000n, // 10 test-USDC (6 dec) — cheap to try the sandbox
    payTokens: ["USDC"] as const, // TESTNET: USDC on Arc Testnet ONLY (no JPYC on testnet)
    socialsRequired: ["x", "discord"] as const, // X-follow + Discord-join, verified via Guild.xyz (Telegram dropped)
    leaderboardEligible: false, // testnet NFT is play-only
  },
  // mainnet (Avalanche, deploy pending): pay USDC (5) OR JPYC −30% ON AVAX MAINNET.
  // We do NOT seed JPYC liquidity — users source JPYC via 1inch (jpycSwapUrl).
  mainnet: {
    chainId: 43114, // Avalanche C-Chain
    earningsRecipient: "0x5C7bd2D9147d650cA6814619D591AE4e6FCD47e3", // mainnet agent SCA
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", // native USDC on Avax (6 dec)
    jpyc: "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29", // JPYC on Avax (18 dec)
    priceUsdc: 5_000000n, // 5 USDC (6 dec)
    jpycDiscountBps: 3000n, // pay in JPYC → 30% off
    payTokens: ["USDC", "JPYC"] as const, // mainnet: USDC OR JPYC on Avax
    socialsRequired: ["x"] as const, // X + one (enforced server-side)
    leaderboardEligible: true,
    // 1inch deep link, Avalanche, USDC → JPYC (no liquidity to seed on our side).
    jpycSwapUrl:
      "https://app.1inch.io/#/43114/simple/swap/0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E/0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29",
  },
} as const;

/** JPYC mint price (USDC-equivalent) after the mainnet JPYC discount, for display. */
export function jpycDiscountedUsdc(): number {
  const m = KAWAII_GATE.mainnet;
  const after = (m.priceUsdc * (10000n - m.jpycDiscountBps)) / 10000n;
  return Number(after) / 1e6;
}

export type KawaiiTierKey = keyof typeof KAWAII_GATE;

/** Guild.xyz (free social-verification oracle) — client-safe constants. The SDK
 *  + access logic live in lib/kawaii/guild.ts (server-only). */
export const KAWAII_GUILD_URLNAME = "kawaii-punks";
export const KAWAII_GUILD_UUID = "4e68f0c7-de00-4980-84a4-07dbb4565078";

/**
 * Avatar bases = a BACKEND abstraction (token-id family / metadata template)
 * within the single ERC-1155 — NOT separate contracts, so no factory needed
 * (Circle SCP is already a managed EIP-1167 clone factory; impl below).
 * Reserved bases are visible in the picker but NOT mintable by others:
 * enforced in the MINT SERVICE (403), never only the UI. Owner line is shown
 * from this registry keyed by tokenId; CID/uri is ALWAYS server-computed.
 */
export const KAWAII_IMPL = "0xCCf28A443e35F8bD982b8E8651bE9f6caFEd4672"; // verified TokenERC1155 impl the clone delegates to

// MOCK owner wallets are obvious placeholders — a base with `mock: true` is
// LOCKED for everyone (no one controls these keys) until the real wallet is set.
// The mint service must refuse any mint of a base where `mock === true`.
export const RESERVED_BASES = {
  criptopoeta: { display: "criptopoeta", platform: "x", claimUrl: "https://x.com/criptopoeta", ownerWallet: "0xcA02Be6cDBb806d4a327FC92E094D1A44EC37445", mock: false },
  daniss: { display: "danissblue", platform: "behance", claimUrl: "https://www.behance.net/danissblue", ownerWallet: "0x000000000000000000000000000000000000dA11", mock: true },
  mcduck: { display: "Jeremy Allaire", platform: "x", claimUrl: "https://x.com/jerallaire", ownerWallet: "0x000000000000000000000000000000000000D0c0", mock: true },
  circle: { display: "Circle", platform: "x", claimUrl: "https://x.com/circle", ownerWallet: "0x0000000000000000000000000000000000C1ac1e", mock: true },
} as const;

export const RESERVED_BASE_IDS = Object.keys(RESERVED_BASES) as Array<keyof typeof RESERVED_BASES>;

/** All mints: server computes the uri; reject any client uri/cid/tokenId/to. CIDv1 ipfs:// only. */
export const KAWAII_URI_REGEX = /^ipfs:\/\/baf[a-z2-7]{20,}$/; // CIDv1 base32 (Pinata default), lowercase a-z + 2-7

/**
 * Layered trait customization — the "sim animator" wardrobe. Each cosmetic layer
 * category (z-order in lib/kawaii/layers.ts LAYER_ORDER) unlocks at a POWER
 * threshold. Power = earned by trading (leaderboard/volume); a fresh wallet has
 * 0 power, so everything past the base is LOCKED until you mint + trade. Two
 * hard gates, enforced in the UI AND honored server-side when traits compose:
 *   1. no avatar (unminted) → all traits locked ("mint your base first")
 *   2. power < tier.power   → that category locked ("earn N power")
 * `base`/`background` are not in here: base is the mint choice, background is free.
 */
export const KAWAII_TRAIT_TIERS: Record<string, { label: string; emoji: string; power: number }> = {
  eyes: { label: "Eyes", emoji: "👀", power: 100 },
  brows: { label: "Brows", emoji: "✏️", power: 100 },
  face_marks: { label: "Face marks", emoji: "💮", power: 150 },
  ears: { label: "Ears", emoji: "👂", power: 200 },
  hair_back: { label: "Hair (back)", emoji: "💇", power: 250 },
  hair_front: { label: "Hair", emoji: "💇", power: 250 },
  tops: { label: "Tops", emoji: "👕", power: 300 },
  neckwear: { label: "Neckwear", emoji: "🧣", power: 350 },
  outerwear_details: { label: "Outerwear", emoji: "🧥", power: 400 },
  eyeglasses: { label: "Eyewear", emoji: "🕶️", power: 500 },
  head_accessories: { label: "Headwear", emoji: "👑", power: 600 },
  jewelry: { label: "Jewelry", emoji: "💎", power: 750 },
  handhelds: { label: "Handhelds", emoji: "🎮", power: 900 },
  companions: { label: "Companions", emoji: "🐣", power: 1200 },
  special: { label: "Special", emoji: "✨", power: 1500 },
  fx: { label: "FX", emoji: "🌟", power: 2000 },
};

/** Ordered category keys for the wardrobe panel (cheapest power first). */
export const KAWAII_TRAIT_ORDER = Object.keys(KAWAII_TRAIT_TIERS);

/**
 * Bottom → top compositing z-order for the avatar stack. Lives here (node-free)
 * so both the server compositor (lib/kawaii/layers.ts, lib/kawaii/compose.ts)
 * AND the client gate can sort selected layers without pulling in `node:fs`.
 */
export const KAWAII_LAYER_ORDER = [
  "background",
  "hair_back",
  "base",
  "ears",
  "outerwear_details",
  "tops",
  "neckwear",
  "face_marks",
  "eyes",
  "brows",
  "eyeglasses",
  "hair_front",
  "head_accessories",
  "jewelry",
  "handhelds",
  "companions",
  "special",
  "fx",
] as const;
