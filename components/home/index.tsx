"use client";

import React, { Suspense, useState, useEffect } from "react";
import { Translations } from "@/lib/types";
import { useAccount } from "wagmi";
import { PaymentLinkTabContent } from "../tab-content/payments-tab";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTriggerAlt,
} from "@/components/ui/tabs";
import { Button } from "../ui/button";
import { useNetworkManager } from "@/hooks/use-dynamic-network";
import { useTabStore } from "@/store";
import { PaymentLinkSkeleton, MoneyMarketBentoSkeleton } from "../skeleton-card";
import MoneyMarketBentoGrid from "@/components/money-market";

interface HomeContentProps {
  translations: Translations["Home"];
}

export const HomeContent: React.FC<HomeContentProps> = ({ translations }) => {
  const { isConnected } = useAccount();
  const { activeTab, setActiveTab } = useTabStore();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const address = useAccount();

  const currentChainId = useNetworkManager();

  useEffect(() => {
    if (isTransitioning) {
      const timer = setTimeout(() => {
        setIsTransitioning(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isTransitioning]);

  const handleTabChange = (value: string) => {
    setIsTransitioning(true);
  };

  return (
    <>
      <Tabs
        defaultValue="moneyMarket"
        className="w-full max-w-5xl"
        onValueChange={handleTabChange}
      >
        <div className="flex justify-center w-full">
          <TabsList className="flex justify-center gap-4 m-4">
            <TabsTriggerAlt value="moneyMarket">
              <Button
                size="lg"
                className="flex items-center gap-2 w-full"
                variant="charly"
                tabValue="moneyMarket"
                storeType="tab"
              >
                Money Markets 🏦
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
                Payments 💸
              </Button>
            </TabsTriggerAlt>
            <TabsTriggerAlt value="tokenSwap">
              <Button
                size="lg"
                className="flex items-center gap-2 w-full"
                variant="charly"
                tabValue="tokenSwap"
                storeType="tab"
              >
                CCIP USDC Bridge 🔄
              </Button>
            </TabsTriggerAlt>
          </TabsList>
        </div>
        {/* <div>
          <PaymentLinkTabContent
            translations={translations}
            address={address?.address ?? ""}
          />
        </div> */}

        <div className="p-10 overflow-hidden flex flex-col items-center justify-center w-full">
          <div className="relative flex flex-col items-center justify-center w-full h-full">
            <div
              className={`relative z-1 text-center bg-background dark:bg-background rounded-lg shadow-lg px-8 py-4 w-full border-2 border-black dark:border-white transition-all duration-300 ease-in-out ${
                activeTab === "paymentLink"
                  ? "max-w-xl"
                  : activeTab === "tokenSwap"
                  ? "max-w-xl"
                  : "max-w-5xl"
              }`}
            >
              {isTransitioning ? (
                <>money market</>
              ) : (
                <>
                  <TabsContent
                    value="moneyMarket"
                    className="transition-opacity duration-300 ease-in-out flex-grow"
                  >
                      <Suspense fallback={<MoneyMarketBentoSkeleton />}>
                        <MoneyMarketBentoGrid />
                      </Suspense>
                  </TabsContent>
                  <TabsContent
                    value="paymentLink"
                    className="transition-opacity duration-300 ease-in-out"
                  >
                    <Suspense fallback={<PaymentLinkSkeleton />}>
                      <PaymentLinkTabContent
                        translations={translations}
                        address={address?.address ?? ""}
                      />
                    </Suspense>
                  </TabsContent>
                  <TabsContent
                    value="tokenSwap"
                    className="transition-opacity duration-300 ease-in-out"
                  >
                    {/* <Suspense fallback={<TokenSwapSkeleton />}>
                      <TokenSwap />
                    </Suspense> */}
                  </TabsContent>
                </>
              )}
            </div>
          </div>
        </div>
      </Tabs>
    </>
  );
};
