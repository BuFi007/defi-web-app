import { HomeContent } from "@/components/home";
import { Suspense } from "react";
import { MoneyMarketSkeleton } from "@/components/skeleton-card";

export default function Home() {

  return (
    <>
      <Suspense fallback={<MoneyMarketSkeleton />}>
        <HomeContent />
      </Suspense>
    </>
  );
}
