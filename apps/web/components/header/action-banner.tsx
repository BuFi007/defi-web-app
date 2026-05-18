"use client";

import Link from "next/link";
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppTranslations } from "@/context/TranslationContext";

const EASE_OUT_CUBIC = [0.22, 1, 0.36, 1] as const;
const EASE_IN_CUBIC = [0.32, 0, 0.67, 0] as const;

export default function ActionBanner() {
  const [isVisible, setIsVisible] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const translations = useAppTranslations("DiscordBanner");

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(false), 20000);
    return () => clearTimeout(timer);
  }, []);

  // Tell downstream layout the banner is consuming vertical space. The
  // trade-island CSS reads `[data-banner="open"]` on the body to tighten
  // its max-height — otherwise the island fills flex-1 + 50px and its
  // bottom kisses the music bar while the banner is up. Cleared as soon
  // as the banner unmounts (timer expiry or user dismiss).
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (isVisible) {
      document.body.dataset.banner = "open";
      return () => {
        delete document.body.dataset.banner;
      };
    }
    delete document.body.dataset.banner;
    return undefined;
  }, [isVisible]);

  return (
    <AnimatePresence initial={false}>
      {isVisible && (
        <motion.div
          layout
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{
            opacity: 0,
            y: -16,
            transition: { duration: 0.24, ease: EASE_IN_CUBIC },
          }}
          transition={{ duration: 0.42, ease: EASE_OUT_CUBIC }}
          className="relative w-full overflow-hidden isolate will-change-transform"
        >
          {/* Original banner colors — blurred gradient underlay + bg-white/10 overlay */}
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-gradient-to-bl from-purple-700/60 to-teal-600/80 dark:from-indigo-900 dark:via-purple-900 dark:to-cyan-900 opacity-50 blur-xl dark:bg-gradient-to-r"
          />
          <div
            aria-hidden
            className="absolute inset-0 -z-10 backdrop-blur-md bg-white/10"
          />

          <div className="relative px-3 py-2 flex items-center justify-between">
            <Link
              href="https://discord.gg/GnbJByDqrM"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex-1 flex items-center justify-center gap-3 no-underline py-1 mr-10"
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              aria-label="Join our Discord community"
            >
              <motion.svg
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 fill-white shrink-0"
                aria-hidden="true"
                animate={{ rotate: isHovered ? 360 : 0 }}
                transition={{ duration: 0.6, ease: EASE_OUT_CUBIC }}
                style={{ willChange: "transform" }}
              >
                <path
                  d="M20.317 4.3698a19.7913 19.7913 0 00-4.8859-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2763-3.68-.2763-5.4868 0-.1636-.3934-.4058-.8742-.6177-1.2495a.077.0770 0 00-.0785-.037 19.7363 19.7363 0 00-4.8859 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5795.0996 18.0578a.0824.0824 0 00.0312.0561c2.0527 1.5027 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.0760 0 00-.0416-.1047c-.6528-.2476-1.2733-.5495-1.8722-.8923a.077.0770 0 01-.0076-.1287c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.0770 0 01-.0066.1287 12.2986 12.2986 0 01-1.8733.8914.0758.0758 0 00-.0407.1057c.3608.698.7723 1.3628 1.225 1.9932a.076.0760 0 00.0842.0286c1.961-.6067 3.9495-1.5268 6.0022-3.0294a.078.0780 0 00.0312-.0561c.5004-5.177-.8382-9.657-3.5485-13.6604a.061.0610 0 00-.0312-.0286zM8.02 15.3312c-1.1837 0-2.1532-1.0857-2.1532-2.419 0-1.3332.9555-2.4189 2.1532-2.4189 1.2108 0 2.1733 1.0974 2.1532 2.419 0 1.3332-.9555 2.4189-2.1532 2.4189zm7.9748 0c-1.1837 0-2.1532-1.0857-2.1532-2.419 0-1.3332.9555-2.4189 2.1532-2.4189 1.2108 0 2.1733 1.0974 2.1532 2.419 0 1.3332-.9424 2.4189-2.1532 2.4189Z"
                />
              </motion.svg>

              <p className="font-clash text-xs text-center transition-transform duration-300 ease-out group-hover:translate-y-[-1px]">
                <span className="inline-block font-clash bg-gradient-to-r from-indigo-700 via-purple-600 to-cyan-700 dark:from-indigo-300 dark:via-purple-400 dark:to-cyan-400 bg-clip-text text-transparent">
                  {translations.cta}
                </span>
              </p>

              <motion.svg
                viewBox="0 0 20 15"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="h-3 w-3 shrink-0"
                animate={{ x: isHovered ? 4 : 0 }}
                transition={{ duration: 0.32, ease: EASE_OUT_CUBIC }}
                style={{ willChange: "transform" }}
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M10.9497 1.56716L15.7542 6.3806L-3.76766e-07 6.3806L-2.78905e-07 8.6194L15.7542 8.6194L10.9497 13.4328L12.514 15L20 7.5L12.514 4.06671e-07L10.9497 1.56716Z"
                  fill="#6954CF"
                />
              </motion.svg>
            </Link>

            <button
              onClick={() => setIsVisible(false)}
              className="ml-2 -mr-1 h-6 w-6 grid place-items-center rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              aria-label="Close banner"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
