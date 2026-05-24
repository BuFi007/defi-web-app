"use client";

/**
 * 4-step progress indicator for the CCTP onramp sheet.
 *
 * Visualises the FSM state as a horizontal stepper:
 *
 *     (1) Approve ──── (2) Burn ──── (3) Attest ──── (4) Mint
 *
 * Each step renders one of:
 *   - idle     →  empty circle with the step number
 *   - running  →  spinner with a subtle pulse
 *   - success  →  filled check
 *   - skipped  →  filled with a forward-arrow (only used by approve)
 *   - error    →  red X
 *
 * Connectors between steps go solid green once the upstream step
 * succeeds, mirroring the visual language of a multi-step Stripe /
 * Linear progress bar.
 */

import { AnimatePresence, motion } from "framer-motion";
import { CheckIcon, Cross1Icon, ArrowRightIcon } from "@radix-ui/react-icons";

import { cn } from "@/utils";

import {
  STEP_LABELS,
  STEP_ORDER,
  type OnrampState,
  type Phase,
  type StepKey,
} from "@/lib/cctp/onramp-state-machine";

function phaseFor(state: OnrampState, step: StepKey): Phase {
  return state[step].phase;
}

function StepDot({
  phase,
  index,
}: {
  phase: Phase;
  index: number;
}) {
  return (
    <div
      className={cn(
        "relative flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors",
        phase === "idle" && "border-muted-foreground/40 text-muted-foreground",
        phase === "running" &&
          "border-primary bg-primary/10 text-primary shadow-[0_0_0_4px_rgba(120,_119,_198,_0.12)]",
        phase === "success" &&
          "border-green-500 bg-green-500 text-white",
        phase === "skipped" &&
          "border-green-500 bg-green-500/80 text-white",
        phase === "error" && "border-red-500 bg-red-500 text-white",
      )}
      aria-label={`Step ${index} — ${phase}`}
    >
      <AnimatePresence mode="wait">
        {phase === "running" && (
          <motion.span
            key="spin"
            className="h-4 w-4 rounded-full border-2 border-current border-r-transparent"
            initial={{ opacity: 0, rotate: 0 }}
            animate={{ opacity: 1, rotate: 360 }}
            exit={{ opacity: 0 }}
            transition={{
              rotate: { repeat: Infinity, duration: 0.9, ease: "linear" },
            }}
          />
        )}
        {phase === "success" && (
          <motion.span
            key="ok"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
          >
            <CheckIcon className="h-4 w-4" />
          </motion.span>
        )}
        {phase === "skipped" && (
          <motion.span
            key="skip"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
            title="Allowance already covered this — approve skipped"
          >
            <ArrowRightIcon className="h-4 w-4" />
          </motion.span>
        )}
        {phase === "error" && (
          <motion.span
            key="err"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
          >
            <Cross1Icon className="h-4 w-4" />
          </motion.span>
        )}
        {phase === "idle" && (
          <motion.span
            key="idle"
            className="text-xs font-bold"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {index}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function Connector({ done }: { done: boolean }) {
  return (
    <div className="relative h-[2px] flex-1 overflow-hidden bg-muted-foreground/20">
      <motion.div
        className="absolute inset-y-0 left-0 bg-green-500"
        initial={false}
        animate={{ width: done ? "100%" : "0%" }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

export function OnrampStepIndicator({ state }: { state: OnrampState }) {
  return (
    <div className="flex w-full items-center" aria-label="CCTP deposit progress">
      {STEP_ORDER.map((step, i) => {
        const phase = phaseFor(state, step);
        const isLast = i === STEP_ORDER.length - 1;
        const nextPhase = isLast ? null : phaseFor(state, STEP_ORDER[i + 1]!);
        // Connector lights up when the current step is success/skipped
        // (and a downstream step has started or finished).
        const connectorDone =
          (phase === "success" || phase === "skipped") &&
          !!nextPhase &&
          nextPhase !== "idle";

        return (
          <div key={step} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <StepDot phase={phase} index={i + 1} />
              <div
                className={cn(
                  "text-[10.5px] font-bold uppercase tracking-wide",
                  phase === "idle" && "text-muted-foreground",
                  phase === "running" && "text-primary",
                  (phase === "success" || phase === "skipped") &&
                    "text-foreground",
                  phase === "error" && "text-red-500",
                )}
              >
                {STEP_LABELS[step]}
              </div>
            </div>
            {!isLast && (
              <div className="mx-3 -mt-5 flex-1">
                <Connector done={connectorDone} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
