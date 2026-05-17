"use server";
import { Suspense } from "react";
import PayId from "@/components/pay-id";
import { PayIdSkeleton } from "@/components/skeleton-card";
import { generateMetadata } from "@/lib/seo/pay-open-graph";

export { generateMetadata };

export default async function Page() {
  return (
    <Suspense fallback={<PayIdSkeleton />}>
      <div className="animate-in fade-in duration-500 ease-out">
        <PayId />
      </div>
    </Suspense>
  );
}
