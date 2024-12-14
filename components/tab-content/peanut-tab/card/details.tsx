import React from "react";
import { ToastAction } from "@/components/ui/toast";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { getBlockExplorerUrlByChainId, playAudio } from "@/utils";
import { motion } from "framer-motion";
import { useToast } from "@/components/ui/use-toast";
import { Badge } from "@/components/ui/badge";
import Image from "next/image";
import { PaymentInfoProps } from "@/lib/types";
import { getChainInfoByChainId } from "../claim";
import * as Chains from "@/constants/Chains";

export const chainIdMapping = Object.values(Chains).reduce((map, chain) => {
  map[chain.chainId] = chain.vanityName || chain.name;
  return map;
}, {} as Record<number, string>);

export const chainIcons = Object.values(Chains).reduce((icons, chain) => {
  icons[chain.chainId] = chain.iconUrls[0];
  return icons;
}, {} as Record<number, string>);

const PaymentDetails: React.FC<PaymentInfoProps> = ({ paymentInfo }) => {
  const { toast } = useToast();

  const copyToClipboard = (link: string) => {
    navigator.clipboard.writeText(link);
    playAudio("/audio/click-coin.mp3");
  };

  const originChainInfo = getChainInfoByChainId(paymentInfo.chainId);
  const destinationChainInfo = paymentInfo.destinationChainId
    ? getChainInfoByChainId(paymentInfo.destinationChainId)
    : null;

  const handleCopy = (text: string, label: string) => {
    copyToClipboard(text.toLowerCase());
    toast({
      title: "Copied to clipboard!",
      description: `${label} has been copied to clipboard.`,
      action: <ToastAction altText="Spooky">👻</ToastAction>,
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="w-full max-w-md py-6 grid gap-6 border-t border-gray-200">
        <div className="flex items-center gap-4">
          <div className="bg-muted rounded-md flex items-center justify-center aspect-square w-12">
            <Image
              src={originChainInfo?.chainIcon || ""}
              width={24}
              height={24}
              priority
              alt={`${originChainInfo?.chainName || "Chain"} Logo`}
              className="aspect-square object-contain"
            />
          </div>
          <div className="flex-1">
            <h3 className="text-2xl font-semibold">
              {paymentInfo.tokenSymbol}
            </h3>
            <p className="text-muted-foreground text-xs">
              {originChainInfo?.chainName}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">{paymentInfo.tokenAmount} 👻</p>
          </div>
        </div>

        {paymentInfo.destinationChainId && (
          <div className="mt-4 flex items-center gap-2 text-xs">
            <div className="flex items-center">
              <Image
                src={destinationChainInfo?.chainIcon || ""}
                width={16}
                height={16}
                alt={`${destinationChainInfo?.chainName || "Chain"} Logo`}
                className="mr-2"
              />
              <span className="font-medium">
                {destinationChainInfo?.chainName}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              Destination Chain
            </span>
          </div>
        )}

        <div className="grid gap-2 text-xs">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground">Status:</p>
            <Badge
              className="text-xs"
              variant={paymentInfo.claimed ? "default" : "secondary"}
            >
              {paymentInfo.claimed ? "Claimed" : "Unclaimed"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground">Deposit Date:</p>
            <p className="font-medium text-sm">
              {new Date(paymentInfo.depositDate).toLocaleDateString()}
            </p>
          </div>
        </div>

        {paymentInfo.transactionHash && (
          <div className="flex justify-end">
            <Link
              href={`${getBlockExplorerUrlByChainId(
                Number(paymentInfo.chainId)
              )}/tx/${paymentInfo.transactionHash}`}
              className="text-sm text-primary hover:underline"
              target="_blank"
            >
              View in Blockscout
              <ChevronRightIcon className="inline-block ml-1 h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default PaymentDetails;
