"use client";

import React, { createContext, useContext, ReactNode } from "react";
import { Translations } from "@/lib/types";
import { useI18n } from "@/locales/client";

interface TranslationContextType {
  translations: Partial<Translations>;
}

const TranslationContext = createContext<TranslationContextType | undefined>(
  undefined
);

export function TranslationProvider({ children }: { children: ReactNode }) {
  // next-international's typed translator. Cast to a loose signature so the
  // existing dot-keyed call sites keep working as-is.
  const tBase = useI18n();
  const t = tBase as unknown as (key: string) => string;

  const translations: Translations = {
    NotFound: {
      title: t("NotFound.title"),
    },
    Home: {
      welcome: t("Home.welcome"),
      to: t("Home.to"),
      slogan: {
        part1: t("Home.slogan.part1"),
        part2: t("Home.slogan.part2"),
        part3: t("Home.slogan.part3"),
        part4: t("Home.slogan.part4"),
      },
      logoAlt: t("Home.logoAlt"),
      neoMatrixAlt: t("Home.neoMatrixAlt"),
      pillGifAlt: t("Home.pillGifAlt"),
      boofiMatrixAlt: t("Home.boofiMatrixAlt"),
      matrixMemeAlt: t("Home.matrixMemeAlt"),
      connectWalletAlert: t("Home.connectWalletAlert"),
      sendPaymentTab: t("Home.sendPaymentTab"),
      paymentLinksTab: t("Home.paymentLinksTab"),
      moneyMarketTab: t("Home.moneyMarketTab"),
      paymentsTab: t("Home.paymentsTab"),
      ccipUsdcBridgeTab: t("Home.ccipUsdcBridgeTab"),
    },
    CurrencyDisplayer: {
      availableBalance: t("CurrencyDisplayer.availableBalance"),
      loadingBalance: t("CurrencyDisplayer.loadingBalance"),
    },
    CCIPBridge: {
      connectWallet: t("CCIPBridge.connectWallet"),
      title: t("CCIPBridge.title"),
      toastTitleNetwork: t("CCIPBridge.toastTitleNetwork"),
      toastDescriptionNetwork: t("CCIPBridge.toastDescriptionNetwork"),
      toastDescriptionNetwork2: t("CCIPBridge.toastDescriptionNetwork2"),
      toastTitleError: t("CCIPBridge.toastTitleError"),
      toastDescriptionError: t("CCIPBridge.toastDescriptionError"),
      toastSentTitle: t("CCIPBridge.toastSentTitle"),
      toastSentDescription: t("CCIPBridge.toastSentDescription"),
      sourceChain: t("CCIPBridge.sourceChain"),
      destinationChain: t("CCIPBridge.destinationChain"),
      buttonText: t("CCIPBridge.buttonText"),
      linkTitle: t("CCIPBridge.linkTitle"),
      labelBridge: t("CCIPBridge.labelBridge"),
    },
    MoneyMarketBento1: {
      tabLend: t("MoneyMarketBento1.tabLend"),
      tabBorrow: t("MoneyMarketBento1.tabBorrow"),
      tabWithdraw: t("MoneyMarketBento1.tabWithdraw"),
      tabRepay: t("MoneyMarketBento1.tabRepay"),
      depositUSDC: t("MoneyMarketBento1.depositUSDC"),
      withdrawUSDC: t("MoneyMarketBento1.withdrawUSDC"),
      borrowUSDC: t("MoneyMarketBento1.borrowUSDC"),
      repayUSDC: t("MoneyMarketBento1.repayUSDC"),
      toastSwitchTitle: t("MoneyMarketBento1.toastSwitchTitle"),
      toastSwitchDescription: t("MoneyMarketBento1.toastSwitchDescription"),
      toastSwitchDescription2: t("MoneyMarketBento1.toastSwitchDescription2"),
      labelFrom: t("MoneyMarketBento1.labelFrom"),
      labelTo: t("MoneyMarketBento1.labelTo"),
    },
    MoneyMarketBento3: {
      title: t("MoneyMarketBento3.title"),
      description: t("MoneyMarketBento3.description"),
    },
    HistoryTab: {
      title: t("HistoryTab.title"),
      description: t("HistoryTab.description"),
      noData: t("HistoryTab.noData"),
      toastCopyTitle: t("HistoryTab.toastCopyTitle"),
      toastCopyDescription: t("HistoryTab.toastCopyDescription"),
      pagPrev: t("HistoryTab.pagPrev"),
      tabClaimed: t("HistoryTab.tabClaimed"),
      pagNext: t("HistoryTab.pagNext"),
      pagPage: t("HistoryTab.pagPage"),
      pagOf: t("HistoryTab.pagOf"),
      tabLink: t("HistoryTab.tabLink"),
      tabDate: t("HistoryTab.tabDate"),
      tabHash: t("HistoryTab.tabHash"),
      tabChain: t("HistoryTab.tabChain"),
      tabAmount: t("HistoryTab.tabAmount"),
      tabToken: t("HistoryTab.tabToken"),
    },
    DiscordBanner: {
      cta: t("DiscordBanner.cta"),
    },
  };

  return (
    <TranslationContext.Provider value={{ translations }}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useAppTranslations<K extends keyof Translations>(
  section: K
): Translations[K] {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error(
      "useAppTranslations must be used within a TranslationProvider"
    );
  }
  return context.translations[section] as Translations[K];
}
