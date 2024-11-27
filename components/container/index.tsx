"use client";

import React from "react";
import dynamic from "next/dynamic";
import { ContainerSkeleton } from "@/components/skeleton-card";
import { Suspense } from "react";

const AnimatedBackground = dynamic(
  () => import("@/components/animated-background/index"),
);

const Container: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
      <div className="relative bg-gradient-to-br from-indigo-100 via-violet-200 to-cyan-300 bg-no-repeat justify-center items-center mx-auto w-full lg:max-w-7xl border border-black rounded-lg overflow-hidden">
        <AnimatedBackground className="absolute top-0 left-0 w-full h-auto" />
        {children}
      </div>
  );
};

export default Container;
