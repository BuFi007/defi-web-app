"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";

type ConnectKitProvidersComponent = ComponentType<{ children: ReactNode }>;

export default function ClientProviders({ children }: { children: ReactNode }) {
  const [ConnectKitProviders, setConnectKitProviders] =
    useState<ConnectKitProvidersComponent | null>(null);

  useEffect(() => {
    let cancelled = false;

    void import("@/context/ConnectKitProvider")
      .then((mod) => {
        if (!cancelled) setConnectKitProviders(() => mod.default);
      })
      .catch((error) => {
        console.error("Failed to load wallet providers", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!ConnectKitProviders) return null;

  return <ConnectKitProviders>{children}</ConnectKitProviders>;
}
