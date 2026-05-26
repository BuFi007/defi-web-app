"use client";

import { type ReactNode } from "react";
import dynamic from "next/dynamic";

const ConnectKitProviders = dynamic(
  () => import("@/context/ConnectKitProvider"),
  { ssr: false },
);

export default function ClientProviders({ children }: { children: ReactNode }) {
  return <ConnectKitProviders>{children}</ConnectKitProviders>;
}
