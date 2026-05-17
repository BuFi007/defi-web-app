"use client";

import React from "react";

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

const isDynamicNoise = (message: string) =>
  message.includes("dynamicauth.com") ||
  message.includes("DynamicSDK") ||
  message.includes("Failed to prefetch nonces") ||
  message.includes("Client initialization failed");

// Dev-only: stops the Dynamic SDK's async CORS / blocked-by-extension
// rejections from triggering Next's red error overlay. Production deploys
// have the origin allow-listed, so this path never runs there.
export function installDynamicRejectionFilter() {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV !== "development") return;
  if ((window as unknown as { __bufiDynamicFilter?: boolean }).__bufiDynamicFilter) return;
  (window as unknown as { __bufiDynamicFilter?: boolean }).__bufiDynamicFilter = true;

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message =
      typeof reason === "string"
        ? reason
        : reason instanceof Error
          ? `${reason.name}: ${reason.message}\n${reason.stack ?? ""}`
          : "";
    if (isDynamicNoise(message) || message.includes("Failed to fetch")) {
      event.preventDefault();
    }
  });
}

export class DynamicErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // Swallow Dynamic-shaped render errors; surface everything else.
    if (!isDynamicNoise(`${error.name}: ${error.message}`)) {
      // eslint-disable-next-line no-console
      console.error("[DynamicErrorBoundary] unexpected error", error);
    }
  }

  render() {
    // Even on error we keep rendering children — the rest of the tree
    // (wallet-less browsing, theming, i18n) should remain usable.
    return this.props.children;
  }
}
