/**
 * Manage active perp session keys.
 *
 * One page, one connected wallet, one chain (today: Arc Testnet). Lists
 * the active session key for (address, chainId) if any, plus a brute
 * "Forget all" affordance that nukes every blob persisted in this
 * browser — useful for debug + lost-device recovery.
 *
 * Gated by NEXT_PUBLIC_SESSION_KEYS_ENABLED. When the flag is off the
 * page renders a stub explaining why.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/utils";

import { useSessionKey } from "@/lib/perps/use-session-key";
import {
  isSessionKeyExpired,
  listAllPersistedSessionKeys,
  revokeSessionKey,
  type StoredSessionKeyRecord,
} from "@/lib/perps/session-key-storage";

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatExpiry(validUntil: number, now: number): string {
  const seconds = validUntil - now;
  if (seconds <= 0) {
    const ago = Math.abs(seconds);
    const m = Math.floor(ago / 60);
    return m === 0 ? "expired" : `expired ${m}m ago`;
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s left`;
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s left`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, "0")}m left`;
}

export default function SessionKeysPage() {
  const { address } = useAccount();
  const { isFeatureEnabled, status, revoke } = useSessionKey();
  const { toast } = useToast();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [persisted, setPersisted] = useState<StoredSessionKeyRecord[]>([]);

  // Refresh ticker + list re-read whenever the hook status flips.
  useEffect(() => {
    setPersisted(listAllPersistedSessionKeys());
  }, [status]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
      setPersisted(listAllPersistedSessionKeys());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const mine = useMemo(() => {
    if (!address) return [];
    return persisted.filter(
      (r) => r.ownerAddress.toLowerCase() === address.toLowerCase(),
    );
  }, [persisted, address]);

  const others = useMemo(() => {
    if (!address) return persisted;
    return persisted.filter(
      (r) => r.ownerAddress.toLowerCase() !== address.toLowerCase(),
    );
  }, [persisted, address]);

  if (!isFeatureEnabled) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 py-12 text-sm">
        <h1 className="text-xl font-semibold">Perp session keys</h1>
        <p className="text-muted-foreground">
          Fast trading is currently disabled. Set <code>NEXT_PUBLIC_SESSION_KEYS_ENABLED=true</code>{" "}
          to enable the toggle.
        </p>
      </div>
    );
  }

  function handleRevokeMine() {
    revoke();
    setPersisted(listAllPersistedSessionKeys());
    toast({ title: "Session key revoked" });
  }

  function handleForgetAll() {
    for (const record of persisted) {
      revokeSessionKey(record.ownerAddress, record.chainId);
    }
    setPersisted([]);
    toast({
      title: "All session keys cleared",
      description: "Every persisted blob in this browser was removed.",
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8 text-sm">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">Perp session keys</h1>
        <p className="text-muted-foreground">
          Authorised kernels for one-sign-many-trades perp UX. Each key is scoped to
          settleMatch, cancelOrder, and margin deposit/withdraw on Arc Testnet.
        </p>
      </header>

      {!address ? (
        <div className="rounded-md border border-border/50 bg-muted/30 p-4">
          <p className="text-muted-foreground">Connect a wallet to see session keys for that address.</p>
        </div>
      ) : null}

      {mine.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Yours ({shortAddress(address ?? "")})</h2>
          <ul className="space-y-2">
            {mine.map((record) => (
              <SessionKeyRow
                key={`${record.chainId}.${record.ownerAddress}`}
                record={record}
                now={now}
                onRevoke={handleRevokeMine}
              />
            ))}
          </ul>
        </section>
      ) : address ? (
        <p className="text-muted-foreground">
          No session key on file for this wallet. Use the &quot;Enable fast trading&quot; toggle in
          the trade island to create one.
        </p>
      ) : null}

      {others.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Other wallets in this browser
          </h2>
          <ul className="space-y-2">
            {others.map((record) => (
              <SessionKeyRow
                key={`${record.chainId}.${record.ownerAddress}`}
                record={record}
                now={now}
                onRevoke={() => {
                  revokeSessionKey(record.ownerAddress, record.chainId);
                  setPersisted(listAllPersistedSessionKeys());
                  toast({
                    title: "Session key revoked",
                    description: `Removed key for ${shortAddress(record.ownerAddress)}.`,
                  });
                }}
                dim
              />
            ))}
          </ul>
        </section>
      ) : null}

      {persisted.length > 0 ? (
        <div className="border-t border-border/40 pt-4">
          <Button variant="destructive" size="xs" onClick={handleForgetAll}>
            Forget all session keys
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SessionKeyRow({
  record,
  now,
  onRevoke,
  dim = false,
}: {
  record: StoredSessionKeyRecord;
  now: number;
  onRevoke: () => void;
  dim?: boolean;
}) {
  const expired = isSessionKeyExpired(record, now);
  return (
    <li
      className={cn(
        "rounded-md border p-3",
        expired
          ? "border-yellow-500/30 bg-yellow-500/5"
          : "border-green-500/30 bg-green-500/5",
        dim ? "opacity-70" : "",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="font-mono text-xs">
            kernel {shortAddress(record.kernelAddress)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            owner {shortAddress(record.ownerAddress)} · chain {record.chainId}
          </div>
        </div>
        <div
          className={cn(
            "text-[11px]",
            expired ? "text-yellow-400" : "text-green-400",
          )}
        >
          {formatExpiry(record.validUntil, now)}
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <Button variant="outline" size="xs" onClick={onRevoke}>
          {expired ? "Forget" : "Revoke"}
        </Button>
      </div>
    </li>
  );
}
