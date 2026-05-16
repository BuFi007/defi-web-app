"use client";

import React from "react";
import dynamic from "next/dynamic";

const AnimatedBackground = dynamic(
  () => import("@/components/animated-background/index"),
);

const Container: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="relative bg-transparent justify-center items-center mx-auto w-full h-full ring-2 ring-inset ring-purpleDanis dark:ring-violetDanis rounded-2xl overflow-hidden flex flex-col px-10 py-8">
      <AnimatedBackground className="absolute inset-0 w-full h-full rounded-[inherit]" />
      <div className="relative z-10 flex-1 w-full flex flex-col">
        {children}
      </div>
    </div>
  );
};

export default Container;
