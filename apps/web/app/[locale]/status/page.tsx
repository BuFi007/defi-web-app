import Link from "next/link";

import { runAllProbes } from "@/lib/status/probes";
import { ServiceCard } from "@/components/status/service-card";
import { StatusBanner } from "@/components/status/status-banner";

/**
 * Public status page — `/[locale]/status`, eventually fronted at
 * status.bu.finance. Reads health for every service in parallel and
 * renders a Cloudflare-style page that ALWAYS renders, even if every
 * probe fails. Errors are surfaced as red "down" cards, never as a
 * 500 page.
 *
 * Refresh cadence:
 *   - The page itself revalidates every 30s via the `revalidate`
 *     export below (still honoured under Next 16 + cacheComponents).
 *   - We also tag the response with `Cache-Control: max-age=15,
 *     stale-while-revalidate=30` so an aggressive monitoring tool
 *     gets a fresh-enough answer without hammering the upstreams.
 *
 * Locale:
 *   - The page reads `params.locale` only to satisfy the [locale]
 *     route segment; it doesn't load translations. The status page is
 *     intentionally English-only for v1 — operators and integrators
 *     read English, and the trade-off is fewer moving parts on the
 *     trust surface. Wave-F can add per-locale copy if needed.
 */

export const revalidate = 30;

interface StatusPageProps {
  params: Promise<{ locale: string }>;
}

export default async function StatusPage({ params }: StatusPageProps) {
  // Touch `params` so Next's cacheComponents pipeline knows the page is
  // dynamic — without this read, RSC would hoist Date.now() into the
  // static prerender and break the freshness contract.
  await params;

  const snapshot = await runAllProbes();
  const operationalCount = snapshot.results.filter(
    (r) => r.status === "operational",
  ).length;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      <header className="mb-6 sm:mb-8">
        <p className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
          status.bu.finance
        </p>
        <h1 className="sr-only">BUFI service status</h1>
      </header>

      <StatusBanner
        status={snapshot.overall}
        generatedAt={snapshot.generatedAt}
        totalServices={snapshot.results.length}
        operationalCount={operationalCount}
      />

      <section
        aria-label="Service health"
        className="mt-6 sm:mt-8 grid grid-cols-1 md:grid-cols-2 gap-4"
      >
        {snapshot.results.map((result) => (
          <ServiceCard key={result.service.id} result={result} />
        ))}
      </section>

      <footer className="mt-10 sm:mt-12 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <FooterCard
          title="Incident history"
          body="A full log of past incidents and resolutions will live here. Until Wave F wires the feed, refer to the team channel."
        />
        <FooterCard
          title="Subscribe to updates"
          body="Email / Telegram subscriptions ship in Wave F. For now, watch this page or follow @BUFI_finance."
        />
      </footer>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Page auto-refreshes every 30 seconds. JSON feed:{" "}
        <Link
          href="/api/status"
          className="font-mono underline decoration-dotted underline-offset-2 hover:text-foreground"
        >
          /api/status
        </Link>
      </p>
    </main>
  );
}

function FooterCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border bg-card/60 backdrop-blur-sm p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
        {body}
      </p>
    </div>
  );
}
