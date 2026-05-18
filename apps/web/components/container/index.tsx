"use client";

import React from "react";
import dynamic from "next/dynamic";

const AnimatedBackground = dynamic(
  () => import("@/components/animated-background/index"),
);

const Container: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="relative bg-transparent items-stretch mx-auto w-full min-h-full overflow-visible md:overflow-hidden flex flex-col ring-0 md:ring-2 ring-inset md:ring-purpleDanis md:dark:ring-violetDanis rounded-none md:rounded-2xl p-0 md:px-6 md:py-5">
      {/* Animated WebGL background on tablet + desktop (≥md = 768px). Only
          phone (<768px) renders flat. The md:opacity-100 + md:visible bits
          are required because global.scss:119 overrides `.hidden` to also
          set opacity:0 + visibility:hidden — `md:block` flips display back
          on but those two need explicit md overrides to actually show. */}
      <div className="hidden md:block md:opacity-100 md:visible absolute inset-0">
        <AnimatedBackground
          className="absolute inset-0 w-full h-full md:rounded-[inherit]"
          variant="bufi"
        />
      </div>
      <div className="relative z-10 flex-1 w-full flex flex-col">
        {children}
      </div>
    </div>
  );
};

export default Container;
