import React, { useState, ChangeEvent, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { usePeanut } from "@/hooks/use-peanut";
import PaymentDetails from "./card/details";
import confetti from "canvas-confetti";
import { toast } from "@/components/ui/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AnimatePresence, motion } from "framer-motion";
import { FadeText } from "@/components/magicui/fade-text";
import { ChevronRightIcon, XIcon } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { chainIdMapping, chainIcons } from "./card/details";
import { ExtendedPaymentInfo, IGetLinkDetailsResponse } from "@/lib/types";
import NetworkSelector from "@/components/network-selector";
import * as Chains from "@/constants/Chains";
import { useSwitchNetwork } from "@dynamic-labs/sdk-react-core";
import { fetchLinkDetails, getBlockExplorerUrlByChainId } from "@/utils";
import { useDestinationToken } from "@/hooks/use-destination-chain";
import { useAppTranslations } from "@/context/TranslationContext";

export function getChainInfoByChainId(chainId: number | string) {
  const id = Number(chainId);
  const chainName = chainIdMapping[id] || `Chain ${id}`;
  const chainIcon = chainIcons[id] || "";

  const isMainnet = Object.values(Chains).find(
    (chain) => chain.chainId === id
  )?.isMainnet;
  return {
    chainName,
    chainIcon,
    isMainnet,
  };
}

export default function ClaimForm({
  claimId: initialClaimId,
}: {
  claimId: string | undefined;
}) {
  const {
    claimPayLink,
    claimPayLinkXChain,
    isLoading: isPeanutLoading,
  } = usePeanut();

  const [overlayVisible, setOverlayVisible] = useState(false);
  const [transactionDetails, setTransactionDetails] = useState<string | null>(
    null
  );
  const [inputLink, setInputLink] = useState<string>("");
  const [paymentInfo, setPaymentInfo] = useState<ExtendedPaymentInfo | null>(
    null
  );
  const translations = useAppTranslations("PeanutTab");

  const getDestinationTokenAddress = useDestinationToken();

  const [inProgress, setInProgress] = useState(false);
  const [currentText, setCurrentText] = useState(translations.claimReady);
  const chains = Object.values(Chains).map((chain) => ({
    chainId: chain.chainId,
  }));

  const [destinationChainId, setDestinationChainId] = useState<string>("");
  const [details, setDetails] = useState<IGetLinkDetailsResponse | null>(null);
  const [isMultiChain, setIsMultiChain] = useState(false);
  const switchNetwork = useSwitchNetwork();

  useEffect(() => {
    if (initialClaimId) {
      fetchLinkDetails(
        initialClaimId,
        setDetails,
        setPaymentInfo,
        translations
      );
    }
  }, [initialClaimId]);

  useEffect(() => {
    if (paymentInfo?.claimed) {
      setOverlayVisible(true);
    }
  }, [paymentInfo?.claimed]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInputLink(e.target.value);
  };

  const handlePasteClick = async () => {
    const text = await navigator.clipboard.readText();
    setInputLink(text);
  };

  const handleVerify = () => {
    fetchLinkDetails(inputLink, setDetails, setPaymentInfo, translations);
  };

  const handleSuccess = async () => {
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });

    if (inputLink) {
      await fetchLinkDetails(
        inputLink,
        setDetails,
        setPaymentInfo,
        translations
      );
    }

    setOverlayVisible(true);
    setInProgress(false);
  };

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
        setPaymentInfo((prevInfo) =>
          prevInfo
            ? { ...prevInfo, transactionHash: txHash, claimed: true }
            : null
        );
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
        setPaymentInfo((prevInfo) =>
          prevInfo
            ? { ...prevInfo, transactionHash: txHash, claimed: true }
            : null
        );
      } catch (error) {
        console.error("Error claiming cross-chain payment link:", error);
        setInProgress(false);
        setOverlayVisible(false);
        setCurrentText(translations.currentTextCrossChainError);
      }
    }
  };

  const handleCloseOverlay = () => {
    setOverlayVisible(false);
    setInProgress(false);
  };

  const renderClaimInfo = () => (
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
          {/* //add info icon explaining what this is */}
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
    </section>
  );

  const renderInputForm = () => (
    <div className="flex w-full h-auto flex-col justify-between rounded-2xl border bg-background p-5">
      <div className="flex w-full md:h-[200px] lg:h-[300px] flex-col mb-5">
        <label
          htmlFor="claimLink"
          className="text-xs font-semibold font-aeonik"
        >
          {translations.claimDescription}
        </label>
        <div className="flex">
          <input
            type="text"
            id="claimLink"
            value={inputLink}
            onChange={handleInputChange}
            className="mt-1 rounded border px-3 py-2 flex-grow"
          />
          <Button onClick={handlePasteClick} className="ml-2">
            {translations.claimPaste}
          </Button>
        </div>
      </div>
      <Button
        size={"lg"}
        onClick={handleVerify}
        className="mt-5 flex items-center gap-2 self-end w-full"
        variant={"fito"}
      >
        {translations.claimVerify} <span className="text-xl"> 🍸</span>
      </Button>
    </div>
  );

  return (
    <section className="mx-auto h-full flex flex-col items-center">
      {paymentInfo ? renderClaimInfo() : renderInputForm()}
      {paymentInfo && (
        <>
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
        </>
      )}
      {overlayVisible && (
        <div className="animate-in fade-in-0 fixed inset-0 z-40 bg-white/90">
          <div className="relative flex size-full items-center justify-center">
            <button
              className="absolute right-4 top-4"
              onClick={handleCloseOverlay}
            >
              <XIcon className="size-6" />
            </button>
            <div className="flex flex-col items-center gap-10">
              <AnimatePresence mode="wait">
                <FadeText
                  key={currentText}
                  className="text-4xl font-bold text-black dark:text-white"
                  direction="up"
                  framerProps={{
                    show: { transition: { delay: 0.2 } },
                  }}
                  text={currentText}
                />
              </AnimatePresence>
              {!paymentInfo?.claimed && isPeanutLoading ? (
                <div role="status">
                  <svg
                    aria-hidden="true"
                    className="size-8 animate-spin fill-neutral-600 text-neutral-200 dark:text-neutral-600"
                    viewBox="0 0 100 101"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                      fill="currentColor"
                    />
                    <path
                      d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                      fill="currentFill"
                    />
                  </svg>
                  <span className="sr-only">Loading...</span>
                </div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 1 }}
                >
                  <div className="flex w-full flex-col justify-between rounded-2xl border bg-white">
                    <div className="p-5">
                      <div className="flex items-center text-xs">
                        <span>{translations.claimSuccessTitle}</span>
                      </div>
                      <div className="p-5">
                        {paymentInfo && (
                          <>
                            <PaymentDetails paymentInfo={paymentInfo} />
                            <div className="mt-5 flex h-16 items-center border-t text-xs">
                              <div className="flex w-full items-center justify-between mt-5 ">
                                {isMultiChain && destinationChainId && (
                                  <div className="flex flex-row">
                                    {destinationChainId && (
                                      <div className="flex items-center gap-4">
                                        <div className="bg-muted rounded-md flex items-center justify-center aspect-square w-12">
                                          <Image
                                            src={
                                              getChainInfoByChainId(
                                                Number(destinationChainId)
                                              ).chainIcon
                                            }
                                            className="aspect-square object-contain"
                                            width={24}
                                            height={24}
                                            priority
                                            alt={`${
                                              getChainInfoByChainId(
                                                Number(destinationChainId)
                                              ).chainName
                                            } Logo`}
                                          />
                                        </div>
                                        <div className="flex-1">
                                          <p className="text-muted-foreground text-xs">
                                            {translations.claimDestinationChain}
                                          </p>

                                          <h3 className="text-2xl font-semibold">
                                            {" "}
                                            {
                                              getChainInfoByChainId(
                                                Number(destinationChainId)
                                              ).chainName
                                            }
                                          </h3>
                                        </div>
                                        <div className="flex items-center justify-between mt-5">
                                          <p className="text-xs font-bold hover:underline hover:text-primary">
                                            <Link
                                              href={`${getBlockExplorerUrlByChainId(
                                                paymentInfo?.chainId as number
                                              )}/tx/${transactionDetails}`}
                                              target="_blank"
                                              className="flex items-center"
                                            >
                                              <span>
                                                {
                                                  translations.claimViewInExplorer
                                                }
                                              </span>
                                              <ChevronRightIcon className="size-4" />
                                            </Link>
                                          </p>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
