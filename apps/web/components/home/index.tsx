"use client"

import React, { Suspense } from "react";
import { useAccount } from "wagmi";
import { NotConnectedHome } from "@/components/not-connected";
import MoneyMarketBentoGrid from "../money-market";
import { LottieWrapper } from "@/components/lottie-wrapper"
import { MoneyMarketBentoSkeleton } from "@/components/skeleton-card";

export const HomeContent: React.FC = () => {
  const { isConnected } = useAccount()

  if (!isConnected) {
    return <NotConnectedHome />
  }

  return (
    <div className="w-full max-w-5xl">
      <div className="px-4 sm:px-6 py-4 flex flex-col items-center justify-center w-full">
        <div className="relative z-1 text-center bg-background dark:bg-background rounded-lg shadow-lg px-4 sm:px-5 py-3 w-full max-w-5xl border-2 border-black dark:border-white">
          <LottieWrapper />
          <Suspense fallback={<MoneyMarketBentoSkeleton />}>
            <MoneyMarketBentoGrid />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

