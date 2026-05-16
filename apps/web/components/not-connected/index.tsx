"use client";

import React from "react";
import { useAppTranslations } from "@/context/TranslationContext";


export const NotConnectedHome: React.FC = () => {
  const translations = useAppTranslations('Home');

    return (
      <div className="p-4 overflow-hidden h-full flex flex-col items-center justify-center">
        <div className="relative flex flex-col items-center justify-center w-full ">
          <div className="relative z-10 text-center bg-background dark:bg-background rounded-lg shadow-lg p-8 max-w-md w-full border-2 border-purpleDanis">
            <h1 className="text-4xl font-bold m-4 text-purpleDanis">
              {translations.welcome}
            </h1>
            <p className="text-lg mb-4 text-purpleDanis">
              {translations.connectWalletAlert}
            </p>
            <p className="text-3xl mb-8 tracking-wide">🚬🥃👻🕸️</p>
          </div>
        </div>
      </div>
    );
  }

