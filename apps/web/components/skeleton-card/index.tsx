"use client";

import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { BentoGrid, BentoGridItem } from "@/components/bento-grid/index";
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
};

const PaymentLinkSkeleton: React.FC = () => (
  <div className="animate-pulse space-y-4 w-full h-full min-h-[6rem]">
    <div className="mb-4 p-4 bg-background h-full"></div>
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

const BentoTileSkeleton = () => (
  <div className="flex flex-1 w-full h-full min-h-[6rem] rounded-xl bg-gray-200 dark:bg-gray-800 animate-pulse"></div>
);

const MoneyMarketBentoSkeleton: React.FC = () => {
  const items = [
    { title: "", description: "", className: "md:col-span-2" },
    { title: "", description: "", className: "md:col-span-1" },
    { title: "", description: "", className: "md:col-span-1" },
    { title: "", description: "", className: "md:col-span-2" },
  ];

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
          header={<BentoTileSkeleton />}
          className={item.className}
          isSkeleton={true}
        />
      ))}
    </BentoGrid>
  );
};

const TokenSwapSkeleton: React.FC = () => {
  return (
    <div className="bg-background p-6 rounded-lg border-2 border-border dark:border-darkBorder shadow-light dark:shadow-dark animate-pulse">
      <div className="space-y-4">
        <div className="mb-4 p-4 bg-background border-2 border-mainAccent rounded-md">
          <div className="flex justify-between items-center mb-2">
            <div className="h-4 w-12 bg-gray-300 rounded"></div>
            <div className="h-6 w-24 bg-gray-300 rounded"></div>
          </div>
          <div className="h-8 w-full bg-gray-300 rounded"></div>
        </div>

        <div className="flex justify-center">
          <div className="h-8 w-8 bg-gray-300 rounded-full"></div>
        </div>

        <div className="mb-4 p-4 bg-background border-2 border-mainAccent rounded-md">
          <div className="flex justify-between items-center mb-2">
            <div className="h-4 w-12 bg-gray-300 rounded"></div>
            <div className="h-6 w-24 bg-gray-300 rounded"></div>
          </div>
          <div className="h-8 w-full bg-gray-300 rounded"></div>
        </div>

        <div className="h-12 w-full bg-gray-300 rounded"></div>
        <div className="h-4 w-3/4 bg-gray-300 rounded mx-auto"></div>
      </div>
    </div>
  );
};

const ContainerSkeleton = () => {
  return (
    <div className="relative bg-gradient-to-br from-indigo-300 via-violet-400 to-cyan-300 bg-no-repeat dark:bg-gradient-to-r dark:from-gray-900 dark:via-indigo-400 dark:to-gray-800 justify-center items-center mx-auto w-full lg:max-w-7xl border border-border rounded-lg overflow-hidden h-screen animate-pulse">
      <Skeleton className="w-full" />
    </div>
  );
};

const ActionBannerSkeleton: React.FC = () => {
  return (
    <Skeleton className="w-full h-10 mb-2 animate-pulse bg-gradient-to-bl from-purple-400 to-teal-400 dark:from-indigo-900 dark:via-purple-900 dark:to-cyan-900 blur-xl dark:bg-gradient-to-r" />
  );
};

const ModeToggleSkeleton: React.FC = () => (
  <Skeleton className="h-9 w-14 rounded-lg shrink-0" />
);

const LocaleSwitcherSkeleton: React.FC = () => (
  <Skeleton className="h-9 w-20 rounded-md shrink-0" />
);

const WalletControlsSkeleton: React.FC = () => (
  <div className="flex items-center gap-3">
    <Skeleton className="h-10 w-28 rounded-md" />
    <Skeleton className="h-10 w-36 rounded-full" />
  </div>
);

const RadioBarSkeleton: React.FC = () => (
  <div className="w-full flex justify-center py-2">
    <Skeleton className="h-[34px] w-[200px] rounded-full" />
  </div>
);

const HeaderSkeleton: React.FC = () => {
  // Both shapes render — CSS picks the right one for the viewport so there is
  // no JS-driven flip after hydration.
  return (
    <>
      {/* Mobile */}
      <div className="container mx-auto px-4 lg:hidden">
        <div className="flex justify-between items-center py-4">
          <div className="flex items-center">
            <Skeleton className="w-[50px] h-[50px] rounded-full" />
            <Skeleton className="ml-4 h-8 w-24" />
          </div>
          <Skeleton className="w-10 h-10 rounded" />
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden lg:block">
        <ActionBannerSkeleton />
        <div className="container mx-auto grid grid-cols-3 items-center">
          <div className="flex items-center space-x-2">
            <ModeToggleSkeleton />
            <LocaleSwitcherSkeleton />
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="flex justify-center items-center">
            <Image
              src="/images/iso-logo.png"
              alt="Bu Logo"
              width={100}
              height={100}
              className="animate-pulse"
            />
          </div>
          <div className="flex items-center justify-end">
            <span className="h-px flex-1 bg-border" />
            <div className="ml-4">
              <WalletControlsSkeleton />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

const HomePageSkeleton: React.FC = () => {
  return (
    <div className="w-full max-w-5xl mx-auto">
      <div className="flex justify-center w-full">
        <div className="flex justify-center gap-4 m-4">
          <Skeleton className="h-11 w-40 rounded-md" />
          <Skeleton className="h-11 w-40 rounded-md" />
        </div>
      </div>

      <div className="p-10 overflow-hidden flex flex-col items-center justify-center w-full">
        <div className="relative max-w-5xl w-full rounded-lg border-2 border-black dark:border-white bg-background px-8 py-4 shadow-lg">
          <MoneyMarketBentoSkeleton />
        </div>
      </div>
    </div>
  );
};

const PayIdSkeleton: React.FC = () => {
  return (
    <div className="flex flex-col items-center w-full p-4">
      <div className="flex flex-col w-full max-w-l space-y-4">
        <div className="flex flex-col items-center space-y-2">
          <Skeleton className="h-16 w-16 rounded-full" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>

        <div className="flex justify-center space-x-2 mt-4">
          <Skeleton className="h-9 w-16 rounded-md" />
          <Skeleton className="h-9 w-16 rounded-md" />
          <Skeleton className="h-9 w-16 rounded-md" />
          <Skeleton className="h-9 w-16 rounded-md" />
        </div>

        <div className="flex justify-center w-full my-4">
          <Skeleton className="h-10 w-48 rounded-md" />
        </div>

        <Skeleton className="h-24 w-full rounded-md" />
        <Skeleton className="h-11 w-full rounded-md" />
      </div>
    </div>
  );
};

const ClaimSkeleton: React.FC = () => {
  return (
    <main className="flex-1 flex flex-col h-screen p-10">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <Skeleton className="h-7 w-2/3 mx-auto" />

        <div className="flex flex-col items-center space-y-3">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>

        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-11 w-full rounded-md" />
      </div>
    </main>
  );
};

export {
  MoneyMarketSkeleton,
  PaymentLinkSkeleton,
  MoneyMarketBentoSkeleton,
  TokenSwapSkeleton,
  ContainerSkeleton,
  HeaderSkeleton,
  ActionBannerSkeleton,
  HomePageSkeleton,
  PayIdSkeleton,
  ClaimSkeleton,
  ModeToggleSkeleton,
  LocaleSwitcherSkeleton,
  WalletControlsSkeleton,
  RadioBarSkeleton,
};
