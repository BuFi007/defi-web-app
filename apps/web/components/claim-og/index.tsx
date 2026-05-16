"use client";

import { useEffect, useState } from "react";
import ClaimInfo from "@/components/peanut/claim/claim";
import { useAppTranslations } from "@/context/TranslationContext";
import { useNetworkManager } from "@/hooks/use-dynamic-network";
import { ExtendedPaymentInfo, IGetLinkDetailsResponse } from "@/lib/types";
import { fetchLinkDetails } from "@/utils";

export default function Claim() {
  const [details, setDetails] = useState<IGetLinkDetailsResponse | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<ExtendedPaymentInfo | null>(
    null
  );
  const translations = useAppTranslations("PeanutTab");

  const queryString = window.location.href;

  useEffect(() => {
    fetchLinkDetails(queryString, setDetails, setPaymentInfo, translations);
  }, [queryString]);

  return (
    <main className="flex-1 flex flex-col h-screen p-10">
      <ClaimInfo
        details={details!}
        paymentInfo={paymentInfo!}
        setPaymentInfo={setPaymentInfo}
        setDestinationChainId={() => {
          console.log("running");
        }}
      />
    </main>
  );
}
