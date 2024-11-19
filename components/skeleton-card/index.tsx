"use client";

import { Skeleton } from "@/components/ui/skeleton";

function MoneyMarketSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-5/6" />
      <Skeleton className="h-6 w-2/3" />
    </div>
  );
}

const PaymentLinkSkeleton: React.FC = () => (
  <div className="animate-pulse space-y-4">
    <div className="mb-4 p-4 bg-background border-2 border-mainAccent rounded-md">
      <div className="flex space-x-2 mb-4">
        <div className="h-8 bg-gray-300 rounded w-1/2"></div>
        <div className="h-8 bg-gray-300 rounded w-1/2"></div>
      </div>
    </div>
    <div className="mb-4 p-4 bg-background border-2 border-mainAccent rounded-md">
      <div className="h-12 bg-gray-300 rounded w-full mb-4"></div>
      <div className="h-8 bg-gray-300 rounded w-3/4 mb-2"></div>
      <div className="h-8 bg-gray-300 rounded w-1/2 mb-4"></div>
      <div className="h-12 bg-gray-300 rounded w-full"></div>
    </div>
  </div>
);

export { MoneyMarketSkeleton, PaymentLinkSkeleton };
