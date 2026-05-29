"use client";

import { useAccount, useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { KAWAII_GATE } from "@/lib/kawaii/config";

/**
 * Inline fund panel for the gate. TESTNET: you pay USDC on Arc Testnet, so the
 * real need is "get test-USDC on Arc" (faucet). MAINNET (Avax) adds the USDC→JPYC
 * swap (−20%) + a bridge toward Avax — reusing desk-v1's AppKit swap modal +
 * TokenChip + BlockchainIcons; stubbed here behind the tier until that ships.
 */
const ERC20_BALANCE = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

// Circle's testnet faucet serves Arc Testnet USDC. Override with KAWAII_ARC_FAUCET_URL.
const ARC_FAUCET = process.env.NEXT_PUBLIC_KAWAII_ARC_FAUCET_URL || "https://faucet.circle.com/";

export function KawaiiFund() {
  const { address } = useAccount();
  const cfg = KAWAII_GATE.testnet;
  const { data: bal } = useReadContract({
    address: cfg.usdc as `0x${string}`,
    abi: ERC20_BALANCE,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: cfg.chainId,
    query: { enabled: !!address, refetchInterval: 8000 },
  });

  const usdc = bal != null ? Number(formatUnits(bal as bigint, 6)) : null;
  const price = Number(cfg.priceUsdc) / 1e6;
  const enough = usdc != null && usdc >= price;

  return (
    <div className="mt-5 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-violet-200/70">Your USDC on Arc</span>
        <span className={enough ? "text-emerald-300" : "text-violet-100"}>
          {usdc == null ? "…" : `${usdc.toFixed(2)} / ${price} needed`}
        </span>
      </div>
      {!enough && (
        <a
          href={ARC_FAUCET}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block rounded-full border border-violet-500/30 py-1.5 text-center text-xs text-violet-100 hover:bg-violet-500/10"
        >
          Get test USDC (faucet drips 20 at a time)
        </a>
      )}
      <p className="mt-2 text-[10px] text-violet-200/40">
        Going for the real one? On mainnet you can swap USDC→JPYC for −20% + bridge to Avax (coming with the mainnet tier).
      </p>
    </div>
  );
}
