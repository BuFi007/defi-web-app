import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
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
import { erc20Abi, formatUnits, Hex } from "viem";
import { useGetTokensOrChain } from "@/hooks/use-tokens-or-chain";
import { useNetworkManager } from "@/hooks/use-dynamic-network";
import { useUsdcChain } from "@/hooks/use-usdc-chain";
import { useToast } from "@/components/ui/use-toast";
import { Chain } from "@/lib/types";

export function MoneyMarketCard() {
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

  const formattedBalance = usdcBalance
    ? formatUnits(usdcBalance, USDC_ADDRESS?.decimals!)
    : "0";

  console.log(formattedBalance, "formattedBalance");

  const transferActions = {
    lend: { functionName: "depositCollateral", buttonText: "Deposit USDC" },
    withdraw: {
      functionName: "withdrawCollateral",
      buttonText: "Withdraw USDC",
    },
    borrow: { functionName: "borrow", buttonText: "Borrow USDC" },
    repay: { functionName: "repay", buttonText: "Repay USDC" },
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
      title: "Switching Network",
      description: `Switching network to ${value}. Please check your wallet to allow network change.`,
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
        <div className="flex items-center justify-between">
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
            label="From"
          />
          <Separator orientation="vertical" className="h-8 mx-4" />
          <ChainSelect
            value={toChain?.chainId?.toString()}
            onChange={(value) => {
              const chain = useGetTokensOrChain(Number(value), "chain");
              setToChain(chain as Chain);
            }}
            chains={toChains}
            label="To"
          />
        </div>
        <Separator />
        <div className="flex items-start justify-between">
          <div className="w-1/2 pr-2 pt-2">
            <Input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-4xl font-bold h-16 w-full"
            />
            <BalanceDisplay
              balance={formattedBalance || "0"}
              isLoading={!formattedBalance}
              symbol="USDC"
            />
          </div>
          <div className="w-1/2 p-4">
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
