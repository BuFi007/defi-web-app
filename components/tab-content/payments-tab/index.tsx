"use client";

import React, { Suspense } from "react";
import { Translations } from "@/lib/types";
import PaymentLink from "./send";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTriggerRight,
} from "@/components/ui/tabs";
import { BaseNameDialogAlert } from "@/components/ens-alert-dialog";
import PaymentCardSkeleton from "@/components/ui/skeleton/index";
import { AddressProps } from "@/lib/types";
import { useAppTranslations } from "@/context/TranslationContext";
import { LiFiSwap } from "@/components/lifi-swap";

export const PaymentLinkTabContent: React.FC<AddressProps> = ({
  address,
}) => {
  const translations = useAppTranslations('Home');
  return (
    <>
      <BaseNameDialogAlert address={address} />
      <Tabs defaultValue={"send-payment"} className="w-full">
        <TabsList className="grid w-full grid-cols-2 mt-1">
          <TabsTriggerRight value="send-payment" position="left">
            👽 {translations.sendPaymentTab} 🛸
          </TabsTriggerRight>
          <TabsTriggerRight value="payment-link" position="right">
            🥜 {translations.paymentLinksTab} 🔗
          </TabsTriggerRight>
        </TabsList>
        <TabsContent value="send-payment">
          <Suspense fallback={<PaymentCardSkeleton />}>
            <LiFiSwap />
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
