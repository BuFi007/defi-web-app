import React, { useState, ChangeEvent, useEffect } from "react";

import PaymentDetails from "../card/details";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

import { PaymentInfoProps } from "@/lib/types";
import NetworkSelector from "@/components/network-selector";

export default function ClaimInfo({
  paymentInfo,
  isMultiChain,
  setIsMultiChain,
  destinationChainId,
  setDestinationChainId,
}: {
  paymentInfo: PaymentInfoProps;
  isMultiChain: boolean;
  setIsMultiChain: (isMultiChain: boolean) => void;
  destinationChainId: string;
  setDestinationChainId: (destinationChainId: string) => void;
}) {
  return (
    <section className="flex w-full h-auto flex-col justify-between rounded-2xl border bg-background p-5">
      <div className="flex w-full md:h-[200px] lg:h-[300px] flex-col justify-between rounded-2xl">
        <div className="p-5">
          <div className="flex items-center justify-between text-xs w-full">
            <span className="text-xl">💸👻💸</span>
            <span>You are claiming</span>
          </div>
          <div className="text-center flex py-2 w-full justify-center">
            {paymentInfo && (
              <>
                <PaymentDetails paymentInfo={paymentInfo.paymentInfo} />
              </>
            )}
          </div>
        </div>
      </div>

      {!paymentInfo?.paymentInfo?.claimed && (
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
        {isMultiChain && !paymentInfo?.paymentInfo?.claimed && (
          <NetworkSelector
            currentChainId={paymentInfo?.paymentInfo?.chainId.toString() || ""}
            destinationChainId={destinationChainId}
            onSelect={(selectedChainId: string) => {
              const numericChainId = Number(selectedChainId);
              if (isNaN(numericChainId)) return;
              console.log(
                "Setting destination chain by numeric id:",
                numericChainId
              );
              console.log(
                "Setting destination chain by destination chain id:",
                destinationChainId
              );

              setDestinationChainId(selectedChainId);
            }}
          />
        )}
      </div>
    </section>
  );
}
