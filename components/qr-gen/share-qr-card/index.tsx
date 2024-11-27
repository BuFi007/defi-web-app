import React, { useRef, useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EnhancedQRCode } from "@/components/qr-gen/enhanced-qr-art";
import { TelegramShareInstructions } from "@/components/qr-gen/share-qr-card/telegram-share-instructions";
import { ShareButton } from "@/components/qr-gen/share-qr-button";
import { useQRCodeSharing } from "@/hooks/use-qr-code-sharing";
import { X, CopyIcon } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLocale } from "next-intl";
import { NEXT_PUBLIC_URL } from "@/constants";
import CurrencyDisplayer from "@/components/currency";
import { Token } from "@/lib/types";

interface ShareableQRCardProps {
  link: string;
  title: string;
  image: string;
  frameText?: string;
  shareMessage: string;
  onCopy: () => void;
  handleToggleOverlay: () => void;
  action: 'pay' | 'request';
  amount?: string;
  ensName?: string;
  userAddress?: string;
  availableTokens: Token[];
  currentNetwork: number;
}

const ShareableQRCard = ({
  link,
  title,
  image,
  frameText,
  shareMessage,
  onCopy,
  handleToggleOverlay,
  action,
  amount: initialAmount,
  ensName,
  userAddress,
  availableTokens,
  currentNetwork
}: ShareableQRCardProps) => {
  const qrCodeRef = useRef(null);
  const { isSharing, shareOnWhatsApp, shareOnTelegram } = useQRCodeSharing();
  const [showTelegramInstructions, setShowTelegramInstructions] = useState(false);
  const locale = useLocale();
  const supportedLocales = ["en", "es", "pt"];
  
  const [amount, setAmount] = useState(initialAmount ? parseFloat(initialAmount) : 0);
  const [selectedToken, setSelectedToken] = useState(availableTokens?.[0] || null);
  const [paymentLink, setPaymentLink] = useState(link);

  const getLocalizedLink = (url: string) => {
    try {
      const urlObj = new URL(url, NEXT_PUBLIC_URL);
      const pathSegments = urlObj.pathname.split("/").filter(segment => segment);

      if (pathSegments.length > 0 && supportedLocales.includes(pathSegments[0])) {
        return urlObj.toString();
      }
      urlObj.pathname = `/${locale}/${urlObj.pathname}`.replace("//", "/");
      return urlObj.toString();
    } catch (error) {
      console.error("Invalid URL provided to ShareableQRCard:", url);
      return url;
    }
  };

  const updatePaymentLink = useEffect(() => {
    if (action === 'pay') {
      const baseLink = getLocalizedLink(link);
      const url = new URL(baseLink);
      
      // Add payment parameters with proper formatting
      if (amount > 0) {
        url.searchParams.set('amount', amount.toFixed(6));
      }
      if (selectedToken) {
        url.searchParams.set('token', selectedToken.symbol);
        if (selectedToken.address) {
          url.searchParams.set('tokenAddress', selectedToken.address);
        }
      }
      url.searchParams.set('chain', currentNetwork.toString());
      url.searchParams.set('action', action);
      
      setPaymentLink(url.toString());
    } else {
      setPaymentLink(getLocalizedLink(link));
    }
  }, [amount, selectedToken, currentNetwork, action, link, locale]);

  const handleAmountChange = (newAmount: number) => {
    setAmount(newAmount);
  };

  const handleTokenSelect = (token: Token) => {
    setSelectedToken(token);
  };

  const getDisplayLink = (url: string) => {
    const maxLength = 30;
    const strippedLink = url.replace(/^https?:\/\//, "");
    return strippedLink.length > maxLength
      ? `${strippedLink.slice(0, maxLength)}...`
      : strippedLink;
  };

  const handleShare = (platform: string) => {
    if (qrCodeRef.current) {
      const shareOptions = { link: paymentLink, message: shareMessage };
      if (platform === 'whatsapp') {
        shareOnWhatsApp(qrCodeRef.current, shareOptions);
      } else {
        shareOnTelegram(qrCodeRef.current, shareOptions);
        setShowTelegramInstructions(true);
      }
    }
  };


  console.log("selectedToken", selectedToken); 
  console.log("availableTokens", availableTokens);

  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
      <Card className="relative bg-white dark:bg-secondaryBlack p-6 rounded-lg shadow-lg max-w-7xl w-full">
        <button
          onClick={handleToggleOverlay}
          className="absolute right-4 top-4 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
        >
          <X className="h-6 w-6" />
        </button>

        <CardHeader>
          <CardTitle className="text-lg font-semibold mb-4 text-center">
            {title}
          </CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col items-center space-y-4">
          {action === 'pay' && (
            <CurrencyDisplayer
              tokenAmount={amount}
              onValueChange={handleAmountChange}
              initialAmount={amount}
              availableTokens={availableTokens}
              onTokenSelect={handleTokenSelect}
              currentNetwork={currentNetwork}
            />
          )}
          
          <div ref={qrCodeRef}>
            <EnhancedQRCode
              link={paymentLink}
              image={image}
              frameText={frameText}
              action={action}
              copyLink={onCopy}
              amount={amount.toString()}
              ensName={ensName}
              userAddress={userAddress}
              token={selectedToken?.symbol || ""}
            />
          </div>

          <div className="flex items-center justify-center w-full mb-4">
            <input
              type="text"
              value={getDisplayLink(paymentLink)}
              readOnly
              className="flex-grow border text-center justify-center border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800"
              aria-label="Payment Link"
              onClick={onCopy}
            />
            <Button
              onClick={onCopy}
              variant="outline"
              className="border border-gray-300 dark:border-gray-600"
              aria-label="Copy Link"
            >
              <CopyIcon className="h-4 w-4" />
            </Button>
          </div>

          <TooltipProvider>
            <div className="flex justify-center gap-4 w-full">
              <Tooltip>
                <TooltipTrigger asChild>
                  <ShareButton
                    onClick={() => handleShare('whatsapp')}
                    platform="whatsapp"
                    isSharing={isSharing}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Share on WhatsApp</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <ShareButton
                    onClick={() => handleShare('telegram')}
                    platform="telegram"
                    isSharing={isSharing}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Share on Telegram</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </CardContent>
      </Card>
      
      <TelegramShareInstructions
        isOpen={showTelegramInstructions}
        onClose={() => setShowTelegramInstructions(false)}
      />
    </div>
  );
};

export default ShareableQRCard;