"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useSpacemanTheme } from "@/components/theme-provider";
import { useGhostMode } from "@/context/GhostModeContext";
import { cn } from "@/utils";

const SIZES = {
  idle: { width: 56, height: 36, radius: 8 },
  notice: { width: 280, height: 50, radius: 999 },
} as const;

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export function ModeToggle() {
  const { resolvedTheme, switchTheme, ref: spacemanRef } = useSpacemanTheme();
  const { isGhostMode, setGhostMode, isHydrated } = useGhostMode();
  const [showNotice, setShowNotice] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // Anti-flash: while hydrating, fall back to whatever the provider has applied.
  const inGhostMode = isHydrated ? isGhostMode : resolvedTheme === "dark";

  const handleClick = () => {
    const nextGhost = !isGhostMode;
    setGhostMode(nextGhost);

    // Spaceman circle-reveal: animation origin is the button's ref position.
    void switchTheme(nextGhost ? "dark" : "light");

    if (timerRef.current) clearTimeout(timerRef.current);
    if (nextGhost) {
      setShowNotice(true);
      timerRef.current = setTimeout(() => setShowNotice(false), 3800);
    } else {
      setShowNotice(false);
    }
  };

  const currentSize = showNotice ? SIZES.notice : SIZES.idle;
  const backgroundColor = showNotice
    ? "rgba(10, 8, 18, 0.96)"
    : "rgba(255, 255, 255, 1)";

  return (
    <motion.button
      ref={spacemanRef}
      type="button"
      onClick={handleClick}
      initial={false}
      animate={{
        width: currentSize.width,
        height: currentSize.height,
        borderRadius: currentSize.radius,
        backgroundColor,
      }}
      transition={{ type: "spring", bounce: 0.32, duration: 0.5 }}
      style={{ transformOrigin: "0% 50%" }}
      aria-label={
        showNotice
          ? "Dismiss Ghost Mode"
          : inGhostMode
            ? "Leave Ghost Mode"
            : "Enter Ghost Mode"
      }
      aria-pressed={inGhostMode}
      className={cn(
        "relative shrink-0 z-50 overflow-hidden ring-1 backdrop-blur-xl focus-visible:outline-none focus-visible:ring-2",
        showNotice
          ? "ring-white/10 shadow-[0_18px_50px_-16px_rgba(105,84,207,0.7)] focus-visible:ring-white/40"
          : "ring-purpleDanis/15 dark:ring-white/10 shadow-xl focus-visible:ring-purpleDanis/40 dark:focus-visible:ring-white/40",
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {showNotice ? (
          <motion.div
            key="notice"
            initial={{ opacity: 0, scale: 0.94, filter: "blur(6px)" }}
            animate={{
              opacity: 1,
              scale: 1,
              filter: "blur(0px)",
              transition: { duration: 0.24, ease: EASE_OUT, delay: 0.08 },
            }}
            exit={{
              opacity: 0,
              scale: 0.92,
              filter: "blur(6px)",
              transition: { duration: 0.18 },
            }}
            className="h-full w-full flex items-center gap-2.5 pl-1.5 pr-4"
          >
            <span
              className="h-9 w-9 grid place-items-center rounded-full bg-gradient-to-br from-purpleDanis to-[#9F8AE8] text-base shrink-0 shadow-[0_4px_12px_-4px_rgba(105,84,207,0.6)]"
              aria-hidden
            >
              👻
            </span>
            <div className="leading-tight min-w-0 flex-1 text-left">
              <div className="text-[12px] font-semibold text-white tracking-tight">
                Ghost Mode
              </div>
              <div className="text-[10px] text-white/55 truncate">
                You can now trade privately
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="button"
            initial={{ opacity: 0, scale: 0.88, filter: "blur(4px)" }}
            animate={{
              opacity: 1,
              scale: 1,
              filter: "blur(0px)",
              transition: { duration: 0.2, ease: EASE_OUT },
            }}
            exit={{
              opacity: 0,
              scale: 0.88,
              filter: "blur(4px)",
              transition: { duration: 0.16 },
            }}
            className="h-full w-full grid place-items-center text-purpleDanis"
          >
            <AnimatePresence initial={false} mode="wait">
              {inGhostMode ? (
                <motion.span
                  key="sun"
                  initial={{ opacity: 0, rotate: -45, scale: 0.7 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: 45, scale: 0.7 }}
                  transition={{ duration: 0.18, ease: EASE_OUT }}
                >
                  <Sun size={20} />
                </motion.span>
              ) : (
                <motion.span
                  key="moon"
                  initial={{ opacity: 0, rotate: 45, scale: 0.7 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: -45, scale: 0.7 }}
                  transition={{ duration: 0.18, ease: EASE_OUT }}
                >
                  <Moon size={20} />
                </motion.span>
              )}
            </AnimatePresence>
            <span className="sr-only">Toggle Ghost Mode</span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
