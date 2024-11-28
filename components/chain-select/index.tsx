import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChainSelectProps, Token } from "@/lib/types";
import { useGetTokensOrChain } from "@/hooks/use-tokens-or-chain";

export const ChainSelect: React.FC<ChainSelectProps> = ({
  value,
  onChange,
  chains,
  label,
}) => {
  const renderChainOption = (chainId: string | number) => {
    const chain = chains.find((c) => c.chainId === Number(chainId));

    if (!chain) {
      return null;
    }

    return (
      <div className="flex items-center space-x-2">
        <img
          src={chain?.iconUrls?.[0] || ""}
          alt={chain?.name || ""}
          className="h-6 w-6 rounded-full"
        />
        <span className="font-clash text-sm">{chain?.name}</span>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-2 m-auto gap-4 justify-around">
      <span className="text-xs text-gray-500 uppercase sm:hidden">{label}</span>
      <div className="min-w-[230px] w-full sm:w-[230px] max-w-[230px] m-auto">
        <Select value={value || ""} onValueChange={onChange}>
          <SelectTrigger className="w-full m-auto flex items-center bg-white">
            <SelectValue placeholder={label} className="m-auto">
              {value ? renderChainOption(value) : label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {chains.map((chain) => (
              <SelectItem
                key={chain.chainId}
                value={chain.chainId.toString()}
                className="m-auto bg-white"
              >
                {renderChainOption(chain.chainId.toString())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
