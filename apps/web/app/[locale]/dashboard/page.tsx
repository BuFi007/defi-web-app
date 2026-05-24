/**
 * Dashboard root — redirects to /api-keys, which is the canonical landing
 * surface today. When more sub-routes exist we'll replace this with a
 * proper summary view.
 */

import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function DashboardIndexPage({ params }: PageProps) {
  const { locale } = await params;
  redirect(`/${locale}/dashboard/api-keys`);
}
