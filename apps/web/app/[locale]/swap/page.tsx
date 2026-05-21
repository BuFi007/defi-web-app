/**
 * /swap — RSC shell.
 *
 * Wave-L3 (PR-H9). The widget itself is client-only (wagmi hooks, sign
 * prompts, local timer for the quote TTL), so this page is a thin shim
 * that pulls in the locale param the rest of `[locale]/...` already
 * threads through and mounts <SwapWidget />.
 */
import type { Metadata } from "next";

import { SwapWidget } from "@/components/swap/swap-widget";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata: Metadata = {
  title: "Swap | BUFI",
  description:
    "Spot swap USDC ↔ EURC / MXNB / JPYC / CHFC via the BUFX venue router and the FX Telaraña / Uniswap v4 pool path.",
};

export default async function SwapPage({ params }: PageProps) {
  // `locale` is already resolved by the [locale] segment; we don't
  // surface it to the widget today but `await params` is the
  // Next.js 16 cache-components gate so this needs to stay before any
  // dynamic data read.
  await params;
  return (
    <div className="swap-page-wrap">
      <SwapWidget />
    </div>
  );
}
