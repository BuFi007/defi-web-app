"use client";

import React, { Suspense } from "react";
import { useWindowSize } from "@/hooks/use-window-size";
import { HeaderSkeleton } from "@/components/skeleton-card";
import HeaderFull from "./nav-full";
import MobileMenu from "./mobile-menu";

const Header: React.FC = () => {
  const { width } = useWindowSize();

  return (
    <Suspense fallback={<HeaderSkeleton />}>
      {width && width >= 1024 ? <HeaderFull /> : <MobileMenu />}
    </Suspense>
  );
};

export default Header;