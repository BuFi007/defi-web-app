// boofi-lite/frontend/src/actions/use-ens-name.actions.ts
import { useEnsName as useEnsNameWagmi, useReadContract } from "wagmi";
import { truncateAddress } from "@/utils";
import { ethers } from "ethers";
interface UseEnsNameOptions {
  address: string;
  chain?: any;
}

interface UseEnsNameResult {
  ensName: string | null;
  ensNotFound: boolean;
}

/**
 * Custom hook to fetch the ENS or Base name associated with an Ethereum address.
 */
export async function useEnsName({
  address,
  chain,
}: UseEnsNameOptions): Promise<UseEnsNameResult> {
  let ensName: string | null = null;
  const result = useEnsNameWagmi({
    address: address as `0x${string}`,
    chainId: chain.id,
  });

  // const { data } = useReadContract({
  //   address: address as `0x${string}`,
  //   abi: ensAbi,
  //   functionName: "lookupAddress",
  // });

  const ensNotFound = !result.isLoading && result.data === null;

  if (result.data) {
    ensName = result.data;
  } else {
    ensName = truncateAddress(address);
  }

  return { ensName, ensNotFound };
}

export default useEnsName;
