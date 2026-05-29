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
    priceUsdc: 100_000000n, // 100 test-USDC (6 dec) — large on purpose (faucet drips 20)
    jpycDiscountBps: 2000, // 20% off when paying in JPYC
    socialsRequired: ["discord", "telegram", "x"] as const, // all three on testnet
    leaderboardEligible: false, // testnet NFT is play-only
  },
  // mainnet (Avalanche): deploy pending. earnings → 0x5C7bd2D9147d650cA6814619D591AE4e6FCD47e3,
  // price 5 USDC / JPYC-20%, socials = X + one of {discord,telegram}, leaderboardEligible: true.
} as const;

export type KawaiiTierKey = keyof typeof KAWAII_GATE;
