"use client";

import { memo } from "react";

type AnimatedBackgroundProps = {
  className?: string;
};

const AnimatedBackground = ({ className = "" }: AnimatedBackgroundProps) => {
  return (
    <div className={`pointer-events-none overflow-hidden ${className}`} aria-hidden="true">
      <div className="absolute inset-[-18%] animate-[bufiLiquidDrift_18s_ease-in-out_infinite_alternate] bg-[radial-gradient(circle_at_18%_22%,rgba(255,240,183,0.42),transparent_24%),radial-gradient(circle_at_58%_42%,rgba(232,115,217,0.28),transparent_30%),radial-gradient(circle_at_76%_78%,rgba(105,84,207,0.24),transparent_28%)] blur-3xl" />
      <div className="absolute inset-[-14%] animate-[bufiLiquidFloat_24s_linear_infinite_alternate] bg-[conic-gradient(from_110deg_at_48%_52%,rgba(255,255,255,0.3),rgba(171,140,250,0.28),rgba(250,153,191,0.24),rgba(255,255,255,0.26))] opacity-70 blur-2xl" />
    </div>
  );
};

export default memo(AnimatedBackground);
