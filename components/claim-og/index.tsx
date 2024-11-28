"use client";

import { useEffect, useState } from "react";
import ClaimInfo from "@/components/peanut/claim/claim";
import { useAppTranslations } from "@/context/TranslationContext";
import { useNetworkManager } from "@/hooks/use-dynamic-network";
import { ExtendedPaymentInfo, IGetLinkDetailsResponse } from "@/lib/types";
import { fetchLinkDetails } from "@/utils";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";

interface ClaimProps {
  params: { locale: string };
  searchParams: {
    v?: string;
    l?: string;
    chain?: string;
  };
}

export default function Claim({ params, searchParams }: ClaimProps) {
  const [details, setDetails] = useState<IGetLinkDetailsResponse | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<ExtendedPaymentInfo | null>(null);
  const { primaryWallet } = useDynamicContext();
  const translations = useAppTranslations("PeanutTab");
  const chainid = useNetworkManager();

  useEffect(() => {
    const url = `${window.location.origin}/claim?v=${searchParams.v}&l=${searchParams.l}&chain=${searchParams.chain}`;
    fetchLinkDetails(url, setDetails, setPaymentInfo, translations);
  }, [searchParams]);

  return (
    <main className="flex-1 flex flex-col h-screen p-10">
      <ClaimInfo
        details={details!}
        paymentInfo={paymentInfo!}
        setPaymentInfo={setPaymentInfo}
        isMultiChain={false}
        setIsMultiChain={() => {
          console.log("running");
        }}
        destinationChainId={chainid!?.toString() || ""}
        setDestinationChainId={() => {
          console.log("running");
        }}
      />
    </main>
  );
}