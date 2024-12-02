"use client";

import React from "react"
import { Skeleton } from "@/components/ui/skeleton";
import { BentoGrid, BentoGridItem } from "@/components/bento-grid/index"
import { useWindowSize } from "@/hooks/use-window-size";
import Image from "next/image";


const MoneyMarketSkeleton: React.FC = () => {
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

const ContainerSkeleton = () => {
  return (

    <div className="relative bg-gradient-to-br from-indigo-300 via-violet-400 to-cyan-300 bg-no-repeat dark:bg-gradient-to-r dark:from-gray-900 dark:via-indigo-400 dark:to-gray-800 justify-center items-center mx-auto w-full lg:max-w-7xl border border-border rounded-lg overflow-hidden h-screen animate-pulse">
          <Skeleton className="w-full" />
    </div>
  )
}

const ActionBannerSkeleton: React.FC = () => {
  return (
    <Skeleton className="w-full h-10 mb-2 animate-pulse bg-gradient-to-bl from-purple-400 to-teal-400 dark:from-indigo-900 dark:via-purple-900 dark:to-cyan-900 blur-xl dark:bg-gradient-to-r" />
  )
}


const HeaderSkeleton: React.FC = () => {
  const { width } = useWindowSize();
  
  if (width && width < 1024) {
    return (
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center py-4">
          <div className="flex items-center">
            <Skeleton className="w-[50px] h-[50px] rounded-full animate-pulse" />
            <Skeleton className="ml-4 h-8 w-24 animate-pulse" />
          </div>
          <Skeleton className="w-10 h-10 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <>
      <ActionBannerSkeleton/> 
      <div className="container mx-auto grid grid-cols-3 items-center">
        <div className="flex items-center space-x-2">
        <Skeleton className="h-10 w-10 border border-border/50 rounded-lg animate-pulse bg-gradient-to-br from-indigo-100 via-violet-200 to-cyan-200 bg-no-repeat dark:bg-gradient-to-r dark:from-gray-900 dark:via-indigo-400 dark:to-gray-800" />
        <Skeleton className="h-10 w-24 border border-border/50 rounded-lg animate-pulse bg-gradient-to-br from-indigo-100 via-violet-200 to-cyan-200 bg-no-repeat dark:bg-gradient-to-r dark:from-gray-900 dark:via-indigo-400 dark:to-gray-800" />
        <span className="h-px flex-1 bg-border"></span>
      </div>
      <div className="flex justify-center items-center">
        <div className="flex items-center">
            <Image
              src="/images/BooFi-icon.png"
              alt="Bu Logo"
              width={100}
              height={100}
              priority
              className="animate-pulse"
            />  
          </div>
        </div>
        <div className="flex items-center justify-end">
          <span className="h-px flex-1 bg-border"></span>
          <Skeleton className="h-10 w-[180px] border border-border/50 rounded-lg ml-4 animate-pulse bg-gradient-to-br from-indigo-100 via-violet-200 to-cyan-200 bg-no-repeat dark:bg-gradient-to-r dark:from-gray-900 dark:via-indigo-400 dark:to-gray-800" />
        </div>
      </div>
    </>
  );
};

export { MoneyMarketSkeleton, PaymentLinkSkeleton, MoneyMarketBentoSkeleton, TokenSwapSkeleton, ContainerSkeleton, HeaderSkeleton, ActionBannerSkeleton };
