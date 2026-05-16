"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import LocalSwitcher from "@/components/locale-switcher";
import { ModeToggle } from "@/components/theme-toggle";
import SparklesText from "@/components/magicui/sparkles-text";
import { motion } from "framer-motion";
import { Skeleton } from "../ui/skeleton";
import { DynamicWidget } from "@dynamic-labs/sdk-react-core";
import { useHoverAudio } from "@/utils/audio-hover";
import { ActionBannerSkeleton } from "@/components/skeleton-card";
import dynamic from "next/dynamic";
import WalletModule from "@/components/wallet-module";

const ActionBanner = dynamic(() => import("./action-banner"), {
  loading: () => <ActionBannerSkeleton />,
});
const song = "/sounds/anime-wow-sound-effect.mp3";
const MotionLink = motion.create(Link);

const HeaderFull: React.FC = () => {
  const { playHoverSound, resetHoverSound } = useHoverAudio(song);

  return (
    <>
      <ActionBanner />
      <div className="container mx-auto grid grid-cols-3 items-center relative z-100">
        <div className="relative z-[200] flex items-center space-x-2">
          <Suspense fallback={<Skeleton className="h-4 w-[250px]" />}>
            <ModeToggle />
            <LocalSwitcher />
          </Suspense>
          <span className="h-px flex-1 bg-purpleDanis"></span>
        </div>
        <div className="flex justify-center z-100">
          <MotionLink
            href="/"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            onHoverStart={playHoverSound}
            onHoverEnd={resetHoverSound}
            className="group"
          >
            <SparklesText sparklesCount={18} duration={2.6}>
              <div className="flex items-center">
                <Image
                  src="/images/iso-logo.png"
                  alt="Bu Logo"
                  width={574}
                  height={569}
                  style={{ height: "auto", width: "100px" }}
                />
                <div className="overflow-hidden max-w-0 opacity-0 -translate-x-2 group-hover:max-w-[160px] group-hover:opacity-100 group-hover:translate-x-0 transition-[max-width,opacity,transform] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[max-width,transform]">
                  <Image
                    src="/assets/tipografico-alpha.png"
                    alt="BU.FI"
                    width={743}
                    height={256}
                    className="h-auto w-[140px] -ml-1.5 select-none"
                    priority={false}
                  />
                </div>
              </div>
            </SparklesText>
          </MotionLink>
        </div>
        <div className="flex items-center justify-end">
          <span className="h-px flex-grow bg-purpleDanis"></span>
          <Suspense fallback={<Skeleton className="h-4 w-[250px]" />}>
            <div className="flex items-center gap-3 z-20">
              <WalletModule />
              <DynamicWidget />
            </div>
          </Suspense>
        </div>
      </div>
    </>
  );
};

export default HeaderFull;
