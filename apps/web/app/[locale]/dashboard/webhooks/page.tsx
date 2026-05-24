/**
 * Webhooks list page (Wave I4).
 *
 * RSC shell that mounts the client component, wrapped in the dashboard
 * auth-gate. Page-level data fetching is intentionally client-side —
 * every request needs the user's localStorage-stored API key in the
 * header, and SSR cannot read that.
 */

import { DashboardAuthGate } from "@/components/dashboard/auth-gate";
import { WebhooksClient } from "@/components/dashboard/webhooks-client";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function WebhooksPage({ params }: PageProps) {
  const { locale } = await params;
  return (
    <DashboardAuthGate locale={locale}>
      <WebhooksClient locale={locale} />
    </DashboardAuthGate>
  );
}
