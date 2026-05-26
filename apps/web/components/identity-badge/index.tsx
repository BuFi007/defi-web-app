"use client";

import { useIdentityRegistration } from "@/hooks/use-identity-registration";

export function IdentityBadge() {
  const { registered, address } = useIdentityRegistration();

  if (!address || !registered) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-green-500/10 border border-green-500/20 px-3 py-1.5 text-xs text-green-400">
      <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
      ERC-8004
    </div>
  );
}
