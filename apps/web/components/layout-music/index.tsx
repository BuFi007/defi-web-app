"use client";

import dynamic from "next/dynamic";
import React from "react";
import { RadioBarSkeleton } from "@/components/skeleton-card";

const RadioBar = dynamic(() => import("@/components/radio"), {
  ssr: false,
  loading: () => <RadioBarSkeleton />,
});

const LayoutMusic: React.FC = () => <RadioBar />;

export default LayoutMusic;
