/**
 * Reproducible funding script for the BUFI multi-actor demo wallets.
 *
 * Sends from KEEPER → MAKER + TAKER on Arc Testnet (USDC native gas + EURC)
 * and Fuji (AVAX gas). Surfaces the Fuji USDC gap that can only be closed
 * via the Circle faucet.
 *
 * Usage:
 *   tsx scripts/fund-demo-wallets.ts            # broadcast
 *   tsx scripts/fund-demo-wallets.ts --dry      # print plan only
 *
 * Requires:
 *   KEEPER_PRIVATE_KEY in env (sourced from .env.local).
 *
 * Constraints:
 *   - Never fund KEEPER itself.
 *   - Never echo the private key.
 *   - Refuse if keeper would drop below documented thresholds.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const KEEPER: Address = "0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69";
const MAKER: Address = "0xa00b6D3a1C999DEc09EE1178d61EDC520c7d7AB9";
const TAKER: Address = "0xca437B03CDb1f2BCddB49dc45e267fc7038291fD";

const ARC = {
  chainId: 5042002,
  rpc: "https://rpc.testnet.arc.network",
  usdc: "0x3600000000000000000000000000000000000000" as Address,
  eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as Address,
} as const;

const FUJI = {
  chainId: 43113,
  rpc: "https://api.avax-test.network/ext/bc/C/rpc",
  usdc: "0x5425890298aed601595a70AB815c96711a31Bc65" as Address,
} as const;

// Funding amounts (raw units).
const ARC_USDC_PER_WALLET_WEI = 10n ** 18n;        // 1.0 USDC native gas (18-dec wei representation on Arc value transfer)
const ARC_EURC_PER_WALLET_RAW = 500_000n;          // 0.5 EURC (6-dec)
const FUJI_AVAX_PER_WALLET_WEI = 50_000_000_000_000_000n; // 0.05 AVAX

// Refusal thresholds — keeper must not be drained below these.
const KEEPER_MIN_ARC_USDC_RAW = 5_000_000n;        // 5 USDC ERC-20 floor
const KEEPER_MIN_ARC_EURC_RAW = 5_000_000n;        // 5 EURC floor
const KEEPER_MIN_FUJI_AVAX_WEI = 100_000_000_000_000_000n; // 0.1 AVAX floor

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);

async function main() {
  const dry = process.argv.includes("--dry");
  const pk = (process.env.KEEPER_PRIVATE_KEY as Hex | undefined) ?? null;
  if (!pk) throw new Error("KEEPER_PRIVATE_KEY missing. Source .env.local first.");
  const account = privateKeyToAccount(pk);
  if (account.address.toLowerCase() !== KEEPER.toLowerCase()) {
    throw new Error(`KEEPER_PRIVATE_KEY derives ${account.address}, expected ${KEEPER}`);
  }

  const arcPub = createPublicClient({ transport: http(ARC.rpc) });
  const arcWallet = createWalletClient({ account, transport: http(ARC.rpc) });
  const fujiPub = createPublicClient({ transport: http(FUJI.rpc) });
  const fujiWallet = createWalletClient({ account, transport: http(FUJI.rpc) });

  // Pre-flight balance checks.
  const [keeperArcUsdc, keeperArcEurc, keeperFujiAvax, keeperFujiUsdc] = await Promise.all([
    arcPub.readContract({ address: ARC.usdc, abi: erc20, functionName: "balanceOf", args: [KEEPER] }),
    arcPub.readContract({ address: ARC.eurc, abi: erc20, functionName: "balanceOf", args: [KEEPER] }),
    fujiPub.getBalance({ address: KEEPER }),
    fujiPub.readContract({ address: FUJI.usdc, abi: erc20, functionName: "balanceOf", args: [KEEPER] }),
  ]);

  console.log("[fund-demo-wallets] keeper pre-flight:");
  console.log(`  arc usdc: ${keeperArcUsdc}`);
  console.log(`  arc eurc: ${keeperArcEurc}`);
  console.log(`  fuji avax: ${keeperFujiAvax}`);
  console.log(`  fuji usdc: ${keeperFujiUsdc}`);

  if (keeperArcUsdc < ARC_USDC_PER_WALLET_WEI * 2n + KEEPER_MIN_ARC_USDC_RAW) {
    throw new Error("Keeper Arc USDC below safety floor — refuse to drain.");
  }
  if (keeperArcEurc < ARC_EURC_PER_WALLET_RAW * 2n + KEEPER_MIN_ARC_EURC_RAW) {
    throw new Error("Keeper Arc EURC below safety floor — refuse to drain.");
  }
  if (keeperFujiAvax < FUJI_AVAX_PER_WALLET_WEI * 2n + KEEPER_MIN_FUJI_AVAX_WEI) {
    throw new Error("Keeper Fuji AVAX below safety floor — refuse to drain.");
  }

  // Fuji USDC: keeper can't possibly fund 2x1.0 from this balance.
  const fujiUsdcGap = keeperFujiUsdc < 2_000_000n;
  if (fujiUsdcGap) {
    console.warn(
      "\n[manual-gap] Keeper Fuji USDC =",
      keeperFujiUsdc.toString(),
      "raw — insufficient. MAKER + TAKER need 1.0 USDC each via https://faucet.circle.com (Fuji + USDC).",
    );
  }

  const plan: Array<{ chain: "arc" | "fuji"; asset: string; to: Address; rawAmount: bigint }> = [
    { chain: "arc", asset: "USDC (native gas)", to: MAKER, rawAmount: ARC_USDC_PER_WALLET_WEI },
    { chain: "arc", asset: "USDC (native gas)", to: TAKER, rawAmount: ARC_USDC_PER_WALLET_WEI },
    { chain: "arc", asset: "EURC", to: MAKER, rawAmount: ARC_EURC_PER_WALLET_RAW },
    { chain: "arc", asset: "EURC", to: TAKER, rawAmount: ARC_EURC_PER_WALLET_RAW },
    { chain: "fuji", asset: "AVAX (gas)", to: MAKER, rawAmount: FUJI_AVAX_PER_WALLET_WEI },
    { chain: "fuji", asset: "AVAX (gas)", to: TAKER, rawAmount: FUJI_AVAX_PER_WALLET_WEI },
  ];

  console.log("\n[plan]");
  for (const p of plan) console.log(`  ${p.chain} ${p.asset} -> ${p.to} : ${p.rawAmount}`);

  if (dry) {
    console.log("\n[dry] no broadcasts.");
    return;
  }

  const hashes: Array<{ chain: string; asset: string; to: Address; tx: Hex }> = [];
  for (const p of plan) {
    let tx: Hex;
    if (p.chain === "arc" && p.asset.startsWith("USDC")) {
      tx = await arcWallet.sendTransaction({ to: p.to, value: p.rawAmount, chain: null });
    } else if (p.chain === "arc" && p.asset === "EURC") {
      tx = await arcWallet.writeContract({
        address: ARC.eurc,
        abi: erc20,
        functionName: "transfer",
        args: [p.to, p.rawAmount],
        chain: null,
      });
    } else if (p.chain === "fuji" && p.asset.startsWith("AVAX")) {
      tx = await fujiWallet.sendTransaction({ to: p.to, value: p.rawAmount, chain: null });
    } else {
      throw new Error(`unhandled plan row ${JSON.stringify(p)}`);
    }
    hashes.push({ chain: p.chain, asset: p.asset, to: p.to, tx });
    console.log(`  ${p.chain} ${p.asset} -> ${p.to} :: ${tx}`);
  }

  console.log("\n[done] tx hashes:");
  console.log(JSON.stringify(hashes, null, 2));
  if (fujiUsdcGap) {
    console.log(
      "\n[gap] Fuji USDC was not covered by keeper. Top up via https://faucet.circle.com (Fuji + USDC) → MAKER + TAKER.",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
