/**
 * Per-subscription detail page (Wave I4).
 *
 * RSC shell that resolves the route params + delegates to the
 * client component. Wrapped in the dashboard auth-gate.
 */

import { DashboardAuthGate } from "@/components/dashboard/auth-gate";
import { WebhookDetailClient } from "@/components/dashboard/webhook-detail-client";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function WebhookDetailPage({ params }: PageProps) {
  const { locale, id } = await params;
  return (
    <DashboardAuthGate locale={locale}>
      <WebhookDetailClient locale={locale} subscriptionId={id} />
    </DashboardAuthGate>
  );
}
