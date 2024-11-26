"use client";

import React, { Suspense } from "react";
import { useWindowSize } from "@/hooks/use-window-size";
import { Skeleton } from "@/components/ui/skeleton";
import HeaderFull from "./nav-full";
import MobileMenu from "./mobile-menu";

const Header: React.FC = () => {
  const { width } = useWindowSize();

  return (
    <header className="bg-transparent relative pb-6">
      <Suspense fallback={<Skeleton className="h-4 w-[250px]" />}>
        {width && width >= 1024 ? <HeaderFull /> : <MobileMenu />}
      </Suspense>
    </header>
  );
};

export default Header;

