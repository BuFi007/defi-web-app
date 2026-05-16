"use client";

import React, { useEffect, useState } from "react";
import { useMarketStore } from "@/store";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAccount } from "wagmi";
import { base } from "viem/chains";
import { useEnsName } from "@/hooks/use-ens-name";
import { truncateAddress } from "@/utils";
import { useBlockchain } from "@/context/BlockchainContext";
import { allTokens } from "@/constants/Tokens";
import { calculateAPY } from "@/utils";
import { ethers } from "ethers";
const PositionSummary: React.FC = () => {
  const currentViewTab = useMarketStore((state) => state.currentViewTab);
  const address = useAccount();
  const { positions, moneyMarketData, isLoadingPositions } = useBlockchain();

  const cleanPositions = positions.map((position) => {
    const token = allTokens.find((token) => token.address === position.asset);
    return {
      asset: token?.name,
      amount:
        currentViewTab === "lend" ? position.deposited : position.borrowed,
      value: currentViewTab === "lend" ? position.deposit : position.borrow,
      apy: position.apy,
      collateralizationRatioBorrow: position.collateralizationRatioBorrow,
      collateralizationRatioDeposit: position.collateralizationRatioDeposit,
    };
  });

  const { ensName } = useEnsName({
    address: address.address as `0x${string}`,
    chain: base,
  });

  const renderSkeleton = () => (
    <div
      className={cn("rounded-lg shadow p-2 space-y-2 text-xs bg-background")}
    >
      <div className="flex justify-between items-center">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-20 w-full" />
    </div>
  );

  if (isLoadingPositions) {
    return renderSkeleton();
  }

  return (
    <div
      className={cn("rounded-lg shadow p-4 space-y-4 text-xs bg-background")}
    >
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-medium">
          Your {currentViewTab.toUpperCase()} Positions
        </h2>
        {ensName && (
          <span className="text-xs text-muted-foreground">
            {truncateAddress(ensName)}
          </span>
        )}
      </div>

      {isLoadingPositions ? (
        <div className="text-center py-8 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <p className="text-gray-500">No positions</p>
        </div>
      ) : (
        <ScrollArea className="h-24s w-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Asset</TableHead>
                <TableHead className="text-xs text-right">Amount</TableHead>
                <TableHead className="text-xs text-right">Value</TableHead>
                <TableHead className="text-xs text-right">APY</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {cleanPositions?.map((position) => (
                <TableRow key={position.asset}>
                  <TableCell className="text-xs font-medium">
                    {position.asset || "0"}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    {ethers.utils
                      .formatEther(position?.amount?.toString())
                      .substring(0, 8)}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    ${"  "}
                    {position?.asset === "USDC"
                      ? position?.amount?.toString().substring(0, 6)
                      : position?.amount?.toString().substring(0, 6) * 20}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    {calculateAPY(
                      position.asset === moneyMarketData[0].asset
                        ? moneyMarketData[0]
                        : moneyMarketData[1]
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}

      {/* {positions.length > 0 && (
        <>
          <Separator />
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">Total Value</span>
            <span className="text-sm font-bold">
              ${positions.reduce((sum, pos) => sum + pos.value, 0).toFixed(2)}
            </span>
          </div>
        </>
      )} */}
    </div>
  );
};

export default PositionSummary;
