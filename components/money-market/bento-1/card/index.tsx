import { useState } from "react";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { TransactionHistoryItem, Token } from "@/lib/types";

import { useTokenBalance } from "@/hooks/use-user-balance";
import { useChainSelection } from "@/hooks/use-chain-selection";
import { ChainSelect } from "@/components/chain-select";
import {
  useSwitchNetwork,
  useDynamicContext,
} from "@dynamic-labs/sdk-react-core";
import { erc20Abi, formatUnits, Hex, parseUnits } from "viem";
import { useGetTokensOrChain } from "@/hooks/use-tokens-or-chain";
import { useNetworkManager } from "@/hooks/use-dynamic-network";
import { useUsdcChain } from "@/hooks/use-usdc-chain";
import { useToast } from "@/components/ui/use-toast";
import { Chain } from "@/lib/types";
import { useAppTranslations } from "@/context/TranslationContext";
import WriteButton from "@/components/blockchainButtons/writeButton";
import { SPOKE_BSC_CONTRACT_ADDRESS } from "@/constants/Contracts";
import { spokeAbi } from "@/constants/ABI";
import { Skeleton } from "@/components/ui/skeleton";
import CurrencyDisplayer from "@/components/currency";
import TokenSelector from "@/components/token-selector";

export function MoneyMarketCard() {
  const translations = useAppTranslations("MoneyMarketBento1");
  const { address } = useAccount();
  const {
    currentViewTab,
    fromChains,
    toChains,
    setToChain,
    setFromChain,
    toChain,
    fromChain,
  } = useChainSelection();
  const [amount, setAmount] = useState("");
  const [transactionHistory, setTransactionHistory] = useState<
    TransactionHistoryItem[]
  >([]);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);

  const { primaryWallet } = useDynamicContext();
  const chainId = useNetworkManager();
  const USDC_ADDRESS = useUsdcChain();
  const switchNetwork = useSwitchNetwork();
  const { toast } = useToast();
  const availableTokens = useGetTokensOrChain(chainId as number, "tokens");

  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS?.address as Hex,
    abi: erc20Abi,
    chainId: chainId,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });

  const { data: tokenBalance } = useTokenBalance({
    address: address as `0x${string}`,
    chainId: chainId,
    tokenAddress: selectedToken?.address as `0x${string}`,
    decimals: selectedToken?.decimals ?? 18,
  });

  const { data: nativeBalance } = useBalance({
    address: address as `0x${string}`,
  });

  const formattedNativeBalance = nativeBalance?.formatted;
  const formattedTokenBalance = tokenBalance?.formatted ?? "0";

  const formattedBalance = usdcBalance
    ? formatUnits(usdcBalance, USDC_ADDRESS?.decimals!)
    : "0";

  const transferActions = {
    lend: {
      functionName: "depositCollateral",
      buttonText: translations.depositUSDC,
    },
    withdraw: {
      functionName: "withdrawCollateral",
      buttonText: translations.withdrawUSDC,
    },
    borrow: { functionName: "borrow", buttonText: translations.borrowUSDC },
    repay: { functionName: "repay", buttonText: translations.repayUSDC },
  };

  const action =
    transferActions[currentViewTab as keyof typeof transferActions] || {};
  const { functionName, buttonText } = action;

  const handleTransactionSuccess = (txHash: string) => {
    setTransactionHistory((prev) => [
      ...prev,
      {
        date: new Date().toLocaleString(),
        amount: parseFloat(amount),
        status: "Success",
      },
    ]);
  };

  const handleTransactionError = (error: any) => {
    setTransactionHistory((prev) => [
      ...prev,
      {
        date: new Date().toLocaleString(),
        amount: parseFloat(amount),
        status: "Failed",
      },
    ]);
  };

  function handleToggle(value: string) {
    toast({
      title: translations.toastSwitchTitle,
      description: `${translations.toastSwitchDescription} ${value}. ${translations.toastSwitchDescription2}`,
    });

    const chain = useGetTokensOrChain(Number(value), "chain");
    setFromChain(chain as Chain);
    switchNetwork({
      wallet: primaryWallet!,
      network: Number(value),
    });
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="flex flex-col space-y-4 w-full">
        <Separator />
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <ChainSelect
            value={
              fromChain?.chainId?.toString()
                ? fromChain?.chainId?.toString()
                : chainId?.toString()!
            }
            onChange={(value) => {
              handleToggle(value);
            }}
            chains={fromChains}
            label={translations.labelFrom}
          />
          <Separator orientation="vertical" className="hidden sm:block h-8" />
          <Separator className="w-full sm:hidden" />

          <TokenSelector
            token={selectedToken!}
            availableTokens={availableTokens as Token[]}
            onTokenSelect={setSelectedToken}
          />
        </div>
        <Separator />
        <div className="flex flex-col sm:flex-row items-center justify-between w-full gap-4">
          <div className="w-6/12 sm:w-1/2 sm:pr-2 pt-2">
            <Input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-2xl sm:text-4xl font-bold h-16 w-full"
            />

            <span className="text-sm text-gray-500 mt-2 block justify-start text-left">
              BALANCE:{" "}
              {selectedToken ? (
                `${formattedTokenBalance.substring(0, 10)} ${
                  selectedToken.symbol
                }`
              ) : formattedNativeBalance ? (
                `${formattedNativeBalance.substring(0, 10)} ${
                  fromChain
                    ? fromChain?.nativeCurrency?.name
                    : (useGetTokensOrChain(Number(chainId), "chain") as Chain)
                        ?.nativeCurrency?.symbol
                }`
              ) : (
                <Skeleton className="inline-block ml-2 h-4 w-16" />
              )}
            </span>
          </div>
          <WriteButton
            label={`${currentViewTab}`}
            contractAddress={
              selectedToken?.address ?? SPOKE_BSC_CONTRACT_ADDRESS
            }
            abi={spokeAbi}
            functionName={
              selectedToken ? functionName : "depositCollateralNative"
            }
            args={[]}
            isNative={!selectedToken}
            nativeAmount={amount}
          />
        </div>
        <Separator />
      </div>
    </div>
  );
}
