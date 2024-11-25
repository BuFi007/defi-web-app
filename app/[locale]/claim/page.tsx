"use client";
import GetClaim from "@/components/get-claim";
import ClaimForm from "@/components/tab-content/peanut-tab/claim";
import ClaimInfo from "@/components/tab-content/peanut-tab/modal/claim";
import { useSearchParams } from "next/navigation";
//import { getLinkDetails } from "@squirrel-labs/peanut-sdk";

export default function Claim() {
  const searchParams = useSearchParams();
  const links = searchParams.get("claim");
  console.log(links);
  return (
    <main className="flex-1 flex flex-col h-screen p-10">
      {/* <ClaimForm claimId={links!} /> */}

      <ClaimInfo
        paymentInfo={{ paymentInfo: {} }}
        isMultiChain={false}
        setIsMultiChain={() => {}}
        destinationChainId={""}
        setDestinationChainId={() => {}}
      />
    </main>
  );
}
