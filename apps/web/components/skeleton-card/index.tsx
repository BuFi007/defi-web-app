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
  // The outer layout (apps/web/app/[locale]/layout.tsx) is a flex column
  // with `items-center justify-center`. `w-full` would defeat the
  // horizontal centering — keep the skeleton intrinsically sized via
  // `max-w-5xl` only, no `w-full` wrapper.
  return (
    <div className="w-full max-w-5xl px-4 py-6 mx-auto">
      <div className="relative w-full rounded-2xl border-2 border-purpleDanis/40 dark:border-violetDanis/40 bg-background px-6 py-5 shadow-lg">
        <MoneyMarketBentoSkeleton />
      </div>
    </div>
  );
};

export {
  MoneyMarketSkeleton,
  MoneyMarketBentoSkeleton,
  ContainerSkeleton,
  HeaderSkeleton,
  ActionBannerSkeleton,
  HomePageSkeleton,
  ModeToggleSkeleton,
  LocaleSwitcherSkeleton,
  WalletControlsSkeleton,
  RadioBarSkeleton,
};
