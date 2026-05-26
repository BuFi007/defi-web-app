"use client";

import { ConnectKitProvider as CKProvider, ConnectKitButton } from "connectkit";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "@/lib/wagmi";
import { ReactNode } from "react";
import { DevWalletProvider } from "@/lib/dev-wallet";
import { SessionBridge } from "@/lib/session";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletConflictDetector } from "@/components/wallet-conflict-detector";

const queryClient = new QueryClient();

export { ConnectKitButton };

const bufxTheme = {
  "--ck-font-family": "'Nunito', sans-serif",
  "--ck-body-color": "#1B142D",
  "--ck-body-color-muted": "#999999",
  "--ck-body-color-muted-hover": "#1B142D",
  "--ck-body-color-danger": "#FF4E4E",
  "--ck-body-color-valid": "#32D74B",
  "--ck-body-background": "#ffffff",
  "--ck-body-background-secondary": "#f6f7f9",
  "--ck-body-background-tertiary": "#F3F4F7",
  "--ck-body-divider": "#f7f6f8",
  "--ck-body-action-color": "#999999",
  "--ck-border-radius": "20px",
  "--ck-modal-heading-font-weight": "700",
  "--ck-modal-box-shadow": "0px 4px 24px 0px rgba(91, 56, 192, 0.12)",
  "--ck-overlay-background": "rgba(27, 20, 45, 0.4)",
  "--ck-overlay-backdrop-filter": "blur(8px)",
  "--ck-primary-button-color": "#ffffff",
  "--ck-primary-button-background": "#5B38C0",
  "--ck-primary-button-box-shadow": "0 0 0 0 #ffffff",
  "--ck-primary-button-border-radius": "12px",
  "--ck-primary-button-font-weight": "700",
  "--ck-primary-button-hover-color": "#ffffff",
  "--ck-primary-button-hover-background": "#4A2DA6",
  "--ck-primary-button-hover-box-shadow": "0 0 0 0 #ffffff",
  "--ck-primary-button-active-background": "#3E2590",
  "--ck-primary-button-active-box-shadow": "0 0 0 0 #ffffff",
  "--ck-secondary-button-color": "#1B142D",
  "--ck-secondary-button-background": "#F6F7F9",
  "--ck-secondary-button-box-shadow": "0 0 0 0 #ffffff",
  "--ck-secondary-button-border-radius": "12px",
  "--ck-secondary-button-font-weight": "600",
  "--ck-secondary-button-hover-color": "#1B142D",
  "--ck-secondary-button-hover-background": "#EDEAF5",
  "--ck-secondary-button-hover-box-shadow": "0 0 0 0 #ffffff",
  "--ck-secondary-button-active-background": "#E2D0FD",
  "--ck-secondary-button-active-box-shadow": "0 0 0 0 #ffffff",
  "--ck-tertiary-button-color": "#1B142D",
  "--ck-tertiary-button-background": "#F6F7F9",
  "--ck-tertiary-button-box-shadow": "0 0 0 0 #ffffff",
  "--ck-tertiary-button-border-radius": "12px",
  "--ck-tertiary-button-font-weight": "600",
  "--ck-tertiary-button-hover-color": "#1B142D",
  "--ck-tertiary-button-hover-background": "#EDEAF5",
  "--ck-tertiary-button-hover-box-shadow": "0 0 0 0 #ffffff",
  "--ck-connectbutton-font-size": "14px",
  "--ck-connectbutton-border-radius": "12px",
  "--ck-connectbutton-color": "#5B38C0",
  "--ck-connectbutton-background": "#ffffff",
  "--ck-connectbutton-box-shadow": "0 0 0 1.5px rgba(91, 56, 192, 0.3)",
  "--ck-connectbutton-hover-color": "#5B38C0",
  "--ck-connectbutton-hover-background": "#EDEAF5",
  "--ck-connectbutton-hover-box-shadow": "0 0 0 1.5px rgba(91, 56, 192, 0.5)",
  "--ck-connectbutton-active-color": "#5B38C0",
  "--ck-connectbutton-active-background": "#E2D0FD",
  "--ck-connectbutton-active-box-shadow": "0 0 0 1.5px #5B38C0",
  "--ck-focus-color": "#5B38C0",
  "--ck-spinner-color": "#5B38C0",
  "--ck-qr-dot-color": "#1B142D",
  "--ck-qr-background": "#ffffff",
  "--ck-qr-border-color": "#f7f6f8",
  "--ck-qr-border-radius": "16px",
  "--ck-tooltip-color": "#999999",
  "--ck-tooltip-background": "#ffffff",
  "--ck-tooltip-background-secondary": "#ffffff",
  "--ck-tooltip-shadow": "0px 2px 10px 0 rgba(91, 56, 192, 0.1)",
  "--ck-recent-badge-color": "#5B38C0",
  "--ck-recent-badge-background": "#EDEAF5",
  "--ck-recent-badge-border-radius": "32px",
  "--ck-body-disclaimer-color": "#AAAAAB",
  "--ck-body-disclaimer-link-color": "#5B38C0",
  "--ck-body-disclaimer-link-hover-color": "#1B142D",
  "--ck-body-disclaimer-background": "#f6f7f9",
};

export default function ConnectKitProviders({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <CKProvider
          theme="soft"
          customTheme={bufxTheme}
          options={{
            walletConnectName: "WalletConnect",
            hideBalance: false,
            hideTooltips: false,
            enforceSupportedChains: false,
            embedGoogleFonts: false,
            language: "en-US",
            disclaimer: (
              <>
                By connecting you agree to the{" "}
                <a
                  target="_blank"
                  rel="noopener noreferrer"
                  href="https://fx.bu.finance/terms"
                >
                  Terms of Service
                </a>
              </>
            ),
          }}
        >
          <DevWalletProvider>
            <SessionBridge />
            <WalletConflictDetector />
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          </DevWalletProvider>
        </CKProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
