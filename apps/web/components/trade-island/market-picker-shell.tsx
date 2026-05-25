"use client";

/**
 * MarketPickerShell — reusable morph + portal for any market picker.
 *
 * The shell owns the box-geometry animation between a compact pill
 * and an expanded floating panel (Dynamic Island style, `layoutId`
 * shared between the trigger button and panel div). It also owns:
 *
 *   - portal mount + scrim (the panel escapes any `overflow: hidden`
 *     ancestor without breaking the morph)
 *   - anchor → panel coordinate sync on resize + scroll
 *   - Escape-key close + scrim-click close
 *   - SSR-safe portal (waits for `mounted` flag)
 *
 * Consumers supply the trigger content (rendered inside a
 * `motion.button` with the shared layoutId) and the panel content
 * (rendered inside a `motion.div` with the same layoutId). Each
 * instance gets a unique `layoutId` derived from `id` so multiple
 * pickers on the same page don't fight for the same morph slot.
 *
 * Used by:
 *   - `<MarketPicker>` (header perps picker — to be migrated)
 *   - `<LoanMarketPicker>` (loan/borrow right-panel picker)
 */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

const SPRING = {
  type: "spring" as const,
  stiffness: 260,
  damping: 36,
  mass: 0.7,
};

export interface MarketPickerShellProps {
  /**
   * Stable identifier used to namespace the framer-motion `layoutId`
   * so two shells on the same page can morph independently.
   */
  id: string;
  /** Accessible label for the trigger button + panel dialog. */
  ariaLabel: string;
  /**
   * Phantom inner content. Renders inside an invisible span that
   * reserves the trigger slot at full expanded width so the pill
   * collapsing doesn't shift adjacent layout. Usually the same JSX
   * as `trigger`.
   */
  phantom: React.ReactNode;
  /**
   * Closed-state pill content. Receives a `hover` flag so it can
   * collapse/expand its own affordances on idle. Renders inside the
   * `motion.button` the shell owns.
   */
  trigger: (state: { hover: boolean; open: boolean }) => React.ReactNode;
  /**
   * Open-state panel content. Renders inside a `motion.div` styled as
   * `mkt-island-panel` (white card, shadow, rounded corners).
   * Consumer provides everything inside — header, filters, list, etc.
   * Use the `close` callback for any custom close button.
   */
  panel: (state: { close: () => void }) => React.ReactNode;
  /**
   * Optional className extension on the anchor wrapper for layout
   * hooks (e.g. `lo-market-picker-anchor`). Falls back to the perps
   * `mkt-island-anchor` so existing CSS keeps working.
   */
  anchorClassName?: string;
  /**
   * Pill className. Defaults to the perps `market-mini mkt-island-pill`.
   * Pass a loan-specific class to restyle.
   */
  pillClassName?: string;
  /**
   * Panel className. Defaults to `mkt-island-panel`. Pass a custom
   * class for variants.
   */
  panelClassName?: string;
  /**
   * Where the floating panel docks relative to the anchor.
   * - "anchor-left" (default): top-left of panel ≈ top-left of anchor
   * - "anchor-right": top-right of panel ≈ top-right of anchor
   */
  panelAnchor?: "anchor-left" | "anchor-right";
}

export function MarketPickerShell({
  id,
  ariaLabel,
  phantom,
  trigger,
  panel,
  anchorClassName,
  pillClassName,
  panelClassName,
  panelAnchor = "anchor-left",
}: MarketPickerShellProps) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<
    { top: number; left?: number; right?: number } | null
  >(null);

  const anchorRef = useRef<HTMLDivElement>(null);
  const layoutId = `mp-shell-${id}`;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync panel position with the anchor's bounding box whenever the
  // panel is open. Listen to scroll AND resize so the morph stays
  // anchored if the user scrolls or resizes mid-animation.
  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const el = anchorRef.current;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (panelAnchor === "anchor-right") {
        setCoords({ top: r.top, right: Math.max(8, window.innerWidth - r.right) });
      } else {
        setCoords({ top: r.top, left: r.left });
      }
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, panelAnchor]);

  // Escape closes; listener only active while open so idle cost is 0.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const triggerState = { hover, open };
  const panelState = { close: () => setOpen(false) };

  return (
    <>
      <div ref={anchorRef} className={anchorClassName ?? "mkt-island-anchor"}>
        {/* Phantom holds the slot at full expanded width so adjacent
            items don't shift when the pill collapses on idle. */}
        <span
          className={`${pillClassName ?? "market-mini mkt-island-pill"} market-mini--phantom`}
          aria-hidden="true"
        >
          {phantom}
        </span>

        <AnimatePresence initial={false}>
          {!open && (
            <motion.button
              key="pill"
              type="button"
              layoutId={layoutId}
              className={pillClassName ?? "market-mini mkt-island-pill"}
              aria-label={ariaLabel}
              aria-expanded={false}
              onClick={() => setOpen(true)}
              onMouseEnter={() => setHover(true)}
              onMouseLeave={() => setHover(false)}
              onFocus={() => setHover(true)}
              onBlur={() => setHover(false)}
              transition={SPRING}
              style={{ borderRadius: 12 }}
            >
              {trigger(triggerState)}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {mounted &&
        createPortal(
          <AnimatePresence initial={false}>
            {open && (
              <React.Fragment key="open">
                <motion.button
                  key="scrim"
                  type="button"
                  className="acct-island-scrim"
                  aria-label={`Close ${ariaLabel}`}
                  onClick={() => setOpen(false)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                />
                <motion.div
                  key="panel"
                  layoutId={layoutId}
                  className={panelClassName ?? "mkt-island-panel"}
                  role="dialog"
                  aria-label={ariaLabel}
                  aria-modal="false"
                  transition={SPRING}
                  style={{
                    position: "fixed",
                    top: coords?.top ?? 0,
                    left: coords?.left,
                    right: coords?.right,
                    borderRadius: 18,
                  }}
                >
                  <motion.div
                    className="mkt-island-inner"
                    initial={{ opacity: 0, y: -3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{
                      duration: 0.26,
                      delay: 0.1,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    {panel(panelState)}
                  </motion.div>
                </motion.div>
              </React.Fragment>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
