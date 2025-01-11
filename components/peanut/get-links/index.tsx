"use client";

import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { Suspense, useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, CopyIcon } from "lucide-react";
import { useGetTokensOrChain } from "@/hooks/use-tokens-or-chain";
import { Chain } from "@/lib/types";
import Image from "next/image";
import { TokenChip } from "@/components/token-chip";
import { allTokens } from "@/constants/Tokens";
import Link from "next/link";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePeanut } from "@/hooks/use-peanut";
import { useAppTranslations } from "@/context/TranslationContext";
import { fetchLinkDetail, triggerConfetti } from "@/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getAllChains } from "@/utils";

export interface ClaimData {
  link: string;
  depositDate: string;
  txHash: string;
  chainId: string;
  tokenAmount: number;
  tokenType: number;
  tokenAddress: string;
  tokenDecimals: number;
}

export default function ClaimsDisplay() {
  const [claims, setClaims] = useState<ClaimData[]>([]);
  const [claimStatuses, setClaimStatuses] = useState<{ [key: string]: string }>(
    {}
  );
  const { primaryWallet } = useDynamicContext();
  const { copyToClipboard } = usePeanut();
  const translations = useAppTranslations("HistoryTab");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 5;

  const handleCopy = (text: string, label: string) => {
    copyToClipboard(text);
    triggerConfetti("💸👻💸");
  };

  useEffect(() => {
    if (!primaryWallet?.address) return;

    const storedData = localStorage.getItem(
      `${primaryWallet.address} - created links`
    );

    if (storedData) {
      try {
        const parsedData: ClaimData[] = JSON.parse(storedData);
        setClaims(parsedData);
      } catch (error) {
        console.error("Error parsing data:", error);
      }
    }
  }, [primaryWallet?.address]);

  useEffect(() => {
    const fetchClaimStatuses = async () => {
      const statuses: { [key: string]: string } = {};
      for (const claim of claims) {
        const data = await fetchLinkDetail(claim.link);
        statuses[claim.link] = data?.claimed
          ? translations.tabClaimed
          : "Unclaimed";
      }
      setClaimStatuses(statuses);
    };

    fetchClaimStatuses();
  }, [claims, translations.tabClaimed]);

  if (claims?.length === 0) {
    return (
      <Card className="w-full h-[400px]">
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground ">
            👁️⃤ {translations.noData} 👁️⃤
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalPages = Math.ceil(claims.length / itemsPerPage);
  const currentClaims = claims.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  function getChainName(chainId: number) {
    const chain = getAllChains().find((c) => c.chainId === chainId);
    return chain;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold font-aeonik">
          {translations.title}
        </label>
      </div>
      <div className="rounded-md border h-[400px]">
        <Table className="justify-between items-center">
          <TableHeader className="justify-between items-center">
            <TableRow>
              <TableHead className="w-[50px] hidden">#</TableHead>
              <TableHead>{translations.tabLink}</TableHead>
              <TableHead>{translations.tabDate}</TableHead>
              <TableHead>{translations.tabHash}</TableHead>
              <TableHead>{translations.tabChain}</TableHead>

              <TableHead>{translations.tabToken}</TableHead>
              <TableHead>{translations.tabClaimed}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="justify-between items-center">
            {currentClaims.map((claim, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium hidden">
                  {(currentPage - 1) * itemsPerPage + index + 1}
                </TableCell>
                <TableCell>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <CopyIcon
                          onClick={() => handleCopy(claim.link, "Link copied")}
                          className="flex items-center text-blue-500 hover:underline w-4 h-4"
                        />
                      </TooltipTrigger>
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
                <TableCell>
                  {new Date(claim.depositDate)?.toLocaleString()?.split(",")[0]}
                </TableCell>
                <TableCell className="font-mono">
                  <Link
                    href={`${
                      (
                        useGetTokensOrChain(Number(claim?.chainId), "chain") as
                          | Chain
                          | undefined
                      )?.blockExplorerUrls[0]
                    }/tx/${claim.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center text-blue-500 hover:underline"
                  >
                    {claim.txHash.slice(0, 6)}...
                  </Link>
                </TableCell>
                <TableCell>
                  <Image
                    src={
                      (
                        useGetTokensOrChain(Number(claim?.chainId), "chain") as
                          | Chain
                          | undefined
                      )?.iconUrls[0] ?? ""
                    }
                    alt={
                      (
                        useGetTokensOrChain(Number(claim?.chainId), "chain") as
                          | Chain
                          | undefined
                      )?.name ?? ""
                    }
                    width={20}
                    height={20}
                  />
                </TableCell>

                <TableCell className="flex items-center">
                  <TokenChip
                    token={
                      allTokens.find((t) => t?.address === claim?.tokenAddress)!
                    }
                    amount={claim?.tokenAmount?.toString()}
                    chain={getChainName(Number(claim.chainId))}
                  />
                </TableCell>

                <TableCell className="text-xs items-center justify-center ">
                  <Suspense
                    fallback={
                      <Skeleton className="w-16 h-4 font-aeonik text-xs " />
                    }
                  >
                    <Badge variant="outline" className="text-xs">
                      {claimStatuses[claim.link] || (
                        <Skeleton className="w-16 h-4" />
                      )}
                    </Badge>
                  </Suspense>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-center space-x-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
          disabled={currentPage === 1}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {currentPage} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setCurrentPage((prev) => Math.min(prev + 1, totalPages))
          }
          disabled={currentPage === totalPages}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
