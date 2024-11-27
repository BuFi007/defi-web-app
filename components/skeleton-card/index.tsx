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
  <div className="animate-pulse space-y-4 w-full h-full min-h-[6rem]">
    <div className="mb-4 p-4 bg-background h-full">
    </div>
    <div className="mb-4 p-4 bg-background border-2 border-mainAccent rounded-md h-full">
      <div className="flex space-x-2 mb-4">
        <div className="h-8 bg-gray-300 rounded w-1/2"></div>
        <div className="h-8 bg-gray-300 rounded w-1/2"></div>
      </div>
    </div>
    <div className="mb-4 p-4 bg-background border-2 border-mainAccent rounded-md">
    <div className="h-2 bg-gray-300 rounded w-full mb-4"></div>
      <div className="h-12 bg-gray-300 rounded w-full mb-4"></div>
    </div>

    <div className="mb-4 p-4 bg-background border-2 border-mainAccent rounded-md">
    <div className="h-2 bg-gray-300 rounded w-full mb-4"></div>
      <div className="h-12 bg-gray-300 rounded w-full mb-4"></div>
    </div>

    <div className="mb-4 p-4 bg-background border-2 border-mainAccent rounded-md">
    <div className="h-2 bg-gray-300 rounded w-full mb-4"></div>
      <div className="h-12 bg-gray-300 rounded w-full mb-4"></div>
    </div>

    <div className="mb-4 p-4 bg-background border-2 border-mainAccent rounded-md">
      <div className="h-4 bg-gray-300 rounded w-full mb-4"></div>
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

const TokenSwapSkeleton: React.FC = () => {
  return (
    <div className="bg-background p-6 rounded-lg border-2 border-border dark:border-darkBorder shadow-light dark:shadow-dark animate-pulse">
      <div className="space-y-4">
        {/* Sell section */}
        <div className="mb-4 p-4 bg-background border-2 border-mainAccent rounded-md">
          <div className="flex justify-between items-center mb-2">
            <div className="h-4 w-12 bg-gray-300 rounded"></div>
            <div className="h-6 w-24 bg-gray-300 rounded"></div>
          </div>
          <div className="h-8 w-full bg-gray-300 rounded"></div>
        </div>

        {/* Swap toggle button */}
        <div className="flex justify-center">
          <div className="h-8 w-8 bg-gray-300 rounded-full"></div>
        </div>

        {/* Buy section */}
        <div className="mb-4 p-4 bg-background border-2 border-mainAccent rounded-md">
          <div className="flex justify-between items-center mb-2">
            <div className="h-4 w-12 bg-gray-300 rounded"></div>
            <div className="h-6 w-24 bg-gray-300 rounded"></div>
          </div>
          <div className="h-8 w-full bg-gray-300 rounded"></div>
        </div>

        {/* Swap button */}
        <div className="h-12 w-full bg-gray-300 rounded"></div>

        {/* Swap message */}
        <div className="h-4 w-3/4 bg-gray-300 rounded mx-auto"></div>
      </div>
    </div>
  );
}


const LayoutSkeleton = () => {
  return (
    <div className="relative w-full lg:max-w-7xl mx-auto border border-black rounded-lg overflow-hidden">
      <MoneyMarketSkeleton />
    </div>
  )
}

const ContainerSkeleton = () => {
  return (
    <div className="relative bg-gradient-to-br from-indigo-100 via-violet-200 to-cyan-300 bg-no-repeat justify-center items-center mx-auto w-full lg:max-w-7xl border border-black rounded-lg overflow-hidden h-screen">
      <div className="mb-4 p-4 bg-background border-2 border-mainAccent rounded-md animate-pulse">
        <div className="animate-pulse space-y-4 w-full h-full min-h-[6rem]">
          <Skeleton className="w-full h-[800px]" />
        </div>
      </div>
    </div>
  )
}


export { MoneyMarketSkeleton, PaymentLinkSkeleton, MoneyMarketBentoSkeleton, TokenSwapSkeleton, ContainerSkeleton, LayoutSkeleton };
