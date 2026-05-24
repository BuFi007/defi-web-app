/**
 * Tiny client component for the dashboard login page (Wave I4).
 *
 * Watches BufiSession status — once the user connects a wallet, bounce
 * them back to `/[locale]/dashboard/api-keys`. Renders a small live
 * status line so the user gets feedback while we wait for the wallet to
 * settle.
 */

"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useBufiSessionStatus } from "@/lib/session";

interface LoginRedirectorProps {
  locale: string;
}

export function LoginRedirector({ locale }: LoginRedirectorProps) {
  const status = useBufiSessionStatus();
  const router = useRouter();

  useEffect(() => {
    if (status === "connected") {
      router.replace(`/${locale}/dashboard/api-keys`);
    }
  }, [status, locale, router]);

  return (
    <div className="text-xs text-muted-foreground mt-2">
      {status === "connecting"
        ? "Wallet connecting — hold on…"
        : status === "connected"
          ? "Connected. Redirecting to the dashboard…"
          : "Waiting for wallet connection."}
    </div>
  );
}
