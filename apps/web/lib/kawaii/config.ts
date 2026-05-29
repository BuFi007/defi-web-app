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
    priceUsdc: 100_000000n, // 100 test-USDC (6 dec) — large on purpose (faucet drips 20)
    payTokens: ["USDC"] as const, // TESTNET: USDC on Arc Testnet ONLY (no JPYC on testnet)
    socialsRequired: ["discord", "telegram", "x"] as const, // all three on testnet
    leaderboardEligible: false, // testnet NFT is play-only
  },
  // mainnet (Avalanche, deploy pending): pay USDC (5) OR JPYC −20% ON AVAX MAINNET;
  // earnings → 0x5C7bd2D9147d650cA6814619D591AE4e6FCD47e3; socials = X + one of
  // {discord,telegram}; leaderboardEligible: true. JPYC on Avax = 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29 (18 dec).
} as const;

export type KawaiiTierKey = keyof typeof KAWAII_GATE;

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
