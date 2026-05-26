"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import { ArrowUpRight, Home as HomeIcon } from "lucide-react";
import { ConnectKitButton } from "connectkit";
import { ModeToggle } from "@/components/theme-toggle";
import LocalSwitcher from "@/components/locale-switcher";
import { useAppTranslations } from "@/context/TranslationContext";
import { cn } from "@/utils";

const ActionBanner = dynamic(() => import("./action-banner"), { ssr: false });

// iOS-style drawer curve (from Ionic) — feels native, not "easeInOut tacky".
const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

type NavItem = {
  href: string;
  label: string;
  caption: string;
  icon: React.ComponentType<{ className?: string }>;
};

const overlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.24, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.18, ease: EASE_OUT } },
};

const panelVariants: Variants = {
  hidden: { opacity: 0, transform: "translateY(-12px)" },
  visible: {
    opacity: 1,
    transform: "translateY(0px)",
    transition: { duration: 0.42, ease: EASE_DRAWER, when: "beforeChildren" },
  },
  exit: {
    opacity: 0,
    transform: "translateY(-8px)",
    transition: { duration: 0.22, ease: EASE_OUT },
  },
};

const childVariants: Variants = {
  hidden: { opacity: 0, transform: "translateY(10px)" },
  visible: (i: number) => ({
    opacity: 1,
    transform: "translateY(0px)",
    transition: { duration: 0.42, ease: EASE_DRAWER, delay: 0.06 + i * 0.045 },
  }),
  exit: { opacity: 0, transition: { duration: 0.14 } },
};

