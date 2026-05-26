"use client";

import { useAccount } from "wagmi";
import { WalletCards } from "lucide-react";

import { truncateAddress } from "@/utils";

const shortenAddress = (address: string) => truncateAddress(address, 6);

export default function WalletModule() {
  const { address, isConnected } = useAccount();

  if (!isConnected || !address) {
    return null;
  }

  return (
    <div className="flex min-w-[180px] max-w-[240px] flex-col gap-2 rounded-md border border-black/10 bg-white/60 px-3 py-2 text-xs text-slate-800 shadow-sm backdrop-blur dark:border-white/10 dark:bg-black/30 dark:text-white">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 font-medium">
          <WalletCards className="h-3.5 w-3.5" />
          Wallet
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{shortenAddress(address)}</span>
          <span className="shrink-0 text-[10px] uppercase text-slate-500 dark:text-slate-300">
            connected
          </span>
        </div>
      </div>
    </div>
  );
}
