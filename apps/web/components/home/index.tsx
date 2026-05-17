"use client";

import React from "react";
import { useAccount } from "wagmi";
import { NotConnectedHome } from "@/components/not-connected";
import TradeIsland from "@/components/trade-island";
import "@/css/trade-island/index.css";

// DEBUG: temporarily forced on for /browse fit verification — revert before commit
const FORCE_ISLAND = true;

export const HomeContent: React.FC = () => {
  const { isConnected } = useAccount();

  if (!FORCE_ISLAND && !isConnected) return <NotConnectedHome />;

  return <TradeIsland />;
};
