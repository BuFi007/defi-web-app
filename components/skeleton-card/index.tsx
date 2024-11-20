"use client";

import React from "react"
import { Skeleton } from "@/components/ui/skeleton";
import { BentoGrid, BentoGridItem } from "@/components/bento-grid/index"

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

const MoneyMarketBentoSkeleton: React.FC = () => {
  const Skeleton = () => (
    <div className="flex flex-1 w-full h-full min-h-[6rem] rounded-xl bg-gray-200 dark:bg-gray-800 animate-pulse"></div>
  )

  const items = [
    {
      title: "",
      description: "",
      className: "md:col-span-2",
    },
    {
      title: "",
      description: "",
      className: "md:col-span-1",
    },
    {
      title: "",
      description: "",
      className: "md:col-span-1",
    },
    {
      title: "",
      description: "",
      className: "md:col-span-2",
    },
  ]

  return (
    <BentoGrid className="max-w-4xl mx-auto md:auto-rows-[20rem]">
      {items.map((item, i) => (
        <BentoGridItem
          key={i}
          title={
            <div className="h-6 bg-gray-300 rounded w-3/4 mb-2 animate-pulse"></div>
          }
          description={
            <div className="h-4 bg-gray-300 rounded w-full mb-4 animate-pulse"></div>
          }
          header={<Skeleton />}
          className={item.className}
          isSkeleton={true}
        />
      ))}
    </BentoGrid>
  )
}
export { MoneyMarketSkeleton, PaymentLinkSkeleton, MoneyMarketBentoSkeleton };
