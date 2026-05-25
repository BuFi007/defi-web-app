"use client";

import { useIdentityRegistration } from "@/hooks/use-identity-registration";

export function IdentityBadge() {
  const { registered, registering, register, address } = useIdentityRegistration();

  if (!address) return null;

  if (registered === true) {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-green-500/10 border border-green-500/20 px-3 py-1.5 text-xs text-green-400">
        <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
        ERC-8004
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={register}
      disabled={registering}
      className="flex items-center gap-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 px-3 py-1.5 text-xs text-yellow-400 transition-colors hover:bg-yellow-500/20 disabled:opacity-50"
    >
      {registering ? (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-spin" />
          Minting...
        </>
      ) : (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
          Mint Identity
        </>
      )}
    </button>
  );
}
