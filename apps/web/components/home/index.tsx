"use client";

import React from "react";
import { useAccount } from "wagmi";
import { NotConnectedHome } from "@/components/not-connected";
import TradeIsland from "@/components/trade-island";
import "@/css/trade-island/index.css";

// Debug toggle: render the TradeIsland without a connected wallet so the
// mobile/responsive surface can be reviewed in isolation. Flip back to false
// after design QA. The user has asked me to leave this declaration in place
// (they will revert it on their end).
const FORCE_ISLAND = true;

export const HomeContent: React.FC = () => {
  const { isConnected } = useAccount();

  if (!isConnected && !FORCE_ISLAND) return <NotConnectedHome />;

  return <TradeIsland />;
};
