import React, { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EnhancedQRCode } from "@/components/qr-gen/enhanced-qr-art";
import { ShareButton } from "@/components/qr-gen/share-qr-button";
import { useQRCodeSharing } from "@/hooks/use-qr-code-sharing";
import { X, CopyIcon } from "lucide-react";
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
import { usePayLinkStore } from "@/store";

interface ShareableQRCardProps {
  link: string;
  title: string;
  image: string;
  frameText?: string;
  shareMessage: string;
  onCopy: () => void;
  handleToggleOverlay: () => void;
  action: "pay" | "request";
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
  amount,
  ensName,
  userAddress,
  availableTokens,
  currentNetwork,
}: ShareableQRCardProps) => {
  const qrCodeRef = useRef(null);

  const {setAmount, setToken, token } = usePayLinkStore();
  const { isSharing, shareOnWhatsApp, shareOnTelegram, shareOnDownload } = useQRCodeSharing();
  const locale = useLocale();
  const supportedLocales = ["en", "es", "pt"];


  const [paymentLink, setPaymentLink] = useState(link);
  console.log("Here is the token", token?.symbol);


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
      if (amount && parseFloat(amount) > 0) {
        url.searchParams.set('amount', amount);
      }
      if (token) {
        url.searchParams.set('token', token?.symbol);
        if (token.address) {
          url.searchParams.set('tokenAddress', token.address);
        }
      }
      url.searchParams.set('chain', currentNetwork.toString());
      url.searchParams.set('action', action);
      
      setPaymentLink(url.toString());
    } else {
      setPaymentLink(getLocalizedLink(link));
    }
  }, [amount, token, currentNetwork, action, link, locale]);

  const handleAmountChange = (newAmount: number) => {
    setAmount(newAmount.toString());
  };

  const handleTokenSelect = (token: Token) => {
    setToken(token);
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
      const shareOptions = { link: link, message: shareMessage };
      if (platform === "whatsapp") {
        shareOnWhatsApp(qrCodeRef.current, shareOptions);
      } else if (platform === "telegram") {
        shareOnTelegram(qrCodeRef.current, shareOptions);
      } else if (platform === 'download') {
        shareOnDownload(qrCodeRef.current);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
      <Card className="relative bg-white dark:bg-secondaryBlack p-6 rounded-lg shadow-lg max-w-3xl">
        <button
          onClick={handleToggleOverlay}
          className="absolute right-4 top-4 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
        >
          <X className="h-6 w-6" />
        </button>

        <CardContent className="flex flex-col items-center space-y-4">
          {action === "pay" && (
            <CurrencyDisplayer
              tokenAmount={amount ? parseFloat(amount) : 0}
              onValueChange={handleAmountChange}
              initialAmount={amount ? parseFloat(amount) : 0}
              availableTokens={availableTokens}
              onTokenSelect={handleTokenSelect}
              currentNetwork={currentNetwork}
              size="base"
              action={action}
            />
          )}

          <div ref={qrCodeRef}>
            <EnhancedQRCode
              link={link}
              image={image}
              title={title}
              frameText={frameText}
              action={action}
              copyLink={onCopy}
              amount={amount?.toString()}
              ensName={ensName}
              userAddress={userAddress}
              token={token?.symbol || ""}
            />
          </div>

          <div className="flex items-center justify-center w-full max-w-sm mb-4">
            <input
              type="text"
              value={getDisplayLink(link)}
              readOnly
              className="flex-grow border max-w-sm text-center justify-center border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800"
              aria-label="Payment Link"
              onClick={onCopy}
            />
            <Button
              onClick={onCopy}
              variant="outline"
              className="border border-gray-300 dark:border-gray-600 ml-2"
              aria-label="Copy Link"
            >
              <CopyIcon className="h-4 w-4" />
            </Button>
          </div>
          <div className="text-center text-xs text-gray-500">
            <p className="hover:underline hover:text-primary">
              {" "}
              Share this QR code to{" "}
              {action === "pay"
                ? `request a ${amount} ${token?.symbol} payment to`
                : "send payment as a link from"}{" "}
              your account{" "}
            </p>
          </div>

          <TooltipProvider>
            <div className="flex justify-center gap-4 w-full">
              <Tooltip>
                <TooltipTrigger asChild>
                  <ShareButton
                    onClick={() => handleShare("whatsapp")}
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
                    onClick={() => handleShare("telegram")}
                    platform="telegram"
                    isSharing={isSharing}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Share on Telegram</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <ShareButton
                    onClick={() => handleShare("download")}
                    platform="download"
                    isSharing={isSharing}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Download QR Code</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </CardContent>
      </Card>
    </div>
  );
};

export default ShareableQRCard;
