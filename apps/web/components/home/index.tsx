"use client";

import React from "react";
import { useAccount } from "wagmi";
import { NotConnectedHome } from "@/components/not-connected";
import TradeIsland from "@/components/trade-island";
import "@/css/trade-island/index.css";

export const HomeContent: React.FC = () => {
  const { isConnected } = useAccount();

  if (!isConnected) return <NotConnectedHome />;

  return <TradeIsland />;
};
