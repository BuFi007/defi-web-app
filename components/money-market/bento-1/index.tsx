"use client";

import { Suspense, useState, useEffect } from "react";
import {
  Tabs,
  TabsContent,
  TabsTriggerAlt,
  TabsList,
} from "@/components/ui/tabs";
import CardSkeleton from "@/components/ui/card-skeleton";
import { Button } from "@/components/ui/button";
import { useMarketStore } from "@/store";
import { MoneyMarketCard } from "@/components/money-market/bento-1/card/index";
import { TokenChip } from "@/components/token-chip";
import { useUsdcChain } from "@/hooks/use-usdc-chain";
import { useNetworkManager } from "@/hooks/use-dynamic-network";
import { useAppTranslations } from "@/context/TranslationContext";

function LendBorrowActionCard() {
  const { currentViewTab, setCurrentViewTab } = useMarketStore();
  const chainId = useNetworkManager();
  // const [usdcToken, setUsdcToken] = useState<Token | null>(null);
  const handleTabChange = (tab: "lend" | "borrow" | "withdraw" | "repay") => {
    setCurrentViewTab(tab);
  };

  const token = useUsdcChain();
  console.log(token, "token");
  const translations = useAppTranslations('MoneyMarketBento1');

  return (
    <Tabs
      defaultValue="lend"
      value={currentViewTab}
      onValueChange={(value: string) =>
        handleTabChange(value as "lend" | "borrow" | "withdraw" | "repay")
      }
      className="flex w-full flex-col mb-2 gap-2 uppercase z-10"
    >
      <div className="flex justify-start items-center w-full">
        <TabsList stackBehavior="stacked-2" className="gap-2 flex-grow justify-start">
          <TabsTriggerAlt value="lend">
            <Button size="sm" variant="paez" tabValue="lend" storeType="market">
              {translations.tabLend}
            </Button>
          </TabsTriggerAlt>
          <TabsTriggerAlt value="borrow">
            <Button
              size="sm"
              variant="paez"
              tabValue="borrow"
              storeType="market"
            >
              {translations.tabBorrow}
            </Button>
          </TabsTriggerAlt>
          <TabsTriggerAlt value="withdraw">
            <Button
              size="sm"
              variant="paez"
              tabValue="withdraw"
              storeType="market"
            >
              {translations.tabWithdraw}
            </Button>
          </TabsTriggerAlt>
          <TabsTriggerAlt value="repay">
            <Button
              size="sm"
              variant="paez"
              tabValue="repay"
              storeType="market"
            >
              {translations.tabRepay}
            </Button>
          </TabsTriggerAlt>
        </TabsList>
        <div className="ml-auto">
          <TokenChip token={token!} />
        </div>
      </div>
      <TabsContent value={currentViewTab} className="flex-col flex-1">
        <MoneyMarketCard />
      </TabsContent>
    </Tabs>
  );
}

export default function MoneyMarketTabContent() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <LendBorrowActionCard />
    </Suspense>
  );
}
