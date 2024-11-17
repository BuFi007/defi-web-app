import { useState, useMemo } from "react";
import { useDeezNuts } from "@/hooks/use-peanut";
import { useWindowSize } from "@/hooks/use-window-size";
import { useToast } from "@/components/ui/use-toast";
import LinkUiForm from "@/components/tab-content/peanut-tab/card";
import Overlay from "@/components/tab-content/peanut-tab/overlay";
import { Token, TransactionDetails } from "@/lib/types";
import confetti from "canvas-confetti";
import { useUsdcTokenChain } from "@/hooks/use-usdc-token-chain";
import { useGetTokensOrChain } from "@/hooks/use-tokens-or-chain";
import { useNetworkManager } from "@/hooks/use-dynamic-network";
import { useNetworkStore } from "@/store";

export default function LinkForm() {
  const { toast } = useToast();
  const currentChainId = useNetworkManager();
  console.log({ currentChainId: currentChainId });
  const chainId = currentChainId as number;
  console.log({ chainId: chainId });
  console.log({ currentChainId: currentChainId });
  const availableTokens = useGetTokensOrChain(chainId, "tokens");
  console.log({ availableTokens: availableTokens });

  const {
    createPayLink,
    isLoading: isPeanutLoading,
    copyToClipboard,
    truncateAddress,
  } = useDeezNuts();

  const [overlayVisible, setOverlayVisible] = useState(false);
  const [usdAmount, setUsdAmount] = useState<number>(0);
  const [tokenAmount, setTokenAmount] = useState<number>(0);
  const [transactionDetails, setTransactionDetails] =
    useState<TransactionDetails | null>(null);
  const [showSentTable, setShowSentTable] = useState(false);
  const [selectedToken, setSelectedToken] = useState<string>("");
  const [currentText, setCurrentText] = useState<string>("");
  const USDC = useUsdcTokenChain(chainId);

  const handleCreateLinkClick = async (
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.preventDefault();
    setOverlayVisible(true);

    try {
      // switchChain({ chainId: defaultChainId });
      console.log("Successfully switched to Base Sepolia network.");
    } catch (error) {
      console.error("Failed to switch network:", error);
      toast({
        title: "Network Switch Failed",
        description:
          "Please switch to the Base Sepolia network to create a payment link.",
        variant: "destructive",
      });
      setOverlayVisible(false);
      return;
    }

    try {
      const tokenAddress = selectedToken; /// token address ?
      if (!tokenAddress) {
        throw new Error(
          `Token ${selectedToken} is not supported on this network.`
        );
      }

      setCurrentText("In Progress...");
      console.log(
        "Calling createPayLink with tokenAmount:",
        tokenAmount,
        "and token:",
        selectedToken
      );

      const linkResponse = await createPayLink(
        tokenAmount.toString(),
        tokenAddress,
        chainId,
        () => setCurrentText("In Progress..."),
        () => setCurrentText("Success!"),
        (error: Error) => setCurrentText(`Failed: ${error.message}`),
        () => setCurrentText("Spooky Crypto Finance Made Easy!")
      );

      // Assuming linkResponse has the structure { paymentLink: string, transactionHash: string }
      setTransactionDetails(linkResponse as TransactionDetails);
      console.log("Payment link created successfully:", linkResponse);

      // Trigger confetti animation
      triggerConfetti("👻");
    } catch (error: any) {
      console.error("Error creating pay link:", error);
      toast({
        title: "Error Creating Pay Link",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setOverlayVisible(true);
      console.log("Overlay set to visible after link creation attempt.");
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
      title: "Copied to clipboard!",
      description: `${label} has been copied to clipboard.`,
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
