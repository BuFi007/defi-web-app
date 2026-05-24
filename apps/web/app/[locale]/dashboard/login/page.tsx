/**
 * Dashboard login page (Wave I4).
 *
 * Anonymous users hitting any /dashboard route are redirected here by
 * `DashboardAuthGate`. We deliberately don't render a custom Connect
 * button — the Dynamic widget is already mounted globally in
 * `apps/web/components/header/*` and a user can click it from there.
 *
 * The page also handles the post-connect redirect via a small client
 * component that watches the session status and bounces back to
 * /dashboard/api-keys once the wallet is up.
 */

import { LoginRedirector } from "@/components/dashboard/login-redirector";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function DashboardLoginPage({ params }: PageProps) {
  const { locale } = await params;

  return (
    <div className="w-full max-w-xl mx-auto py-12">
      <div className="rounded-lg border border-border bg-card p-8 flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-tight">
          Connect a wallet to continue
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The integrator dashboard is gated to authenticated wallet
          sessions. Use the wallet button in the top navigation bar to
          connect with an extension wallet or a social account. Once
          connected, this page will forward you to{" "}
          <code className="px-1 py-0.5 rounded bg-muted/60 text-xs">
            /dashboard/api-keys
          </code>
          .
        </p>
        <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
          <li>API key issuance and revocation</li>
          <li>Webhook subscription create + test + rotate</li>
          <li>Per-subscription delivery history</li>
        </ul>
        <LoginRedirector locale={locale} />
      </div>
    </div>
  );
}
