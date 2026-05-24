/**
 * API keys page (Wave I4 — v0.1 local-stub).
 *
 * RSC shell that simply mounts the client component. The actual flow
 * (read/write localStorage, render the issuer modal, list keys) lives in
 * `ApiKeysClient` because every operation is browser-only.
 */

import { DashboardAuthGate } from "@/components/dashboard/auth-gate";
import { ApiKeysClient } from "@/components/dashboard/api-keys-client";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function ApiKeysPage({ params }: PageProps) {
  const { locale } = await params;
  return (
    <DashboardAuthGate locale={locale}>
      <ApiKeysClient />
    </DashboardAuthGate>
  );
}
