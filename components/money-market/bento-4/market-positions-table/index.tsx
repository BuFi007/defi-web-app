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
import { useMarketData } from "@/components/blockchain-data";
import { useBlockchain } from "@/context/BlockchainContext";
import { allTokens } from "@/constants/Tokens";
interface Position {
  asset: string;
  amount: number;
  value: number;
  apy: number;
}

const PositionSummary: React.FC = () => {
  const currentViewTab = useMarketStore((state) => state.currentViewTab);
  const { fetchMarketData, loading } = useMarketData();

  useEffect(() => {
    console.log(loading, "loading");
    fetchMarketData();
  }, [loading]);

  const { positions } = useBlockchain();

  const cleanPositions = positions.map((position) => {
    const token = allTokens.find((token) => token.address === position.asset);
    return {
      asset: token?.name,
      amount:
        currentViewTab === "lend"
          ? position.deposited
          : position.borrowed
          ? position.borrowed
          : position.deposited,
      value: position.value,
      apy: position.apy,
    };
  });

  // const [positions, setPositions] = useState<Position[]>([]);
  const [error, setError] = useState<string | null>(null);
  const address = useAccount();
  const { ensName } = useEnsName({
    address: address.address as `0x${string}`,
    chain: base,
  });

  console.log(positions, "positions");

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

  if (loading) {
    return renderSkeleton();
  }

  if (error) {
    return <div className="text-xs text-red-500">{error}</div>;
  }

  return (
    <div
      className={cn("rounded-lg shadow p-4 space-y-4 text-xs bg-background")}
    >
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-medium">Your Positions</h2>
        {ensName && (
          <span className="text-xs text-muted-foreground">
            {truncateAddress(ensName)}
          </span>
        )}
      </div>

      {positions.length === 0 ? (
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
                    {position.asset}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    {position.amount}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    ${position.value}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    {/* {position.apy}% */}
                    10%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}

      {positions.length > 0 && (
        <>
          <Separator />
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">Total Value</span>
            <span className="text-sm font-bold">
              ${positions.reduce((sum, pos) => sum + pos.value, 0).toFixed(2)}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export default PositionSummary;
