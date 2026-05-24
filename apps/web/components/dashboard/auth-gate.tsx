/**
 * Wallet-gated wrapper for every dashboard sub-page (Wave I4).
 *
 * Reads BufiSession (the canonical "who's signed in" atom) and:
 *
 *   - status === "connected" → render children
 *   - status === "connecting" → render a non-jumpy skeleton (so first paint
 *     after wallet rehydrate doesn't flicker to the login redirect)
 *   - status === "anonymous" → soft-redirect to /[locale]/dashboard/login
 *
 * The redirect runs in `useEffect` so the SSR pass renders the connecting
 * skeleton — Next.js fails the build if you call `redirect()` from a
 * client component during render.
 *
 * Escape hatch: `NEXT_PUBLIC_DASHBOARD_ENABLED=disabled` short-circuits the
 * whole tree with a "coming soon" message. Useful if the dashboard ever
 * needs to be temporarily disabled in a deployed env.
 */

"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useBufiSessionStatus } from "@/lib/session";

interface DashboardAuthGateProps {
  locale: string;
  children: ReactNode;
}

const DASHBOARD_FLAG = process.env.NEXT_PUBLIC_DASHBOARD_ENABLED;

export function DashboardAuthGate({ locale, children }: DashboardAuthGateProps) {
  const status = useBufiSessionStatus();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") {
      router.replace(`/${locale}/dashboard/login`);
    }
  }, [status, locale, router]);

  if (DASHBOARD_FLAG === "disabled") {
    return (
      <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
        The integrator dashboard is temporarily disabled. Set
        <code className="mx-1 px-1 py-0.5 rounded bg-muted/60 text-xs">
          NEXT_PUBLIC_DASHBOARD_ENABLED
        </code>
        to a different value (or unset it) to re-enable it.
      </div>
    );
  }

  if (status === "connecting" || status === "anonymous") {
    return (
      <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground animate-pulse">
        Checking wallet session…
      </div>
    );
  }

  return <>{children}</>;
}
