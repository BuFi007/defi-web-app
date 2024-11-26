import { create } from "zustand";
import {
  PaymentStore,
  TransactionState,
  PaymentTab,
  ViewTab,
  NetworkState,
  MarketStore,
  AssistantState,
} from "./interface";
import { Token, TabState, Chain, LocalStorageStore } from "@/lib/types";
import { persist } from "zustand/middleware";

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

export const useTabStore = create<TabState>()(
  persist(
    (set) => ({
      activeTab: "moneyMarket",
      setActiveTab: (tab) => set({ activeTab: tab }),
      resetTab: () => set({ activeTab: "moneyMarket" }),
    }),
    {
      name: 'tab-storage',
      onRehydrateStorage: () => (state) => {
        // Reset state on page load
        if (state) {
          state.resetTab();
        }
      },
    }
  )
);

export const useNetworkStore = create<NetworkState>((set) => ({
  currentChainId: undefined,
  setCurrentChainId: (chainId: number | string | undefined) =>
    set({ currentChainId: chainId }),
  isLoading: false,
  error: null,
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));

export const useAssistantStore = create<AssistantState>((set) => ({
  messages: [],
  isRecording: false,
  isOpen: false,
  audioLevel: 0,
  input: "",
  setInput: (input) => set({ input }),
  setOpen: (isOpen) => set({ isOpen }),
  clearMessages: () => set({ messages: [] }),
  setIsRecording: (isRecording) => set({ isRecording }),
  setAudioLevel: (level) => set({ audioLevel: level }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
}));

export const useLocalStorageStore = create<LocalStorageStore>((set) => ({
  links: [],
  setLinks: (links: string[]) => set({ links }),
}));
