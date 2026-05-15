"use client";

import { useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import Intro1 from "@/components/intro/intro-1";
import Intro2 from "@/components/intro/intro-2";

const ABYSS_FADE_MS = 500;

export const AlphaForm = () => {
  const [step, setStep] = useState<1 | 2>(1);
  const [abyss, setAbyss] = useState(false);
  const abyssTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (abyssTimeoutRef.current) clearTimeout(abyssTimeoutRef.current);
    };
  }, []);

  useHotkeys(
    "meta+k, ctrl+k",
    (event) => {
      if (step !== 1) return;
      event.preventDefault();
      setAbyss(true);
      abyssTimeoutRef.current = setTimeout(() => setStep(2), ABYSS_FADE_MS);
    },
    [step],
  );

  useHotkeys(
    "enter",
    (event) => {
      if (step !== 1) return;
      event.preventDefault();
      setStep(2);
    },
    { enableOnFormTags: false },
    [step],
  );

  return step === 1 ? <Intro1 abyss={abyss} /> : <Intro2 />;
};
