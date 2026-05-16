"use client";

import React from "react";
import { BentoGrid, BentoGridItem } from "@/components/bento-grid";
import MoneyMarketTabs from "./bento-1";
import ApyAssets from "./bento-2/market-info";
import BooFiGhostCard from "@/components/boofi-ghost-card";
import PositionSummary from "./bento-4/market-positions-table";

export default function MoneyMarketBentoGrid() {
  return (
    <BentoGrid className="max-w-full mx-auto ">
      <BentoGridItem
        className="md:col-span-2"
        title={null}
        description={null}
        header={<MoneyMarketTabs />}
        icon={null}
      />

      <BentoGridItem
        className="md:col-span-1"
        title={null}
        description={null}
        header={<ApyAssets />}
        icon={null}
      />

      <BentoGridItem
        className="md:col-span-1"
        title={null}
        description={null}
        header={<BooFiGhostCard />}
        icon={null}
      />

      <BentoGridItem
        className="md:col-span-2"
        title={null}
        description={null}
        header={<PositionSummary />}
        icon={null}
      />
    </BentoGrid>
  );
}
