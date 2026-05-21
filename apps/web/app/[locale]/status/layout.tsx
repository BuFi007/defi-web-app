import type { Metadata } from "next";
import type { RootLayoutProps } from "@/lib/types";
import { Suspense } from "react";

/**
 * Status-page layout — deliberately minimal. The public status page is
 * the "trust during an outage" surface and MUST render without:
 *   - wallet providers (Dynamic/wagmi)
 *   - i18n providers (no useTranslation calls inside)
 *   - the blockchain context
 *   - the audio / music shell
 *   - the perps replacement agent
 *
 * Any failure in those subsystems must NEVER block users from seeing
 * service status. So we shadow the locale `layout.tsx` entirely.
 *
 * The outer `app/layout.tsx` still provides the html + body shell + the
 * Sentry browser init.
 */

export const metadata: Metadata = {
  title: "Status · BUFI",
  description:
    "Live health for BUFI services — API, indexer, oracle, RPCs, and keepers.",
  robots: {
    // The status page is public but we don't want it sucking SEO weight
    // away from the marketing site. Crawlers can read it, just not index it.
    index: false,
    follow: false,
  },
};

export default function StatusLayout({ children }: RootLayoutProps) {
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-[#0b0a18] dark:via-[#0d0b1c] dark:to-[#13112a] text-foreground">
      <Suspense fallback={null}>{children}</Suspense>
    </div>
  );
}