const MobileMenu: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstLinkRef = useRef<HTMLAnchorElement | null>(null);
  const panelId = useId();
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const homeTranslations = useAppTranslations("Home");

  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  // Auto-close on route change so the panel doesn't linger over fresh content.
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Body scroll lock + Esc to close + focus restoration. Locking on the html
  // element (not body) is what actually stops momentum scroll on iOS Safari.
  useEffect(() => {
    if (!isOpen) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const previousPaddingRight = root.style.paddingRight;

    // Prevent the layout from snapping when the scrollbar disappears.
    const scrollbarWidth = window.innerWidth - root.clientWidth;
    if (scrollbarWidth > 0) {
      root.style.paddingRight = `${scrollbarWidth}px`;
    }
    root.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey);

    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Defer one frame so the panel is mounted before we focus into it.
    const focusFrame = window.requestAnimationFrame(() => {
      firstLinkRef.current?.focus();
    });

    return () => {
      root.style.overflow = previousOverflow;
      root.style.paddingRight = previousPaddingRight;
      document.removeEventListener("keydown", onKey);
      window.cancelAnimationFrame(focusFrame);
      previouslyFocused?.focus?.();
    };
  }, [isOpen, close]);

  const navItems: NavItem[] = [
    {
      href: "/",
      label: homeTranslations.welcome ?? "Home",
      caption: homeTranslations.moneyMarketTab ?? "Money Market",
      icon: HomeIcon,
    },
  ];

  return (
    <div className="container mx-auto px-4">
      <div
        className="flex justify-between items-center py-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <Link
          href="/"
          aria-label="BU.FI home"
          className="relative inline-flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purpleDanis/60"
        >
          <Image
            src="/images/iso-logo.png"
            alt=""
            width={574}
            height={569}
            priority
            style={{ height: "auto", width: "44px" }}
          />
        </Link>

        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-label={isOpen ? "Close menu" : "Open menu"}
          className={cn(
            // 48px tap target with the visual stroke staying compact at 22px.
            "relative h-12 w-12 rounded-full grid place-items-center",
            "text-foreground/80 hover:text-foreground",
            "ring-1 ring-foreground/10 bg-background/60 backdrop-blur-xl",
            "transition-colors duration-200",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purpleDanis/60",
            "active:scale-[0.97] motion-safe:transition-transform",
          )}
        >
          <span aria-hidden className="relative block h-3 w-5">
            <span
              className={cn(
                "absolute left-0 top-0 h-[1.5px] w-5 origin-center rounded-full bg-current",
                "transition-[transform,opacity] duration-300",
                isOpen
                  ? "translate-y-[5px] rotate-45"
                  : "translate-y-0 rotate-0",
              )}
              style={{ transitionTimingFunction: "cubic-bezier(0.32,0.72,0,1)" }}
            />
            <span
              className={cn(
                "absolute left-0 top-[10px] h-[1.5px] w-5 origin-center rounded-full bg-current",
                "transition-[transform,opacity] duration-300",
                isOpen
                  ? "-translate-y-[5px] -rotate-45"
                  : "translate-y-0 rotate-0",
              )}
              style={{ transitionTimingFunction: "cubic-bezier(0.32,0.72,0,1)" }}
            />
          </span>
        </button>
      </div>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Scrim — soft, blurred, not an opaque black slab. */}
            <motion.button
              type="button"
              aria-label="Close menu"
              tabIndex={-1}
              onClick={close}
              variants={overlayVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className={cn(
                "fixed inset-0 z-40 cursor-default",
                "bg-[radial-gradient(120%_80%_at_50%_-10%,rgba(105,84,207,0.18),transparent_60%)]",
                "backdrop-blur-xl backdrop-saturate-150",
                // Tint the scrim toward brand purple instead of pure black.
                "bg-[#f5f3ff]/60 dark:bg-[#0a0816]/70",
              )}
            />

            <motion.div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-modal="true"
              aria-label="Main menu"
              variants={reduceMotion ? overlayVariants : panelVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className={cn(
                "fixed inset-x-0 top-0 z-50 max-h-[100dvh] overflow-y-auto",
                "px-5 pt-[max(1rem,env(safe-area-inset-top))]",
                "pb-[max(2rem,env(safe-area-inset-bottom))]",
              )}
            >
              <div
                className={cn(
                  "mx-auto w-full max-w-md",
                  "rounded-[28px] border overflow-hidden",
                  "border-purpleDanis/10 dark:border-white/10",
                  "bg-background/95 dark:bg-[#0e0b1f]/95",
                  "shadow-[0_30px_80px_-30px_rgba(105,84,207,0.45)]",
                  "backdrop-blur-2xl",
                )}
              >
                {/* Promotional banner — auto-hides after 20s, has its own
                    Close. Sits flush above the panel header. */}
                <ActionBanner />

                {/* Top row inside the panel — logo left, close right. The
                    trigger lives outside the panel so its rotation reads as
                    morph rather than vanish. */}
                <div
                  className="flex items-center justify-between px-6"
                  style={{ paddingTop: "1.25rem", paddingBottom: "0.5rem" }}
                >
                  <Link
                    href="/"
                    onClick={close}
                    className="inline-flex items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purpleDanis/60"
                  >
                    <Image
                      src="/images/iso-logo.png"
                      alt=""
                      width={574}
                      height={569}
                      style={{ height: "auto", width: "36px" }}
                    />
                    <span className="font-knicknack text-base tracking-tight text-foreground">
                      BU.FI
                    </span>
                  </Link>
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/40"
                    aria-hidden
                  >
                    Menu
                  </span>
                </div>

                <motion.nav
                  aria-label="Primary"
                  className="px-3 pt-2 pb-3"
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <ul className="flex flex-col">
                    {navItems.map((item, index) => {
                      const Icon = item.icon;
                      const isActive =
                        item.href === "/"
                          ? pathname === "/"
                          : pathname?.startsWith(item.href);
                      return (
                        <motion.li
                          key={item.href}
                          custom={index}
                          variants={reduceMotion ? overlayVariants : childVariants}
                        >
                          <Link
                            ref={index === 0 ? firstLinkRef : undefined}
                            href={item.href}
                            onClick={close}
                            aria-current={isActive ? "page" : undefined}
                            className={cn(
                              "group relative grid grid-cols-[auto_1fr_auto] items-center gap-4",
                              "min-h-[64px] px-4 py-3 rounded-2xl",
                              "transition-[background-color,color] duration-200",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purpleDanis/60",
                              isActive
                                ? "bg-purpleDanis/8 dark:bg-white/[0.04]"
                                : "hover:bg-foreground/[0.03] dark:hover:bg-white/[0.03]",
                            )}
                          >
                            <span
                              aria-hidden
                              className={cn(
                                "font-mono text-[10px] tabular-nums tracking-[0.16em]",
                                isActive
                                  ? "text-purpleDanis"
                                  : "text-foreground/35",
                              )}
                            >
                              {String(index + 1).padStart(2, "0")}
                            </span>

                            <span className="min-w-0">
                              <span
                                className={cn(
                                  "block font-knicknack text-[22px] leading-tight tracking-tight",
                                  isActive
                                    ? "text-purpleDanis"
                                    : "text-foreground",
                                )}
                              >
                                {item.label}
                              </span>
                              <span className="mt-0.5 block truncate text-[12px] text-foreground/55">
                                {item.caption}
                              </span>
                            </span>

                            <span
                              aria-hidden
                              className={cn(
                                "grid place-items-center h-9 w-9 rounded-full",
                                "ring-1 ring-foreground/10",
                                "text-foreground/60",
                                "transition-transform duration-300",
                                "motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5",
                              )}
                            >
                              {isActive ? (
                                <Icon className="h-4 w-4" />
                              ) : (
                                <ArrowUpRight className="h-4 w-4" />
                              )}
                            </span>
                          </Link>
                        </motion.li>
                      );
                    })}
                  </ul>
                </motion.nav>

                <motion.section
                  aria-label="Account"
                  custom={navItems.length}
                  variants={reduceMotion ? overlayVariants : childVariants}
                  className="px-6 pt-5"
                >
                  <div className="flex items-center justify-between pb-2">
                    <span
                      className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/40"
                      aria-hidden
                    >
                      Account
                    </span>
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="[&>div]:w-full [&_button]:w-full">
                      <ConnectKitButton />
                    </div>
                  </div>
                </motion.section>

                <motion.section
                  aria-label="Preferences"
                  custom={navItems.length + 1}
                  variants={reduceMotion ? overlayVariants : childVariants}
                  className="px-6 pt-5 pb-6"
                >
                  <div className="flex items-center justify-between pb-2">
                    <span
                      className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/40"
                      aria-hidden
                    >
                      Settings
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <ModeToggle />
                    <LocalSwitcher />
                  </div>
                </motion.section>

                <motion.footer
                  custom={navItems.length + 2}
                  variants={reduceMotion ? overlayVariants : childVariants}
                  className="border-t border-foreground/5 px-6 py-4"
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/35">
                    BU.FI · DeFi for everyone
                  </p>
                </motion.footer>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MobileMenu;
