import React, { useState, useCallback, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Image from "next/image";
import * as Chains from "@/constants/Chains";

interface NetworkSelectorProps {
  currentChainId: string;
  destinationChainId: string;
  onSelect: (chainId: string) => void;
}

const NetworkSelector: React.FC<NetworkSelectorProps> = ({
  currentChainId,
  destinationChainId,
  onSelect,
}) => {
  const [selectedChain, setSelectedChain] = useState<string>(destinationChainId || "");

  const supportedChains = Object.values(Chains).filter(
    chain => chain.chainId.toString() !== currentChainId
  );

  const handleChainSelect = useCallback((value: string) => {
    console.log("Selecting chain:", value);
    setSelectedChain(value);
    onSelect(value);
  }, [onSelect]);

  // Set initial destination chain if none selected
  useEffect(() => {
    if (!selectedChain && supportedChains.length > 0) {
      const firstChain = supportedChains[0];
      handleChainSelect(firstChain.chainId.toString());
    }
  }, [supportedChains, selectedChain, handleChainSelect]);

  const renderChainOption = (chain: typeof Chains.Base) => (
    <div className="flex items-center space-x-2">
      <Image
        src={chain.iconUrls[0]}
        alt={chain.name}
        width={24}
        height={24}
        className="h-6 w-6"
      />
      <span className="font-clash text-sm">{chain.vanityName}</span>
    </div>
  );

  return (
    <div className="w-full">
      <Select
        value={selectedChain}
        onValueChange={handleChainSelect}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select destination chain">
            {selectedChain ? (
              renderChainOption(supportedChains.find(c => c.chainId.toString() === selectedChain)!)
            ) : (
              "Select destination chain"
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Available Chains</SelectLabel>
            {supportedChains.map((chain) => (
              <SelectItem
                key={chain.chainId}
                value={chain.chainId.toString()}
              >
                {renderChainOption(chain)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
};

export default NetworkSelector;