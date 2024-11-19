"use client";

import React, { Suspense } from "react";
import { Translations } from "@/lib/types";
import PaymentLink from "./send";
import SendPayment from "@/components/tab-content/peanut-tab/send";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTriggerRight,
} from "@/components/ui/tabs";
import { BaseNameDialogAlert } from "@/components/ens-alert-dialog";
import PaymentCardSkeleton from "@/components/ui/skeleton/index";
import TokenSwap from "./ccip";
interface HomeContentProps {
  translations: Translations["Home"];
  address: string;
}

export const PaymentLinkTabContent: React.FC<HomeContentProps> = ({
  translations,
  address,
}) => {
  return (
    <>
      <BaseNameDialogAlert translations={translations} address={address} />
      <Tabs defaultValue={"send-payment"} className="w-full">
        <TabsList className="grid w-full grid-cols-2 mt-1">
          <TabsTriggerRight value="send-payment" position="left">
            👽 Send Payment 🛸
          </TabsTriggerRight>
          <TabsTriggerRight value="payment-link" position="right">
            🥜 Payment Links 🔗
          </TabsTriggerRight>
        </TabsList>
        <TabsContent value="send-payment">
          <Suspense fallback={<PaymentCardSkeleton />}>
            <TokenSwap />
          </Suspense>
        </TabsContent>
        <TabsContent value="payment-link">
          <Suspense fallback={<PaymentCardSkeleton />}>
            <PaymentLink />
          </Suspense>
        </TabsContent>
      </Tabs>
    </>
  );
};
