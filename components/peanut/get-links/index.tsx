"use client";

import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChevronLeft,
  ChevronRight,
  CopyIcon,
  ExternalLink,
} from "lucide-react";
import { useGetTokensOrChain } from "@/hooks/use-tokens-or-chain";
import { Chain, Token } from "@/lib/types";
import Image from "next/image";
import { TokenChip } from "@/components/token-chip";
import { allTokens } from "@/constants/Tokens";
import Link from "next/link";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import { usePeanut } from "@/hooks/use-peanut";
import { useAppTranslations } from "@/context/TranslationContext";
import { triggerConfetti } from "@/utils";

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
  const { primaryWallet } = useDynamicContext();
  const { copyToClipboard } = usePeanut();
  const translations = useAppTranslations("HistoryTab");
  // Pagination states
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 5;

  const handleCopy = (text: string, label: string) => {
    copyToClipboard(text);
    triggerConfetti("💸👻💸");

    // toast({
    //   title: `${translations.title}`,
    //   description: `${label} ${translations.description}`,
    // });
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

  if (claims.length === 0) {
    return (
      <Card className="w-full h-[400px]">
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground ">👁️⃤ {translations.noData} 👁️⃤</p>
        </CardContent>
      </Card>
    );
  }

  const totalPages = Math.ceil(claims.length / itemsPerPage);
  const currentClaims = claims.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold font-aeonik">
          {translations.title}
        </label>
      </div>
      <div className="rounded-md border h-[400px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">#</TableHead>
              <TableHead>{translations.tabLink}</TableHead>
              <TableHead>{translations.tabDate}</TableHead>
              <TableHead>{translations.tabHash}</TableHead>
              <TableHead>{translations.tabChain}</TableHead>
              <TableHead>{translations.tabAmount}</TableHead>
              <TableHead>{translations.tabToken}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentClaims.map((claim, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">
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
                  {new Date(claim.depositDate).toLocaleString().split(",")[0]}
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

                <TableCell>{claim.tokenAmount}</TableCell>
                <TableCell>
                  <TokenChip
                    token={
                      allTokens.find((t) => t.address === claim.tokenAddress)!
                    }
                  />
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
