"use client";

import React from "react";
import MoneyMarketTabs from "./bento-1";
import PositionSummary from "./bento-4/market-positions-table";

// Simplified vertical stack — was a 3-col bento grid where bento-2 (MarketInfo)
// was stuck in infinite skeleton state and bento-3 (BooFiGhostCard) was a
// loading placeholder. Both blocked the layout from fitting the parent card.
// Restore the bento layout once those panels have real content + finished
// data sources.
export default function MoneyMarketBentoGrid() {
  return (
    <div className="flex flex-col gap-4 w-full">
      <section className="w-full">
        <MoneyMarketTabs />
      </section>
      <section className="w-full">
        <PositionSummary />
      </section>
    </div>
  );
}
