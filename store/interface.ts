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

export type {
  PaymentStore,
  TransactionState,
  PaymentTab,
  ViewTab,
  NetworkState,
};
