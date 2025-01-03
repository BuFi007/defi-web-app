import { useState } from "react";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import TransferWrapper from "@/components/money-market/transfer-wrapper";
import { TransactionHistoryItem } from "@/lib/types";
import { useTokenBalance } from "@/hooks/use-user-balance";
import { useChainSelection } from "@/hooks/use-chain-selection";
import { ChainSelect } from "@/components/chain-select";
import { BalanceDisplay } from "@/components/balance-display";
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
  const { primaryWallet } = useDynamicContext();
  const chainId = useNetworkManager();
  const USDC_ADDRESS = useUsdcChain();
  const switchNetwork = useSwitchNetwork();
  const { toast } = useToast();

  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS?.address as Hex,
    abi: erc20Abi,
    chainId: chainId,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });

  const { data: nativeBalance } = useBalance({
    address: address as `0x${string}`,
  });

  console.log(nativeBalance, "nativeBalance");
  const formattedNativeBalance = nativeBalance?.formatted;

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

  console.log(currentViewTab, "currentViewTab");
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
          <ChainSelect
            value={toChain?.chainId?.toString()}
            onChange={(value) => {
              const chain = useGetTokensOrChain(Number(value), "chain");
              setToChain(chain as Chain);
            }}
            chains={toChains}
            label={translations.labelTo}
          />
        </div>
        <Separator />
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="w-full sm:w-1/2 sm:pr-2 pt-2">
            <Input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-2xl sm:text-4xl font-bold h-16 w-full"
            />

            {/* <BalanceDisplay
              balance={formattedBalance || "0"}
              isLoading={!formattedBalance}
              //symbol="USDC"
              symbol="BNB"
            /> */}
            <span className="text-sm text-gray-500 mt-2 block justify-start text-left">
              BALANCE:
              {formattedNativeBalance ? (
                `${formattedNativeBalance.substring(0, 10)} BNB`
              ) : (
                <Skeleton className="inline-block ml-2 h-4 w-16" />
              )}
            </span>
          </div>
          <WriteButton
            label={`${currentViewTab} Native`}
            contractAddress={SPOKE_BSC_CONTRACT_ADDRESS}
            abi={spokeAbi}
            functionName={"depositCollateralNative"}
            args={[]}
            isNative={true}
            nativeAmount={amount}
          />
          <div className="w-full sm:w-1/2 p-4">
            <TransferWrapper
              amount={amount}
              onSuccess={handleTransactionSuccess}
              onError={handleTransactionError}
              functionName={functionName}
              buttonText={buttonText}
            />
          </div>
        </div>
        <Separator />
      </div>
    </div>
  );
}
