"use client";

import { type ReactNode } from "react";
import ConnectKitProviders from "@/context/ConnectKitProvider";

export default function ClientProviders({ children }: { children: ReactNode }) {
  return <ConnectKitProviders>{children}</ConnectKitProviders>;
}
