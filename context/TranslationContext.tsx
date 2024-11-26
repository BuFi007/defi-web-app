"use client";

import React, { createContext, useContext, ReactNode } from "react";
import { Translations } from "@/lib/types";
import { useTranslations } from "next-intl";

interface TranslationContextType {
  translations: Partial<Translations>;
}

const TranslationContext = createContext<TranslationContextType | undefined>(
  undefined
);

export function TranslationProvider({ children }: { children: ReactNode }) {
  const t = useTranslations();

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
    EnsAlertDialog: {
      actionButton: t("EnsAlertDialog.actionButton"),
      callToAction: t("EnsAlertDialog.callToAction"),
    },
    PeanutTab: {
      sendTab: t("PeanutTab.sendTab"),
      receiveTab: t("PeanutTab.receiveTab"),
      historyTab: t("PeanutTab.historyTab"),
      linkTitle: t("PeanutTab.linkTitle"),
      createLinkButton: t("PeanutTab.createLinkButton"),
      claimReady: t("PeanutTab.claimReady"),
      currentTextStartingClaim: t("PeanutTab.currentTextStartingClaim"),
      currentTextAlreadyClaimed: t("PeanutTab.currentTextAlreadyClaimed"),
      currentTextClaiming: t("PeanutTab.currentTextClaiming"),
      currentTextAlreadyClaimedTitle: t(
        "PeanutTab.currentTextAlreadyClaimedTitle"
      ),
      handleFetchLinkDetailsError: t("PeanutTab.handleFetchLinkDetailsError"),
      currentTextProgress: t("PeanutTab.currentTextProgress"),
      currentTextClaimSuccess: t("PeanutTab.currentTextClaimSuccess"),
      currentTextClaimError: t("PeanutTab.currentTextClaimError"),
      currentTextClaimComplete: t("PeanutTab.currentTextClaimComplete"),
      currentTextCrossChainProgress: t(
        "PeanutTab.currentTextCrossChainProgress"
      ),
      currentTextCrossChainSuccess: t("PeanutTab.currentTextCrossChainSuccess"),
      currentTextCrossChainError: t("PeanutTab.currentTextCrossChainError"),
      currentTextCrossChainComplete: t(
        "PeanutTab.currentTextCrossChainComplete"
      ),
      claimTitle: t("PeanutTab.claimTitle"),
      claimSuccessTitle: t("PeanutTab.claimSuccessTitle"),
      claimDescription: t("PeanutTab.claimDescription"),
      claimPaste: t("PeanutTab.claimPaste"),
      claimVerify: t("PeanutTab.claimVerify"),
      claimClaim: t("PeanutTab.claimClaim"),
      claimSuccess: t("PeanutTab.claimSuccess"),
      claimDestinationChain: t("PeanutTab.claimDestinationChain"),
      claimViewInExplorer: t("PeanutTab.claimViewInExplorer"),
    },
    PaymentsTab: {},
    CurrencyDisplayer: {
      availableBalance: t("CurrencyDisplayer.availableBalance"),
      loadingBalance: t("CurrencyDisplayer.loadingBalance"),
    },
    Overlay: {
      frameText: t("Overlay.frameText"),
      linkSubtitle: t("Overlay.linkSubtitle"),
      linkCopied: t("Overlay.linkCopied"),
      linkDescription: t("Overlay.linkDescription"),
      shareWhatsapp: t("Overlay.shareWhatsapp"),
      shareTelegram: t("Overlay.shareTelegram"),
      hashTxText: t("Overlay.hashTxText"),
      viewInExplorer: t("Overlay.viewInExplorer"),
      currentTextProgress: t("Overlay.currentTextProgress"),
      currentTextSuccess: t("Overlay.currentTextSuccess"),
      currentTextFailed: t("Overlay.currentTextFailed"),
      currentTextSpooky: t("Overlay.currentTextSpooky"),
      toastError: t("Overlay.toastError"),
      toastCopyTitle: t("Overlay.toastCopyTitle"),
      toastCopyDescription: t("Overlay.toastCopyDescription"),
    },
    CCIPBridge: {
      connectWallet: t('CCIPBridge.connectWallet'),
      title: t('CCIPBridge.title'),
      toastTitleNetwork: t('CCIPBridge.toastTitleNetwork'),
      toastDescriptionNetwork: t('CCIPBridge.toastDescriptionNetwork'),
      toastDescriptionNetwork2: t('CCIPBridge.toastDescriptionNetwork2'),
      toastTitleError: t('CCIPBridge.toastTitleError'),
      toastDescriptionError: t('CCIPBridge.toastDescriptionError'),
      toastSentTitle: t('CCIPBridge.toastSentTitle'),
      toastSentDescription: t('CCIPBridge.toastSentDescription'),
      sourceChain: t('CCIPBridge.sourceChain'),
      destinationChain: t('CCIPBridge.destinationChain'),
      buttonText: t('CCIPBridge.buttonText'),
      linkTitle: t('CCIPBridge.linkTitle'),
      labelBridge: t('CCIPBridge.labelBridge'),
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
