import type { Abi, Address, Hex } from "viem";
import React from "react";
import * as chains from "wagmi/chains";

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

export interface ExtendedPaymentInfo {
  chainId: number | string;
  tokenSymbol: string;
  tokenAmount: string;
  senderAddress: string;
  claimed: boolean;
  depositDate: string;
  transactionHash?: string;
  depositIndex: number;
}

export interface IGetLinkDetailsResponse {
  link: string;
  chainId: string;
  depositIndex: number;
  contractVersion: string;
  password: string;
  sendAddress: string;
  tokenType: string;
  tokenAddress: string;
  tokenDecimals: number;
  tokenSymbol: string;
  TokenName: string;
  tokenAmount: string;
  tokenId: number;
  claimed: boolean;
  depositDate: string;
  tokenURI: string;
}

export interface CustomLinkProps
  extends React.LinkHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

export interface PaymentInfoProps {
  paymentInfo: {
    chainId: number | string;
    tokenSymbol: string;
    tokenAmount: string;
    senderAddress: string;
    claimed: boolean;
    depositDate: string;
    transactionHash?: string;
    destinationChainId?: number;
    destinationChainName?: string;
  };
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
  activeTab: "moneyMarket" | "paymentLink" | "tokenSwap";
  setActiveTab: (tab: "moneyMarket" | "paymentLink" | "tokenSwap") => void;
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

// Specific function names for each action
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

export interface TransactionDetails {
  transactionHash: string;
  peanutLink: string;
  paymentLink: string;
}

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

export interface LinkUiFormProps {
  tokenAmount: number;
  handleValueChange: (usdAmount: number, tokenAmount: number) => void;
  availableTokens: Token[];
  setSelectedToken: Dispatch<SetStateAction<string>>;
  chainId: number | undefined;
  handleCreateLinkClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  isPeanutLoading: boolean;
}

export interface TransactionDetailsDisplayProps {
  transactionDetails: TransactionDetails;
  chainId: number | undefined;
  handleCopy: (text: string, label: string) => void;
  handleShare: (platform: string) => void;
  truncateHash: (hash: string) => string;
}

export interface CurrencyDisplayerProps {
  onValueChange: (value: number, formattedValue: number) => void;
  initialAmount?: number;
  availableTokens: Token[];
  onTokenSelect: (token: Token) => void;
  currentNetwork: number;
  tokenAmount?: number | string;
  size?: "sm" | "base" | "lg";
  action?: "pay" | "request" | "default";
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

export interface OverlayPayNameProps {
  handleToggleOverlay: () => void;
  copyLink: () => void;
  link: string;
  shareOnWhatsApp: (localizedLink: string) => void;
  shareOnTelegram: (localizedLink: string) => void;
  shareOnDownload: (qrCodeElement: HTMLElement) => void;
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
  EnsAlertDialog: {
    actionButton: string;
    callToAction: string;
  };
  PeanutTab: {
    sendTab: string;
    receiveTab: string;
    historyTab: string;
    linkTitle: string;
    createLinkButton: string;
    claimReady: string;
    currentTextAlreadyClaimedTitle: string;
    currentTextStartingClaim: string;
    handleFetchLinkDetailsError: string;
    currentTextAlreadyClaimed: string;
    currentTextClaiming: string;
    currentTextProgress: string;
    currentTextClaimSuccess: string;
    currentTextClaimError: string;
    currentTextClaimComplete: string;
    currentTextCrossChainProgress: string;
    currentTextCrossChainSuccess: string;
    currentTextCrossChainError: string;
    currentTextCrossChainComplete: string;
    claimTitle: string;
    claimSuccessTitle: string;
    claimDescription: string;
    claimPaste: string;
    claimVerify: string;
    claimClaim: string;
    claimSuccess: string;
    claimDestinationChain: string;
    claimViewInExplorer: string;
  };
  PaymentsTab: {};
  CurrencyDisplayer: {
    availableBalance: string;
    loadingBalance: string;
  };
  Overlay: {
    frameText: string;
    linkSubtitle: string;
    linkCopied: string;
    linkDescription: string;
    shareWhatsapp: string;
    shareTelegram: string;
    hashTxText: string;
    viewInExplorer: string;
    currentTextProgress: string;
    currentTextSuccess: string;
    currentTextFailed: string;
    currentTextSpooky: string;
    toastError: string;
    toastCopyTitle: string;
    toastCopyDescription: string;
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
    tabToken: string;
  };
  DiscordBanner: {
    cta: string;
  };
}

export type ChainList =
  | 8453
  | 42161
  | 43114
  | 43113
  | 84532
  | 421614
  | undefined;

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
