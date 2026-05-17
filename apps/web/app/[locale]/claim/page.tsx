import { Suspense } from "react";
import Claim from "@/components/claim-og";
import { ClaimSkeleton } from "@/components/skeleton-card";
import { generateMetadata } from "@/lib/seo/claim-open-graph";

export { generateMetadata };

export default function Page() {
  return (
    <Suspense fallback={<ClaimSkeleton />}>
      <div className="animate-in fade-in duration-500 ease-out">
        <Claim />
      </div>
    </Suspense>
  );
}