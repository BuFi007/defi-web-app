import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Chain, ChainSelectProps, Token } from "@/lib/types";
import { useGetTokensOrChain } from "@/hooks/use-tokens-or-chain";
import { useNetworkManager } from "@/hooks/use-dynamic-network";

export const ChainSelect: React.FC<ChainSelectProps> = ({
  value,
  onChange,
  chains,
  label,
  ccip,
}) => {
  const chainId = useNetworkManager();
  const renderChainOption = (chainId: string | number) => {
    const chain = useGetTokensOrChain(Number(chainId), "chain") as Chain;

    console.log(chain, "daskadsjkdkjdsa");
    return (
      <div className="flex items-center space-x-2">
        <img
          src={chain?.iconUrls[0] || ""}
          alt={chain?.name || ""}
          className="h-6 w-6 rounded-full"
        />
        <span className="font-clash text-sm">{chain.name}</span>
      </div>
    );
  };

  return (
    <div className="flex-1 flex items-center space-x-2 m-auto gap-4 justify-around">
      {!value && (
        <span className="text-xs text-gray-500 uppercase ">{label}</span>
      )}
      <div className=" min-w-[230px] w-[230px] max-w-[230px] m-auto ">
        <Select value={value || ""} onValueChange={onChange}>
          <SelectTrigger className="w-full m-auto flex items-center bg-white">
            <SelectValue placeholder={label} className="m-auto">
              {value ? renderChainOption(value) : label}
            </SelectValue>
          </SelectTrigger>
          {!ccip ? (
            <SelectContent>
              {chains
                .filter((chain) => chain.chainId !== chainId)
                .map((chain) => (
                  <SelectItem
                    key={chain.chainId}
                    value={chain.chainId.toString()}
                    className="m-auto"
                  >
                    {renderChainOption(chain.chainId.toString())}
                  </SelectItem>
                ))}
            </SelectContent>
          ) : (
            <SelectContent>
              {chains.map((chain) => (
                <SelectItem
                  key={chain.chainId}
                  value={chain.chainId.toString()}
                  className="m-auto"
                >
                  {renderChainOption(chain.chainId.toString())}
                </SelectItem>
              ))}
            </SelectContent>
          )}
        </Select>
      </div>
    </div>
  );
};
