"use client";

import React from "react";
import { ConnectKitButton } from "connectkit";
import { useI18n } from "@/locales/client";


export const NotConnectedHome: React.FC = () => {
  const t = useI18n();

    return (
      <div className="min-h-[60vh] w-full flex items-center justify-center p-4">
        <div className="relative z-10 text-center bg-background dark:bg-background rounded-lg shadow-lg p-8 max-w-md w-full border-2 border-purpleDanis">
          <h1 className="text-4xl font-knicknack m-4 text-purpleDanis">
            {t('Home.welcome')}
          </h1>
          <p className="text-lg mb-4 text-purpleDanis">
            {t('Wallet.pleaseConnectWallet')}
          </p>
          <p className="text-3xl mb-6 tracking-wide">🚬🥃👻🕸️</p>
          <div className="flex justify-center">
            <ConnectKitButton />
          </div>
        </div>
      </div>
    );
  }

