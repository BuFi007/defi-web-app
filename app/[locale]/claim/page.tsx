"use client";
import ClaimInfo from "@/components/peanut/claim/claim";
import ClaimsDisplay from "@/components/peanut/get-links";
import { useAppTranslations } from "@/context/TranslationContext";
import { useNetworkManager } from "@/hooks/use-dynamic-network";
import { ExtendedPaymentInfo, IGetLinkDetailsResponse } from "@/lib/types";
import { fetchLinkDetails, getAllLinksFromLocalStorage } from "@/utils";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
//import { getLinkDetails } from "@squirrel-labs/peanut-sdk";

export default function Claim() {
  const [details, setDetails] = useState<IGetLinkDetailsResponse | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<ExtendedPaymentInfo | null>(
    null
  );
  const { primaryWallet } = useDynamicContext();
  const translations = useAppTranslations("PeanutTab");
  const chainid = useNetworkManager();
  const url = new URL(window.location.href);
  async function fetchPaymentInfo() {
    const paymentInfoo = await fetchLinkDetails(
      url.href,
      setDetails,
      setPaymentInfo,
      translations
    );
  }

  useEffect(() => {
    fetchPaymentInfo();
  }, []);

  const allLinks = localStorage.getItem(
    `${primaryWallet?.address} - created links`
  );

  console.log({ allLinks });

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
      <ClaimsDisplay />
    </main>
  );
}
