/**
 * Integrator dashboard shell (Wave I4).
 *
 * Deliberately minimal — no trade-island chrome, no spaceman background,
 * no animated home hero. Integrators land here to do operational work
 * (issue keys, register webhooks, fire test events) and need the page to
 * feel like a control panel, not a marketing surface.
 *
 * The outer `[locale]/layout.tsx` already provides:
 *   - I18nProviderClient + TranslationProvider
 *   - GhostModeProvider
 *   - ClientProviders (Dynamic + wagmi + TanStack QueryClient + SessionBridge)
 *   - <Header />, <LayoutMusic />, background variants
 *
 * We re-use all of those by simply returning `children` wrapped in a
 * narrow content column with a side-nav. That keeps the wallet button,
 * locale switcher, and other top-bar affordances available so a user
 * doesn't get stranded inside the dashboard with no way to log out.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/utils";

interface DashboardLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function DashboardLayout({
  children,
  params,
}: DashboardLayoutProps) {
  const { locale } = await params;

  const nav: Array<{ href: string; label: string }> = [
    {
      href: `/${locale}/dashboard/api-keys`,
      label: "API keys",
    },
    {
      href: `/${locale}/dashboard/webhooks`,
      label: "Webhooks",
    },
  ];

  return (
    <div className="w-full min-h-[70vh] flex flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Integrator dashboard
          </span>
          <span className="rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5">
            v0.1 — local-stub keys
          </span>
        </div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
          BUFI integrator console
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Manage API keys and webhook subscriptions for the BUFI event
          delivery pipeline. Today the dashboard issues keys locally — see
          the disclosure on the API keys page.
        </p>
      </header>

      <div className="flex flex-col md:flex-row gap-6">
        <nav
          aria-label="Dashboard navigation"
          className="md:w-48 shrink-0 flex md:flex-col gap-1 border-b md:border-b-0 md:border-r border-border pb-3 md:pb-0 md:pr-4"
        >
          {nav.map((item) => (
            <DashboardNavLink key={item.href} href={item.href}>
              {item.label}
            </DashboardNavLink>
          ))}
        </nav>

        <section className="flex-1 min-w-0">{children}</section>
      </div>
    </div>
  );
}

function DashboardNavLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  // Pure server-rendered link — the parent layout handles the active-state
  // visual via CSS :hover. We avoid usePathname here because each page
  // controls its own active styling via Tailwind's `aria-current` selector
  // when needed (kept simple for v0.1 — flesh out in a later cycle).
  return (
    <Link
      href={href}
      className={cn(
        "text-sm font-medium rounded-md px-3 py-2",
        "text-muted-foreground hover:text-foreground hover:bg-muted/60",
        "transition-colors",
      )}
    >
      {children}
    </Link>
  );
}
