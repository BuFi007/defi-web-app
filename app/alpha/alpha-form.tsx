"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useHotkeys } from "react-hotkeys-hook";
import Intro1 from "@/components/intro/intro-1";
import Intro2 from "@/components/intro/intro-2";
import { easeOut } from "@/utils/animations";

const ABYSS_FADE_MS = 500;

const stepVariants = {
  initial: { opacity: 0, scale: 0.97, filter: "blur(8px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.98, filter: "blur(8px)" },
};

const stepTransition = { duration: 0.26, ease: easeOut };

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
      event.preventDefault();
      if (abyssTimeoutRef.current) {
        clearTimeout(abyssTimeoutRef.current);
        abyssTimeoutRef.current = null;
      }
      if (step === 1) {
        setAbyss(true);
        abyssTimeoutRef.current = setTimeout(() => setStep(2), ABYSS_FADE_MS);
      } else {
        setStep(1);
        setAbyss(false);
      }
    },
    { enableOnFormTags: ["input", "textarea"] },
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

  return (
    <AnimatePresence mode="wait" initial={false}>
      {step === 1 ? (
        <motion.div
          key="intro1"
          variants={stepVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={stepTransition}
        >
          <Intro1 abyss={abyss} />
        </motion.div>
      ) : (
        <motion.div
          key="intro2"
          variants={stepVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={stepTransition}
        >
          <Intro2 />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
