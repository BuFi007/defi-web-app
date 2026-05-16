import { Button } from "@/components/ui/button";
import { CopyIcon, ChevronRightIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { TransactionDetailsDisplayProps } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import FramedQRCode from "@/components/qr-gen/framed-qr-art";
import { getBlockExplorerUrlByChainId } from "@/utils";
import { Suspense } from "react";
import { useNetworkStore } from "@/store";
import { useAppTranslations } from "@/context/TranslationContext";

export default function TransactionDetailsDisplay({
  transactionDetails,
  chainId,
  handleCopy,
  handleShare,
  truncateHash,
}: TransactionDetailsDisplayProps) {
  const { currentChainId } = useNetworkStore();

  const translations = useAppTranslations("Overlay");
  const paymentLink = Array.isArray(transactionDetails?.paymentLink)
    ? transactionDetails.paymentLink[0]
    : transactionDetails?.paymentLink;

  const isValidPaymentLink = Boolean(
    paymentLink && typeof paymentLink === "string" && paymentLink.length > 0
  );

  const explorerBaseUrl = currentChainId
    ? getBlockExplorerUrlByChainId(Number(currentChainId))
    : "";
  const explorerUrl = explorerBaseUrl
    ? `${explorerBaseUrl}/tx/${transactionDetails?.transactionHash}`
    : `https://etherscan.io/tx/${transactionDetails?.transactionHash}`;

  return (
    <>
      <div className="flex w-full flex-col justify-between rounded-2xl border bg-white p-5">
        {/* QR Code Section */}
        <div className="flex justify-center">
          {isValidPaymentLink ? (
            <Suspense fallback={<Skeleton className="w-32 h-32" />}>
              <FramedQRCode
                image="/images/iso-logo.png"
                link={paymentLink}
                frameText={translations.frameText}
                copyLink={() =>
                  handleCopy(paymentLink, translations.linkSubtitle)
                }
              />
            </Suspense>
          ) : (
            <div className="w-32 h-32 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
            </div>
          )}
        </div>

        {/* Copy Link Button */}
        <div className="flex justify-center items-center mb-2 mt-2">
          <Button
            size={"lg"}
            className="flex items-center gap-2"
            onClick={() => handleCopy(paymentLink, "Payment Link")}
          >
            {translations.linkCopied}
            <CopyIcon className="size-4" />
          </Button>
        </div>

        <div className="flex justify-center text-xs text-primary my-2">
          {translations.linkDescription}
        </div>

        {/* Share Buttons */}
        <div className="flex justify-center gap-4 mb-4 mx-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!isValidPaymentLink}
            onClick={() => handleShare("whatsapp")}
            className="text-xs px-4"
          >
            <Image
              src="/icons/whatsapp.svg"
              alt="WhatsApp"
              width={24}
              height={24}
            />
            {translations.shareWhatsapp}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isValidPaymentLink}
            onClick={() => handleShare("telegram")}
            className="text-xs px-4"
          >
            <Image
              src="/icons/telegram.png"
              alt="Telegram"
              width={24}
              height={24}
            />
            {translations.shareTelegram}
          </Button>
        </div>

        {/* Transaction Hash and Block Explorer Link */}
        {transactionDetails?.transactionHash && (
          <div className="mt-2 flex h-16 items-center border-t text-xs">
            <div className="mx-5 flex w-full items-center justify-between">
              <div className="flex flex-col">
                <span className="font-semibold flex items-center">
                  {translations.hashTxText}:
                </span>
                <Button
                  size="sm"
                  variant="link"
                  onClick={() =>
                    handleCopy(
                      transactionDetails.transactionHash,
                      translations.hashTxText
                    )
                  }
                >
                  {truncateHash(transactionDetails.transactionHash)}
                </Button>
              </div>
              {chainId && (
                <div className="flex items-center">
                  <Link href={explorerUrl} target="_blank">
                    <Button size="sm" variant="ghost" className="px-2">
                      {translations.viewInExplorer}
                      <ChevronRightIcon className="ml-1 size-4" />
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
