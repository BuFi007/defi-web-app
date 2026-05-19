"use client";

import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import Image from "next/image";

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

/**
 * Suspense fallback for the home route. Mirrors the trade-island shape
 * users actually see when the page finishes booting (`.island` in
 * css/trade-island/index.css) — same 28px radius, brand-purple ring,
 * 3-column body silhouette — so the swap from skeleton → real UI is
 * a fade-in, not a layout jump.
 *
 * The old skeleton rendered a Money-Market bento grid with a yellow
 * `mainAccent` (#ffc800) ring, which had no relation to the actual
 * trade island and read as a different product loading.
 */
const HomePageSkeleton: React.FC = () => {
  return (
    <div className="w-full max-w-[1440px] px-4 py-3 mx-auto flex-1 flex flex-col">
      <div
        className="
          relative flex-1 w-full overflow-hidden
          rounded-[28px] border-[1.5px]
          border-purpleDanis/20 dark:border-violetDanis/20
          bg-background
          shadow-[0_8px_24px_rgba(60,45,130,0.08),0_24px_64px_rgba(60,45,130,0.12)]
          min-h-[560px]
        "
      >
        {/* Header strip — tabs row + summary chips on the right */}
        <div className="flex items-center gap-4 px-4 py-3 border-b border-purpleDanis/10 dark:border-violetDanis/10">
          <div className="flex items-center gap-2 bg-purpleDanis/5 dark:bg-violetDanis/5 rounded-[14px] p-1">
            <Skeleton className="h-8 w-[110px] rounded-[10px]" />
            <Skeleton className="h-8 w-[80px] rounded-[10px]" />
            <Skeleton className="h-8 w-[90px] rounded-[10px]" />
            <Skeleton className="h-8 w-[100px] rounded-[10px]" />
            <Skeleton className="h-8 w-[80px] rounded-[10px]" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-9 w-[180px] rounded-xl" />
            <Skeleton className="h-9 w-[200px] rounded-xl" />
          </div>
        </div>

        {/* Body — 3-column trade canvas silhouette (orderbook + chart + order) */}
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_320px] gap-3 p-4 h-[calc(100%-66px)] min-h-0">
          <div className="hidden lg:flex flex-col gap-2 rounded-2xl bg-purpleDanis/5 dark:bg-violetDanis/5 p-3 min-h-0">
            <Skeleton className="h-4 w-3/4" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-full" />
            ))}
          </div>
          <div className="rounded-2xl bg-purpleDanis/5 dark:bg-violetDanis/5 p-3 flex flex-col gap-3 min-h-[320px]">
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-[80px] rounded-full" />
              <Skeleton className="h-6 w-[120px] rounded-full" />
              <Skeleton className="ml-auto h-6 w-[64px] rounded-full" />
            </div>
            <Skeleton className="flex-1 w-full rounded-xl min-h-[240px]" />
          </div>
          <div className="hidden lg:flex flex-col gap-3 rounded-2xl bg-purpleDanis/5 dark:bg-violetDanis/5 p-3">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-12 w-full rounded-xl mt-auto" />
          </div>
        </div>
      </div>
    </div>
  );
};

export {
  ContainerSkeleton,
  HeaderSkeleton,
  ActionBannerSkeleton,
  HomePageSkeleton,
  ModeToggleSkeleton,
  LocaleSwitcherSkeleton,
  WalletControlsSkeleton,
  RadioBarSkeleton,
};
