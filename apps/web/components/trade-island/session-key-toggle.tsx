/**
 * "Enable fast trading" toggle for the perp trade island.
 *
 * Feature-flagged behind NEXT_PUBLIC_SESSION_KEYS_ENABLED — when off, the
 * component renders nothing. When on:
 *   - Idle: shows the explainer + one CTA to authorise a session key.
 *   - Active: shows a green pill + remaining-time countdown + revoke.
 *   - Expired: shows a re-enable CTA.
 *
 * The explainer is intentionally explicit about the deposit-to-kernel
 * caveat (see lib/perps/session-keys-README.md). This is the ONE place
 * the average user sees the kernel-address concept; everywhere else the
 * abstraction is hidden.
 */

"use client";

import { useEffect, useMemo, useState } from "react";

import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils";

import { useSessionKey } from "@/lib/perps/use-session-key";

function formatRemaining(validUntil: number, now: number): string {
  const seconds = Math.max(0, validUntil - now);
  if (seconds <= 0) return "expired";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s left`;
  return `${m}m ${s.toString().padStart(2, "0")}s left`;
}

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function SessionKeyToggle({ className }: { className?: string }) {
  const {
    isFeatureEnabled,
    status,
    kernelAddress,
    validUntil,
    enable,
    revoke,
    error,
  } = useSessionKey();
  const { toast } = useToast();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (status !== "active") return;
    const id = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const remaining = useMemo(() => {
    if (!validUntil) return null;
    return formatRemaining(validUntil, now);
  }, [validUntil, now]);

  if (!isFeatureEnabled) return null;

  async function handleEnable() {
    try {
      await enable();
      toast({
        title: "Fast trading enabled",
        description: "Next hour: no popups. Margin must live in the kernel address.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't enable fast trading",
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function handleRevoke() {
    revoke();
    toast({ title: "Fast trading revoked", description: "Future orders will prompt the wallet." });
  }

  if (status === "active") {
    return (
      <div
        className={cn(
          "rounded-md border border-green-500/40 bg-green-500/10 p-3 text-xs",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" aria-hidden />
            <span className="font-semibold">Fast trading: ON</span>
          </div>
          <span className="text-green-300">{remaining}</span>
        </div>
        {kernelAddress ? (
          <div className="mt-1 text-muted-foreground">
            Kernel: <span className="font-mono">{shortAddress(kernelAddress)}</span>
          </div>
        ) : null}
        <Button
          variant="outline"
          size="xs"
          className="mt-2 w-full"
          onClick={handleRevoke}
        >
          Revoke session key
        </Button>
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div
        className={cn(
          "rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs",
          className,
        )}
      >
        <div className="font-semibold">Fast trading expired</div>
        <p className="mt-1 text-muted-foreground">
          Re-authorise to skip wallet popups for another hour.
        </p>
        <div className="mt-2 flex gap-2">
          <Button size="xs" className="flex-1" onClick={handleEnable} disabled={status !== "expired"}>
            Re-enable
          </Button>
          <Button variant="outline" size="xs" className="flex-1" onClick={handleRevoke}>
            Forget
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-md border border-border/50 bg-muted/30 p-3 text-xs", className)}>
      <div className="font-semibold">Enable fast trading</div>
      <p className="mt-1 text-muted-foreground">
        Sign once to authorise a session key. The next hour of orders skips the wallet popup.
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground/80">
        Heads up: this routes orders through a kernel smart account, so margin needs to live in
        the <em>kernel</em> address (we walk you through depositing on first use).
      </p>
      {error ? (
        <p className="mt-2 text-[11px] text-destructive">{error.message}</p>
      ) : null}
      <Button
        size="xs"
        className="mt-2 w-full"
        onClick={handleEnable}
        disabled={status === "loading"}
      >
        {status === "loading" ? "Signing…" : "Enable fast trading"}
      </Button>
    </div>
  );
}

export default SessionKeyToggle;
