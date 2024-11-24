import { Token } from "@/lib/types";
import { Chain } from "@/lib/types";

type ViewTab = "lend" | "withdraw" | "borrow" | "repay";

type PaymentTab = "send" | "receive";

interface PaymentStore {
  currentPaymentTab: PaymentTab;
  setCurrentPaymentTab: (tab: PaymentTab) => void;
}

interface TransactionState {
  isLoading: boolean;
  error: string | null;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
}

interface NetworkState {
  currentChainId: number | string | undefined;
  setCurrentChainId: (chainId: number | string | undefined) => void;
  isLoading: boolean;
  error: string | null;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
}

interface MarketStore {
  currentViewTab: ViewTab;
  setCurrentViewTab: (tab: ViewTab) => void;
  selectedAsset: Token | null;
  setSelectedAsset: (asset: Token) => void;
  fromChain: Chain;
  toChain: Chain;
  setFromChain: (Chain: Chain) => void;
  setToChain: (Chain: Chain) => void;
}

export type {
  PaymentStore,
  TransactionState,
  PaymentTab,
  ViewTab,
  NetworkState,
  MarketStore,
};

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;

  toolName?: string;
  result?: any;
}

export interface AssistantState {
  messages: Message[];
  isOpen: boolean;
  setOpen: (isOpen: boolean) => void;
  addMessage: (message: Message) => void;
  clearMessages: () => void;
  isRecording: boolean;
  setIsRecording: (isRecording: boolean) => void;
  audioLevel: number;
  setAudioLevel: (level: number) => void;
  input: string;
  setInput: (input: string) => void;
}
