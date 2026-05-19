import type { Abi, Address, Hex } from "viem";
import React from "react";
import * as chains from "wagmi/chains";

export interface RootLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    locale: string;
  }>;
}

export interface CurrencyInfo {
  address: string;
  borrowContract?: string;
  lendContract?: string;
  borrowABI?: Abi[];
  lendABI?: Abi[];
  decimals?: number | undefined | null | string;
}

export interface FooterProps {
  isPlaying: boolean;
  togglePlay: () => void;
  playNextSong: () => void;
  playPreviousSong: () => void;
  currentSong: string;
}

export interface NetworkSelectorProps {
  onSelect?: (chainId: string) => void;
  currentChainId: string;
}

export interface StepItemProps {
  step: number;
  title: string;
  isCompleted: boolean;
  isActive: boolean;
  children: React.ReactNode;
}

export interface CustomLinkProps
  extends React.LinkHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

type Call = {
  to: Address;
  data?: Hex;
  value?: bigint;
};

export interface TransactionWrapperPropsBase {
  chainId: number;
  onSuccess: (txHash: string) => void;
  onError: (error: Error) => void;
  children: React.ReactNode;
}

export interface TransactionWrapperPropsWithCall
  extends TransactionWrapperPropsBase {
  call: Call;
}

export interface AssetData {
  assetName: string;
  chains: string[];
  totalSupplied: number;
  totalSupplyAPY: number;
  amount: number;
  value: number;
}
export interface TabState {
  activeTab: "moneyMarket";
  setActiveTab: (tab: "moneyMarket") => void;
  resetTab: () => void;
}

export interface APYData {
  baseAPY: number;
  bonusAPY: number;
  totalAPY: number;
}

export interface CurrencyInfo {
  address: string;
  hubContract?: string;
  spokeContract?: string;
  hubABI?: Abi[];
  spokeABI?: Abi[];
}

export type LendFunctionNames = "depositCollateral" | "depositCollateralNative";
export type WithdrawFunctionNames =
  | "withdrawCollateral"
  | "withdrawCollateralNative";
export type BorrowFunctionNames = "borrow" | "borrowNative";
export type RepayFunctionNames = "repay" | "repayNative";

export interface TransactionHistoryItem {
  date: string;
  amount: number;
  status: string;
}

export interface UseTokenBalanceProps {
  tokenAddress: Address;
  chainId: ChainList;
  address: Address;
  decimals: number;
  setBalance?: (balance: string) => void;
}

export interface BalanceDisplayProps {
  balance: string;
  isLoading: boolean;
  symbol: string;
}

export interface ChainContextProps {
  fromChain: string;
  toChain: string;
  setFromChain: (chainId: string) => void;
  setToChain: (chainId: string) => void;
}

export interface Token {
  address: Hex | string | `0x${string}`;
  chainId: number;
  decimals: number;
  payable?: boolean;
  name: string;
  symbol: string;
  image: string;
  isNative?: boolean;
}

export interface ChainSelectProps {
  value: string | null;
  onChange: (value: string) => void;
  chains: Chain[];
  label: string;
  chainId?: number | undefined | string;
  ccip?: boolean;
}

export type { TransactionError as Error };

export interface CurrencyAddressInfo {
  address: string;
  hubContract: string;
  hubABI: Abi;
  spokeContract: string;
  spokeABI: Abi;
}

export type CurrencyAddresses = Record<
  number,
  Record<string, CurrencyAddressInfo>
>;

export interface CurrencyDisplayerProps {
  onValueChange?: (value: number, formattedValue: number) => void;
  initialAmount?: number;
  availableTokens: Token[];
  onTokenSelect: (token: Token) => void;
  currentNetwork?: number;
  token?: Token;
  tokenAmount?: number | string;
  size?: "sm" | "base" | "lg";
  action?: "default" | "pay";
  defaultToken?: Token;
}

export interface AbstractTransaction {
  to: string;
  data?: string;
  value?: bigint;
}

export interface AbstractSigner {
  sendTransaction(tx: AbstractTransaction): Promise<{ hash: string }>;
  getAddress(): Promise<string>;
}

export interface AddressProps {
  address: string;
}

export interface FramedQRCodeProps {
  image: string;
  copyLink?: () => void;
  link: string;
  frameText?: string;
}

export interface WormholeContracts {
  CrossChainSender: string;
  wormholeChainId: number;
}

export interface Translations {
  NotFound: {
    title: string;
  };
  Home: {
    welcome: string;
    to: string;
    slogan: {
      part1: string;
      part2: string;
      part3: string;
      part4: string;
    };
    logoAlt: string;
    neoMatrixAlt: string;
    pillGifAlt: string;
    boofiMatrixAlt: string;
    matrixMemeAlt: string;
    connectWalletAlert: string;
    sendPaymentTab: string;
    paymentLinksTab: string;
    moneyMarketTab: string;
    paymentsTab: string;
    ccipUsdcBridgeTab: string;
  };
  CurrencyDisplayer: {
    availableBalance: string;
    loadingBalance: string;
  };
  CCIPBridge: {
    connectWallet: string;
    title: string;
    toastTitleNetwork: string;
    toastDescriptionNetwork: string;
    toastDescriptionNetwork2: string;
    toastTitleError: string;
    toastDescriptionError: string;
    toastSentTitle: string;
    toastSentDescription: string;
    sourceChain: string;
    destinationChain: string;
    buttonText: string;
    linkTitle: string;
    labelBridge: string;
  };
  MoneyMarketBento1: {
    tabLend: string;
    tabBorrow: string;
    tabWithdraw: string;
    tabRepay: string;
    depositUSDC: string;
    withdrawUSDC: string;
    borrowUSDC: string;
    repayUSDC: string;
    toastSwitchTitle: string;
    toastSwitchDescription: string;
    toastSwitchDescription2: string;
    labelFrom: string;
    labelTo: string;
  };
  MoneyMarketBento3: {
    title: string;
    description: string;
  };
  HistoryTab: {
    title: string;
    description: string;
    noData: string;
    toastCopyTitle: string;
    toastCopyDescription: string;
    pagPrev: string;
    pagNext: string;
    pagPage: string;
    pagOf: string;
    tabLink: string;
    tabDate: string;
    tabHash: string;
    tabChain: string;
    tabAmount: string;
    tabClaimed: string;
    tabToken: string;
  };
  DiscordBanner: {
    cta: string;
  };
}

export type ChainList =
  | 1
  | 43113
  | 919
  | 5042002
  | 43114
  | 11155111
  | 421614
  | 11155420
  | 80002
  | 1301
  | 4801
  | undefined;
export interface WriteButtonProps {
  label: string;
  tokenAddress?: string;
  contractAddress: string;
  abi: any;
  functionName: string;
  args: {
    action: number;
    assetAddress: string;
    assetAmount: bigint;
  };
  isNative?: boolean;
  nativeAmount?: string;
  amount?: string;
}

export interface Chain {
  chainId: number;
  isMainnet: boolean;
  name: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
    iconUrls: string[];
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
  chainName: string;
  vanityName: string;
  networkId: number;
  iconUrls: string[];
}

export interface TransferWrapperProps {
  amount: string;
  onSuccess: (txHash: string) => void;
  onError: (error: any) => void;
  functionName: ValidFunctionNames;
  buttonText: string;
  argsExtra?: any[];
}

export interface LocalStorageStore {
  links: string[];
  setLinks: (links: string[]) => void;
}

export interface ShareOptions {
  link: string;
  message: string;
}
