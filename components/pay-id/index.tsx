"use client";

import { Hex } from "viem";
import { useEffect, useState } from "react";
import { ChainSelect } from "@/components/chain-select";
import PresetAmountButtons from "@/components/preset-amounts/index";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import CurrencyDisplayer from "@/components/currency";
import {
  useDynamicContext,
  useSwitchNetwork,
} from "@dynamic-labs/sdk-react-core";
import { useGetTokensOrChain } from "@/hooks/use-tokens-or-chain";
import { useNetworkManager } from "@/hooks/use-dynamic-network";
import { Chain, ChainList, Token } from "@/lib/types";
import { getAllChains } from "@/utils";
import { useEnsName } from "wagmi";
import { BuIdentity } from "@/components/Identity";

interface PayIdComponentProps {
  params: { id: string; locale: string };
  searchParams: { amount?: string; token?: string; chain?: string };
}

export default function PayId({ params, searchParams }: PayIdComponentProps) {
  const [selectedToken, setSelectedToken] = useState<Token>();
  const [amount, setAmount] = useState<string>("1");
  const [receiver, setReceiver] = useState<string>("");
  const [ensNotFound, setEnsNotFound] = useState<boolean>(false);
  const [ensName, setEnsName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const { primaryWallet } = useDynamicContext();
  const chainId = useNetworkManager();
  const switchNetwork = useSwitchNetwork();
  const availableTokens = useGetTokensOrChain(chainId!, "tokens") as Token[];
  const address = primaryWallet?.address;
  const id = params.id;
  const queryString = window.location.search;
  const amountParam = new URLSearchParams(queryString);
  const presetAmount = amountParam?.get("amount");
  const tokenParam = amountParam?.get("token");
  const chainParam = amountParam?.get("chain");

  const allChains = getAllChains();

  const ensNameEthers = useEnsName({
    address: id as Hex,
    chainId: (useGetTokensOrChain(chainId!, "chain") as Chain)
      ?.chainId as ChainList,
  });

  async function getEnsAddress() {
    setLoading(true);
    try {
      setReceiver(id as Hex);

      setEnsName(ensNameEthers?.data!);
      setReceiver(id as Hex);
      setLoading(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    getEnsAddress();
  }, []);

  const sameTargetChain = chainId === 43113;

  if (loading) return <Skeleton className="w-full h-full" />;

  function handleAmountSelect(amount: number) {
    console.log(amount, "amount");
    setAmount(amount.toString());
  }
  const tokenFind = availableTokens?.filter(
    (token) => token?.symbol === tokenParam
  );
  console.log(tokenFind, "tokenFind");
  return (
    <div className="flex flex-col items-center w-full p-4">
      <div className="flex flex-col w-full max-w-l">
        {!ensNotFound ? (
          <>
            <BuIdentity address={receiver as Hex} ensName={ensName} />
            <div className="flex justify-center space-x-2 mt-4">
              <PresetAmountButtons onAmountSelect={handleAmountSelect} />
            </div>

            <div className="flex justify-center w-full my-4">
              <div className="text-center">
                <ChainSelect
                  value={chainId?.toString()!}
                  onChange={(value) => {
                    const chain = useGetTokensOrChain(Number(value), "chain");
                    switchNetwork({
                      wallet: primaryWallet!,
                      network: Number(value),
                    });
                  }}
                  label="Select Chain"
                  chains={allChains}
                />
              </div>
            </div>

            <CurrencyDisplayer
              tokenAmount={amount}
              initialAmount={presetAmount ? Number(presetAmount) : 0}
              onValueChange={(value) => setAmount(value.toString())}
              availableTokens={
                tokenParam ? (tokenFind as Token[]) : availableTokens
              }
              onTokenSelect={setSelectedToken}
              currentNetwork={chainId!}
              defaultToken={tokenParam ? tokenFind?.[0] : undefined}
              action="pay"
            />

            <div className="flex flex-col w-full space-y-2 pt-4">
              {sameTargetChain ? (
                <>
                  <Button className="w-full bg-green-500 hover:bg-green-600">
                    Transfer
                  </Button>
                </>
              ) : (
                <Button className="w-full bg-green-500 hover:bg-green-600">
                  Send Tokens
                </Button>
              )}
            </div>
          </>
        ) : (
          <section className="flex flex-col items-center justify-center w-full">
            <h1 className="text-xl font-bold">ENS NOT FOUND</h1>
          </section>
        )}
      </div>
    </div>
  );
}
