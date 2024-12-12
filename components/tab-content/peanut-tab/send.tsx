import { useState } from "react";
import { usePeanut } from "@/hooks/use-peanut";
import { useToast } from "@/components/ui/use-toast";
import LinkUiForm from "@/components/tab-content/peanut-tab/card";
import Overlay from "@/components/tab-content/peanut-tab/overlay";
import { Token, TransactionDetails } from "@/lib/types";
import confetti from "canvas-confetti";
import { useGetTokensOrChain } from "@/hooks/use-tokens-or-chain";
import { useNetworkManager } from "@/hooks/use-dynamic-network";
import { truncateAddress } from "@/utils";
import { useAppTranslations } from "@/context/TranslationContext";

export default function LinkForm() {
  const { toast } = useToast();
  const translations = useAppTranslations("Overlay");
  const currentChainId = useNetworkManager();
  const chainId = currentChainId as number;
  const availableTokens = useGetTokensOrChain(chainId, "tokens");
  console.log(availableTokens, "daksklasdlasdlasdlds");

  const {
    createPayLink,
    isLoading: isPeanutLoading,
    copyToClipboard,
  } = usePeanut();

  const [overlayVisible, setOverlayVisible] = useState(false);
  const [usdAmount, setUsdAmount] = useState<number>(0);
  const [tokenAmount, setTokenAmount] = useState<number>(0);
  const [transactionDetails, setTransactionDetails] =
    useState<TransactionDetails | null>(null);
  const [showSentTable, setShowSentTable] = useState(false);
  const [selectedToken, setSelectedToken] = useState<string>("");
  const [currentText, setCurrentText] = useState<string>("");

  const handleCreateLinkClick = async (
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.preventDefault();
    setOverlayVisible(true);

    try {
      const tokenAddress = selectedToken;
      setCurrentText(translations.currentTextProgress);

      const linkResponse = await createPayLink(
        tokenAmount.toString(),
        tokenAddress,
        () => setCurrentText(translations.currentTextProgress),
        () => setCurrentText(translations.currentTextSuccess),
        (error: Error) =>
          setCurrentText(`${translations.currentTextFailed} ${error.message}`),
        () => setCurrentText(translations.currentTextSpooky)
      );
      // Assuming linkResponse has the structure { paymentLink: string, transactionHash: string }
      if (linkResponse) {
        setTransactionDetails(linkResponse as TransactionDetails);

        console.log("Payment link created successfully:", linkResponse);

        triggerConfetti("👻");
      } else {
        setOverlayVisible(false);
      }
    } catch (error: any) {
      console.error("Error creating pay link:", error);
      setOverlayVisible(false);
      toast({
        title: `${translations.toastError}`,
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setOverlayVisible(true);
    }
  };

  const handleCloseOverlay = () => {
    setOverlayVisible(false);
  };

  const handleValueChange = (usdAmount: number, tokenAmount: number) => {
    setUsdAmount(usdAmount);
    setTokenAmount(tokenAmount);
  };

  const handleShare = (platform: string) => {
    const url = transactionDetails?.paymentLink;
    if (platform === "whatsapp") {
      window.open(
        `https://wa.me/?text=${encodeURIComponent(url || "")}`,
        "_blank"
      );
    } else if (platform === "telegram") {
      window.open(
        `https://t.me/share/url?url=${encodeURIComponent(url || "")}`,
        "_blank"
      );
    }
  };

  const handleCopy = (text: string, label: string) => {
    copyToClipboard(text);
    triggerConfetti("💸👻💸");

    toast({
      title: `${translations.toastCopyTitle}`,
      description: `${label} ${translations.toastCopyDescription}`,
    });
  };

  const triggerConfetti = (emoji: string) => {
    const scalar = 4;
    const confettiEmoji = confetti.shapeFromText({ text: emoji, scalar });

    const defaults = {
      spread: 360,
      ticks: 60,
      gravity: 0,
      decay: 0.96,
      startVelocity: 20,
      shapes: [confettiEmoji],
      scalar,
    };

    const shoot = () => {
      confetti({ ...defaults, particleCount: 30 });
      confetti({ ...defaults, particleCount: 5 });
      confetti({
        ...defaults,
        particleCount: 15,
        scalar: scalar / 2,
        shapes: ["circle"],
      });
    };

    setTimeout(shoot, 0);
    setTimeout(shoot, 100);
    setTimeout(shoot, 200);
  };

  return (
    <section className="mx-auto h-full flex flex-col items-center">
      <LinkUiForm
        tokenAmount={tokenAmount}
        handleValueChange={handleValueChange}
        availableTokens={availableTokens as Token[]}
        setSelectedToken={setSelectedToken}
        chainId={chainId}
        handleCreateLinkClick={handleCreateLinkClick}
        isPeanutLoading={isPeanutLoading}
      />
      {overlayVisible && (
        <Overlay
          handleCloseOverlay={handleCloseOverlay}
          currentText={currentText}
          transactionDetails={transactionDetails}
          chainId={chainId}
          handleCopy={handleCopy}
          handleShare={handleShare}
          truncateHash={truncateAddress}
        />
      )}
    </section>
  );
}
