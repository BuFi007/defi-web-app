import { create } from "zustand";
import {
  PaymentStore,
  TransactionState,
  PaymentTab,
  ViewTab,
  NetworkState
} from "./interface";
import { MarketStore, CurrencyInfo, TabState } from "@/lib/types";

export const usePaymentStore = create<PaymentStore>((set) => ({
  currentPaymentTab: "send",
  setCurrentPaymentTab: (tab: PaymentTab) => set({ currentPaymentTab: tab }),
}));

export const useTransactionStore = create<TransactionState>((set) => ({
  isLoading: false,
  error: null,
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));

export const useMarketStore = create<MarketStore>((set) => ({
  currentViewTab: "lend",
  setCurrentViewTab: (tab: ViewTab) => set({ currentViewTab: tab }),

  selectedAsset: null,
  setSelectedAsset: (asset: CurrencyInfo) => set({ selectedAsset: asset }),

  fromChain: "",
  toChain: "",
  setFromChain: (chainId: string) => set({ fromChain: chainId }),
  setToChain: (chainId: string) => set({ toChain: chainId }),
}));

export const useTabStore = create<TabState>((set) => ({
  activeTab: "moneyMarket",
  setActiveTab: (tab) => set({ activeTab: tab }),
}));

export const useNetworkStore = create<NetworkState>((set) => ({
  currentChainId: undefined,
  setCurrentChainId: (chainId: number | string | undefined) => set({ currentChainId: chainId }),
  isLoading: false,
  error: null,
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
