import { ChainList } from "@/lib/types";

export const destinationChains = [
  {
    address: "0xA9fB4A1a42BA87e1590cd0F55A11a96071d2D943", /// address to interact with on avalanche fuji
    ccipChainId: 14767482510784806043n, //// ccip chain id for avalanche fuji
    name: "Avalanche Fuji",
    chainId: 43113,
  },
  //   {
  //     address: "0x0000000000000000000000000000000000000000", // this chain is only used for ccip
  //     ccipChainId: 16015286601757825753n, //// ccip chain id for sepolia
  //     name: "Sepolia",
  //     chainId: 11155111, // chain id for sepolia
  //   },
  {
    address: "0x480f9F2Fe22cB70C92058f34d5E89F0D8441146d", // base sepolia
    ccipChainId: 10344971235874465080n, // ccip chain id for base sepolia
    name: "Base Sepolia", // name of the chain
    chainId: 84532, // decimal chain id for base sepolia
  },
];

export const getCCIPChainByChainId = ({
  chainId,
}: {
  chainId: ChainList | null;
}) => {
  if (!chainId) return null;
  return destinationChains.find((chain) => chain.chainId === chainId);
};
