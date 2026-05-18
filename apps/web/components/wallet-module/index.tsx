"use client";

import { useMemo, useState } from "react";
import { useEmbeddedWallet, useUserWallets } from "@dynamic-labs/sdk-react-core";
import { WalletCards } from "lucide-react";

import { truncateAddress } from "@/utils";

const shortenAddress = (address: string) => truncateAddress(address, 6);

export default function WalletModule() {
  const wallets = useUserWallets();
  const {
    createEmbeddedWallet,
    isLoadingEmbeddedWallet,
    userHasEmbeddedWallet,
  } = useEmbeddedWallet();
  const [error, setError] = useState<string | null>(null);

  const embeddedWalletCount = useMemo(
    () => wallets.filter((wallet) => wallet.connector.isEmbeddedWallet).length,
    [wallets]
  );

  const hasEmbeddedWallet = userHasEmbeddedWallet();

  async function handleCreateEmbeddedWallet() {
    setError(null);

    try {
      await createEmbeddedWallet();
    } catch (unknownError) {
      const message =
        unknownError instanceof Error
          ? unknownError.message
          : "Unable to create embedded wallet";
      setError(message);
    }
  }

  if (wallets.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-[180px] max-w-[240px] flex-col gap-2 rounded-md border border-black/10 bg-white/60 px-3 py-2 text-xs text-slate-800 shadow-sm backdrop-blur dark:border-white/10 dark:bg-black/30 dark:text-white">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 font-medium">
          <WalletCards className="h-3.5 w-3.5" />
          Wallets
        </span>
        <span>{wallets.length}</span>
      </div>

      <div className="space-y-1">
        {wallets.slice(0, 2).map((wallet) => (
          <div
            key={wallet.id}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate">{shortenAddress(wallet.address)}</span>
            <span className="shrink-0 text-[10px] uppercase text-slate-500 dark:text-slate-300">
              {wallet.connector.isEmbeddedWallet ? "embedded" : wallet.chain}
            </span>
          </div>
        ))}
      </div>

      {!hasEmbeddedWallet && embeddedWalletCount === 0 && (
        <button
          type="button"
          onClick={handleCreateEmbeddedWallet}
          disabled={isLoadingEmbeddedWallet}
          className="rounded border border-black/10 px-2 py-1 text-left text-[11px] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/10"
        >
          {isLoadingEmbeddedWallet ? "Creating..." : "Create embedded wallet"}
        </button>
      )}

      {error && (
        <p className="line-clamp-2 text-[11px] text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
