import { create } from "zustand";
import {
  PaymentStore,
  TransactionState,
  PaymentTab,
  ViewTab,
  NetworkState,
  MarketStore,
} from "./interface";
import { Token, TabState, Chain } from "@/lib/types";

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
  setSelectedAsset: (asset: Token) => set({ selectedAsset: asset }),

  fromChain: undefined as unknown as Chain,
  toChain: undefined as unknown as Chain,
  setFromChain: (chain: Chain) => set({ fromChain: chain }),  
  setToChain: (chain: Chain) => set({ toChain: chain }),
}));

export const useTabStore = create<TabState>((set) => ({
  activeTab: "moneyMarket",
  setActiveTab: (tab) => set({ activeTab: tab }),
}));

export const useNetworkStore = create<NetworkState>((set) => ({
  currentChainId: undefined,
  setCurrentChainId: (chainId: number | string | undefined) =>
    set({ currentChainId: chainId }),
  isLoading: false,
  error: null,
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
