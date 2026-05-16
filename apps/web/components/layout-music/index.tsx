"use client";

import dynamic from "next/dynamic";
import React from "react";

const RadioBar = dynamic(() => import("@/components/radio"), {
  ssr: false,
  loading: () => null,
});

const LayoutMusic: React.FC = () => <RadioBar />;

export default LayoutMusic;
