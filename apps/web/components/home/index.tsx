"use client"

import React, { Suspense, useState, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { NotConnectedHome } from "@/components/not-connected";
import { PaymentLinkTabContent } from "@/components/tab-content/payments-tab";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTriggerAlt,
} from "@/components/ui/tabs";
import { Button } from "../ui/button";
import MoneyMarketBentoGrid from "../money-market";
import { useTabStore } from "@/store";
import { LottieWrapper } from "@/components/lottie-wrapper"
import { PaymentLinkSkeleton, TokenSwapSkeleton, MoneyMarketBentoSkeleton } from "@/components/skeleton-card";
import { useAppTranslations } from "@/context/TranslationContext";

type ActiveTab = "moneyMarket" | "paymentLink" | "tokenSwap";

const isValidTab = (value: string | null): value is ActiveTab =>
  value === "moneyMarket" || value === "paymentLink" || value === "tokenSwap";

export const HomeContent: React.FC = () => {
  const { isConnected } = useAccount()
  const { activeTab, setActiveTab, resetTab } = useTabStore()
  const [isTransitioning, setIsTransitioning] = useState(false)
  const address = useAccount();
  const translations = useAppTranslations('Home');
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // URL ?tab= is the source of truth; falls back to store default. Runs on
  // mount and whenever the query string changes (mobile drawer deep-links).
  useEffect(() => {
    const queryTab = searchParams?.get('tab') ?? null;
    if (isValidTab(queryTab)) {
      setActiveTab(queryTab);
    } else {
      resetTab();
    }
  }, [searchParams, setActiveTab, resetTab, translations]);


  useEffect(() => {
    if (isTransitioning) {
      const timer = setTimeout(() => {
        setIsTransitioning(false)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isTransitioning])

  if (!isConnected) {
    return <NotConnectedHome />
  }

  const handleTabChange = (value: string) => {
    if (!isValidTab(value)) return;
    setIsTransitioning(true)
    setActiveTab(value)
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set('tab', value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <>
      <Tabs value={activeTab} defaultValue="moneyMarket" className="w-full max-w-5xl" onValueChange={handleTabChange}>
        <div className="flex justify-center w-full">
          <TabsList stackBehavior="stacked-2" className="flex justify-center gap-4 m-4">
            <TabsTriggerAlt value="moneyMarket">
              <Button
                size="lg"
                className="flex items-center gap-2 w-full"
                variant="charly"
                tabValue="moneyMarket"
                storeType="tab"
              >
                <span>{translations.moneyMarketTab}</span>
              </Button>
            </TabsTriggerAlt>
            <TabsTriggerAlt value="paymentLink">
              <Button
                size="lg"
                className="flex items-center gap-2 w-full"
                variant="charly"
                tabValue="paymentLink"
                storeType="tab"
              >
                <span>{translations.paymentsTab} 💸</span>
              </Button>
            </TabsTriggerAlt>
          </TabsList>
        </div>

        <div className="p-10 overflow-hidden flex flex-col items-center justify-center w-full">
          <div className="relative flex flex-col items-center justify-center w-full h-full">
            <div
              className={`relative z-1 text-center bg-background dark:bg-background rounded-lg shadow-lg px-8 py-4 w-full border-2 border-black dark:border-white transition-all duration-300 ease-in-out ${
                activeTab === 'paymentLink' ? 'max-w-xl' : activeTab === 'tokenSwap' ? 'max-w-xl' : 'max-w-5xl'
              }`}
            >
              <LottieWrapper />
              {isTransitioning ? (
                activeTab === 'paymentLink' || activeTab === 'tokenSwap' ? (
                  activeTab === 'paymentLink' ? <PaymentLinkSkeleton /> : <TokenSwapSkeleton />
                ) : (
                  <MoneyMarketBentoSkeleton />
                )
              ) : (
                <>
                  <TabsContent value="moneyMarket" className="transition-opacity duration-300 ease-in-out flex-grow">
                      <Suspense fallback={<MoneyMarketBentoSkeleton />}>
                        <MoneyMarketBentoGrid />
                      </Suspense>
                  </TabsContent>
                  <TabsContent value="paymentLink" className="transition-opacity duration-300 ease-in-out">
                    <Suspense fallback={<PaymentLinkSkeleton />}>
                      <PaymentLinkTabContent address={address?.address ?? ""} />
                    </Suspense>
                  </TabsContent>
                </>
              )}
            </div>
          </div>
        </div>
      </Tabs>
    </>
  )
}

