import { type ClassValue, clsx } from "clsx";
import { useCallback } from "react";
import { twMerge } from "tailwind-merge";
import {
  Chain,
  ExtendedPaymentInfo,
  IGetLinkDetailsResponse,
} from "@/lib/types";
import * as Chains from "@/constants/Chains";
import { getLinkDetails } from "@squirrel-labs/peanut-sdk";
import { toast } from "@/components/ui/use-toast";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const BLOCKSCOUT_EXPLORERS: Record<number, string> = {
  1: "https://eth.blockscout.com",
  10: "https://optimism.blockscout.com",
  420: "https://optimism-sepolia.blockscout.com",
  42220: "https://celo.blockscout.com",
  44787: "https://alfajores.blockscout.com",
  8453: "https://base.blockscout.com",
  84532: "https://base-sepolia.blockscout.com",
  34443: "https://mode.blockscout.com",
  919: "https://mode-testnet.blockscout.com",
  11155111: "https://sepolia.blockscout.com",
};

export function getBlockExplorerUrl(chain: Chain): string {
  return BLOCKSCOUT_EXPLORERS[chain.chainId] || chain.rpcUrls[0] || "";
}
export function isValidAmount(value: string) {
  if (value === "") {
    return true;
  }
  const regex = /^[0-9]*\.?[0-9]*$/;
  return regex.test(value);
}

export function getRoundedAmount(balance: string, fractionDigits: number) {
  if (balance === "0") {
    return balance;
  }
  const parsedBalance = Number.parseFloat(balance);
  const result = Number(parsedBalance)
    ?.toFixed(fractionDigits)
    .replace(/0+$/, "");

  // checking if balance is more than 0 but less than fractionDigits
  // without this prints "0."
  if (parsedBalance > 0 && Number.parseFloat(result) === 0) {
    return "0";
  }

  return result;
}

export function getBlockExplorerUrlByChainId(chainId: number): string {
  return BLOCKSCOUT_EXPLORERS[chainId] || "";
}

export function truncateAddress(address: string, length: number = 6): string {
  if (!address) return "";
  return address.length > 2 * length + 2
    ? `${address.slice(0, length)}...${address.slice(-length)}`
    : address;
}

export const text = {
  body: "font-sans text-ock-foreground text-base leading-normal",
  caption: "font-sans text-ock-foreground text-bold text-xs leading-4",
  headline: "font-bold text-ock-foreground font-sans text-base leading-normal",
  label1: "font-bold text-ock-foreground font-sans text-sm leading-5",
  label2: "font-sans text-ock-foreground text-sm leading-5",
  legal: "font-sans text-ock-foreground text-xs leading-4",
  title3: "font-bold text-ock-foreground font-display text-xl leading-7",
} as const;

export const pressable = {
  default:
    "cursor-pointer bg-ock-default active:bg-ock-default-active hover:bg-[var(--bg-ock-default-hover)]",
  alternate:
    "cursor-pointer bg-ock-alternate active:bg-ock-alternate-active hover:[var(--bg-ock-alternate-hover)]",
  inverse:
    "cursor-pointer bg-ock-inverse active:bg-ock-inverse-active hover:bg-[var(--bg-ock-inverse-hover)]",
  primary:
    "cursor-pointer bg-ock-primary active:bg-ock-primary-active hover:bg-[var(--bg-ock-primary-hover)]",
  secondary:
    "cursor-pointer bg-ock-secondary active:bg-ock-secondary-active hover:bg-[var(--bg-ock-secondary-hover)]",
  coinbaseBranding:
    "cursor-pointer bg-[#0052FF] active:bg-ock-secondary-active hover:bg-[#0045D8]",
  shadow: "shadow-ock-default",
  disabled: "opacity-[0.38] pointer-events-none",
} as const;

export const background = {
  default: "bg-ock-default",
  alternate: "bg-ock-alternate",
  inverse: "bg-ock-inverse",
  primary: "bg-ock-primary",
  secondary: "bg-ock-secondary",
  error: "bg-ock-error",
  warning: "bg-ock-warning",
  success: "bg-ock-success",
} as const;

export const color = {
  inverse: "text-ock-inverse",
  foreground: "text-ock-foreground",
  foregroundMuted: "text-ock-foreground-muted",
  error: "text-ock-error",
  primary: "text-ock-primary",
  success: "text-ock-success",
  warning: "text-ock-warning",
  disabled: "text-ock-disabled",
} as const;

export const fill = {
  default: "fill-ock-default",
  defaultReverse: "fill-ock-default-reverse",
  inverse: "fill-ock-inverse",
} as const;

