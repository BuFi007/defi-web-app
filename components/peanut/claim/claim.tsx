"use client";
import React, { useState } from "react";
import PaymentDetails from "../../tab-content/peanut-tab/card/details";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ExtendedPaymentInfo, IGetLinkDetailsResponse } from "@/lib/types";
import NetworkSelector from "@/components/network-selector";
import { useAppTranslations } from "@/context/TranslationContext";
import { Button } from "@/components/ui/button";
import { usePeanut } from "@/hooks/use-peanut";
import { useDestinationToken } from "@/hooks/use-destination-chain";
import { getChainInfoByChainId } from "@/components/tab-content/peanut-tab/claim";
import { toast } from "@/components/ui/use-toast";

export default function ClaimInfo({
  paymentInfo,
  setPaymentInfo,
  isMultiChain,
  setIsMultiChain,
  destinationChainId,
  setDestinationChainId,
  details,
}: {
  paymentInfo: ExtendedPaymentInfo;
  setPaymentInfo: (paymentInfo: ExtendedPaymentInfo | null) => void;
  isMultiChain: boolean;
  setIsMultiChain: (isMultiChain: boolean) => void;
  destinationChainId: string;
  setDestinationChainId: (destinationChainId: string) => void;
  details: IGetLinkDetailsResponse;
}) {
  const [inProgress, setInProgress] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [currentText, setCurrentText] = useState("");
  const [transactionDetails, setTransactionDetails] = useState<string | null>(
    null
  );
  const getDestinationTokenAddress = useDestinationToken();

  const {
    isLoading: isPeanutLoading,
    claimPayLinkXChain,
    claimPayLink,
  } = usePeanut();

  if (!paymentInfo) return null;

  const translations = useAppTranslations("PeanutTab");

  const handleClaim = async () => {
    setInProgress(true);
    setOverlayVisible(true);
    setCurrentText(translations.currentTextStartingClaim);

    if (paymentInfo?.claimed) {
      toast({
        title: translations.currentTextAlreadyClaimedTitle,
        description: translations.currentTextAlreadyClaimed,
      });
      setCurrentText(translations.currentTextAlreadyClaimed);
    } else if (paymentInfo && !destinationChainId) {
      try {
        setCurrentText(translations.currentTextClaiming);
        const txHash = await claimPayLink(
          details?.link || "",
          () => setCurrentText(translations.currentTextProgress),
          () => setCurrentText(translations.currentTextClaimSuccess),
          (error: Error) => setCurrentText(`Error: ${error.message}`),
          () => setCurrentText(translations.currentTextClaimComplete)
        );
        setTransactionDetails(txHash);
        setPaymentInfo({
          ...paymentInfo,
          transactionHash: txHash,
          claimed: true,
        });
      } catch (error) {
        console.error("Error claiming payment link:", error);
        setInProgress(false);
        setOverlayVisible(false);
        setCurrentText(translations.currentTextClaimError);
      }
    } else if (paymentInfo && destinationChainId) {
      try {
        const sourceChainInfo = getChainInfoByChainId(paymentInfo.chainId);
        const isMainnet = sourceChainInfo.isMainnet;

        setCurrentText(translations.currentTextCrossChainProgress);

        const destinationToken = await getDestinationTokenAddress(
          paymentInfo.tokenSymbol,
          destinationChainId
        );

        const txHash = await claimPayLinkXChain(
          details?.link || "",
          destinationChainId,
          destinationToken,
          () => setCurrentText(translations.currentTextCrossChainProgress),
          () => setCurrentText(translations.currentTextCrossChainSuccess),
          (error: Error) => setCurrentText(`Error: ${error.message}`),
          () => setCurrentText(translations.currentTextCrossChainComplete),
          isMainnet
        );
        setTransactionDetails(txHash);
        setPaymentInfo({
          ...paymentInfo,
          transactionHash: txHash,
          claimed: true,
        });
      } catch (error) {
        console.error("Error claiming cross-chain payment link:", error);
        setInProgress(false);
        setOverlayVisible(false);
        setCurrentText(translations.currentTextCrossChainError);
      }
    }
  };
  return (
    <section className="flex w-full h-auto flex-col justify-between rounded-2xl border bg-background p-5">
      <div className="flex w-full md:h-[200px] lg:h-[300px] flex-col justify-between rounded-2xl">
        <div className="p-5">
          <div className="flex items-center justify-between text-xs w-full">
            <span className="text-xl">💸👻💸</span>
            <span>{translations.claimTitle}</span>
          </div>
          <div className="text-center flex py-2 w-full justify-center">
            {paymentInfo && (
              <>
                <PaymentDetails paymentInfo={paymentInfo} />
              </>
            )}
          </div>
        </div>
      </div>

      {!paymentInfo?.claimed && (
        <div className="flex items-center justify-end p-4 space-x-2">
          <Switch
            id="multi-chain-link"
            checked={isMultiChain}
            onCheckedChange={() => setIsMultiChain(!isMultiChain)}
          />
          <Label htmlFor="multi-chain-link" className="text-xs">
            Multi-Chain
          </Label>
        </div>
      )}
      <div className="flex items-center justify-center p-4 space-x-2">
        {isMultiChain && !paymentInfo?.claimed && (
          <NetworkSelector
            currentChainId={paymentInfo?.chainId.toString() || ""}
            destinationChainId={destinationChainId}
            onSelect={(selectedChainId: string) => {
              const numericChainId = Number(selectedChainId);
              if (isNaN(numericChainId)) return;
              setDestinationChainId(selectedChainId);
            }}
          />
        )}
      </div>

      <div className="flex items-center justify-center p-4 space-x-2">
        <Button
          size={"lg"}
          className="mt-5 flex items-center gap-2 self-end w-full"
          onClick={handleClaim}
          variant={"fito"}
          disabled={paymentInfo.claimed || isPeanutLoading}
        >
          {translations.claimClaim}
          <span className="text-xl"> 👻</span>
        </Button>
      </div>
    </section>
  );
}