export const border = {
  default: "border-ock-default",
  defaultActive: "border-ock-default-active",
} as const;

export const placeholder = {
  default: "placeholder-ock-default",
} as const;

/**
 * Determines the available "From" chains based on the selected action.
 * @param action - The selected action ("lend", "borrow", "withdraw", "repay").
 * @param chains - The array of all chain configurations.
 * @returns An array of ChainConfig objects that can be used as "From" options.
 */

export const getFromChains = (
  action: "lend" | "borrow" | "withdraw" | "repay",
  isMainnet: boolean
): Chain[] => {
  switch (action) {
    case "lend":
      // Supply from spokes only (isHub: false)
      if (isMainnet) {
        return [Chains.Arbitrum, Chains.Base, Chains.Avalanche];
      } else {
        return [
          Chains.ArbitrumSepolia,
          Chains.BaseSepolia,
          Chains.AvalancheFuji,
        ];
      }
    case "borrow":
      if (isMainnet) {
        return [Chains.Avalanche];
      } else {
        return [Chains.AvalancheFuji];
      }
    case "withdraw":
      if (isMainnet) {
        return [Chains.Avalanche];
      } else {
        return [Chains.AvalancheFuji];
      }
    case "repay":
      if (isMainnet) {
        return [Chains.Arbitrum, Chains.Base, Chains.Avalanche];
      } else {
        return [
          Chains.ArbitrumSepolia,
          Chains.BaseSepolia,
          Chains.AvalancheFuji,
        ];
      }
    default:
      return [
        Chains.Arbitrum,
        Chains.Avalanche,
        Chains.Base,
        Chains.BaseSepolia,
        Chains.AvalancheFuji,
        Chains.ArbitrumSepolia,
      ];
  }
};

/**
 * Determines the available "To" chains based on the selected action.
 * @param action - The selected action ("lend", "borrow", "withdraw", "repay").
 * @param chains - The array of all chain configurations.
 * @returns An array of ChainConfig objects that can be used as "To" options.
 */
export const getToChains = (
  action: "lend" | "borrow" | "withdraw" | "repay",
  isMainnet: boolean
): Chain[] => {
  switch (action) {
    case "lend":
      // Supply from spokes only (isHub: false)
      if (isMainnet) {
        return [Chains.Avalanche];
      } else {
        return [Chains.AvalancheFuji];
      }
    case "borrow":
      if (isMainnet) {
        return [Chains.Arbitrum, Chains.Base, Chains.Avalanche];
      } else {
        return [
          Chains.ArbitrumSepolia,
          Chains.BaseSepolia,
          Chains.AvalancheFuji,
        ];
      }
    case "withdraw":
      if (isMainnet) {
        return [Chains.Arbitrum, Chains.Base, Chains.Avalanche];
      } else {
        return [
          Chains.ArbitrumSepolia,
          Chains.BaseSepolia,
          Chains.AvalancheFuji,
        ];
      }
    case "repay":
      if (isMainnet) {
        return [Chains.Avalanche];
      } else {
        return [Chains.AvalancheFuji];
      }
    default:
      return [
        Chains.Arbitrum,
        Chains.Avalanche,
        Chains.Base,
        Chains.BaseSepolia,
        Chains.AvalancheFuji,
        Chains.ArbitrumSepolia,
      ];
  }
};

export const formatCurrency = (
  value: bigint | number,
  options?: Intl.NumberFormatOptions
) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    ...options,
  }).format(Number(value));
};

export const formatToken = (
  value: bigint | number,
  options?: Intl.NumberFormatOptions
) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    maximumFractionDigits: 6,
    ...options,
  }).format(Number(value));
};

export const fetchLinkDetails = async (
  link: string,
  setDetails: (details: IGetLinkDetailsResponse) => void,
  setPaymentInfo: (paymentInfo: ExtendedPaymentInfo) => void
) => {
  try {
    const details = (await getLinkDetails({
      link,
    })) as unknown as IGetLinkDetailsResponse;
    setDetails(details);
    const extendedPaymentInfo: ExtendedPaymentInfo = {
      chainId: details.chainId,
      tokenSymbol: details.tokenSymbol,
      tokenAmount: details.tokenAmount,
      senderAddress: details.sendAddress,
      claimed: details.claimed,
      depositDate: details.depositDate,
      depositIndex: details.depositIndex,
    };
    setPaymentInfo(extendedPaymentInfo);
  } catch (error: any) {
    console.error("Error fetching link details:", error.message);
    toast({
      title: "Error",
      description: "An error occurred while fetching the link details.",
      variant: "destructive",
    });
  }
};
