"use client";

/**
 * CctpOnrampSheet — bottom sheet UX for the Fuji → Arc CCTP V2 onramp.
 *
 * Flow (matches the FSM in `lib/cctp/onramp-state-machine.ts`):
 *
 *   ┌─────────────────────────────────────────┐
 *   │ Bridge USDC to Arc                      │
 *   │ ─────────────────────────────           │
 *   │ Source: Avalanche Fuji  Dest: Arc      │
 *   │ Recipient: 0xa00b…7AB9  (your wallet)  │
 *   │                                         │
 *   │ Amount  [   10   ] USDC                 │
 *   │                                         │
 *   │ (1) Approve ─── (2) Burn ─── (3) Attest │
 *   │     ─── (4) Mint                       │
 *   │                                         │
 *   │ [Bridge USDC →]                         │
 *   └─────────────────────────────────────────┘
 *
 * The sheet is uncontrolled in `amount` and `open` (caller owns the
 * trigger boolean); everything else — the FSM, the abort handle, the
 * cross-chain wallet switching — lives in `useCctpOnramp`.
 */

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { formatUnits } from "viem";

import { truncateAddress } from "@/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/components/ui/use-toast";

import {
  arcscanTxUrl,
  snowtraceTxUrl,
} from "@/lib/cctp/contracts";
import { useCctpOnramp } from "@/lib/cctp/use-cctp-onramp";

import { OnrampStepIndicator } from "./onramp-step-indicator";

export interface CctpOnrampSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional explicit recipient override. Defaults to the connected
   * wallet (most common case — trader bridges to themselves).
   */
  recipient?: `0x${string}`;
}

function fmtElapsed(ms?: number): string {
  if (ms == null) return "0s";
  return `${Math.round(ms / 1000)}s`;
}

function formatUsdcBalance(raw: bigint | undefined): string {
  if (raw == null) return "—";
  return Number(formatUnits(raw, 6)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

export function CctpOnrampSheet({
  open,
  onOpenChange,
  recipient,
}: CctpOnrampSheetProps) {
  const { address } = useAccount();
  const [amount, setAmount] = useState("10");
  const { toast } = useToast();

  const { state, start, cancel, reset, busy } = useCctpOnramp({
    recipient,
  });

  // Reset FSM whenever the sheet RE-opens — we want a clean slate
  // every time, not a stale "success" view from a prior bridge.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  // Fire success toast on completion + auto-dismiss the sheet.
  useEffect(() => {
    if (state.done === "ok" && state.successMessage) {
      toast({
        title: "Deposit complete",
        description: state.successMessage,
      });
      // Brief delay so the user sees the "all-green" stepper before
      // the sheet slides away.
      const t = setTimeout(() => onOpenChange(false), 1400);
      return () => clearTimeout(t);
    }
  }, [state.done, state.successMessage, toast, onOpenChange]);

  const handleClose = useCallback(
    (next: boolean) => {
      if (!next) {
        // Closing — abort any in-flight poll/work, then notify parent.
        cancel();
      }
      onOpenChange(next);
    },
    [cancel, onOpenChange],
  );

  const handleBridge = useCallback(() => {
    if (!address) return;
    void start(amount);
  }, [address, amount, start]);

  const ctaLabel =
    busy
      ? state.step === "approve"
        ? "Approving…"
        : state.step === "burn"
          ? "Burning on Fuji…"
          : state.step === "attest"
            ? "Waiting for Circle attestation…"
            : "Minting on Arc…"
      : state.done === "ok"
        ? "Done"
        : state.done === "error"
          ? "Retry"
          : "Bridge USDC";

  const target = recipient ?? address ?? null;

  // Pull out the most-relevant inline error/info for the failing step.
  const errorBand = (() => {
    if (state.approve.phase === "error") {
      return {
        title: "Approval failed",
        body: state.approve.simError?.full ?? state.approve.error ?? "",
        cta: "Make sure your wallet is on Avalanche Fuji and you hold AVAX for gas.",
      };
    }
    if (state.burn.phase === "error") {
      return {
        title: "Burn failed",
        body: state.burn.simError?.full ?? state.burn.error ?? "",
        cta:
          state.burn.simError?.reason === "ERC20InsufficientBalance" ||
          /balance/i.test(state.burn.error ?? "")
            ? "Fund your Fuji wallet at https://faucet.circle.com (Avalanche Fuji)."
            : "Try again — Fuji RPC sometimes flakes mid-broadcast.",
      };
    }
    if (state.attest.phase === "error") {
      return {
        title: "Attestation didn't arrive",
        body: state.attest.error ?? "",
        cta: "Your burn is on-chain — Circle's signers usually catch up in <2 min. Retry the bridge to re-poll.",
      };
    }
    if (state.mint.phase === "error") {
      return {
        title: "Mint failed",
        body: state.mint.simError?.full ?? state.mint.error ?? "",
        cta:
          "Your USDC is burned but not minted. Keep the burn tx hash — Circle's signers can be replayed against Arc later.",
      };
    }
    return null;
  })();

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto rounded-t-2xl border-t-2 px-5 py-6 sm:max-w-2xl sm:mx-auto"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-lg font-extrabold tracking-tight">
            Bridge USDC to Arc
          </SheetTitle>
          <SheetDescription className="text-xs">
            One signature on Avalanche Fuji, one on Arc Testnet. Circle&apos;s
            CCTP V2 attests in the middle — typically under 60s on the
            fast path.
          </SheetDescription>
        </SheetHeader>

        {/* Source / destination summary */}
        <div className="mt-5 grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
              Source
            </div>
            <div className="mt-0.5 font-semibold">Avalanche Fuji</div>
            <div className="font-mono text-[11px] text-muted-foreground">
              Domain 1 · USDC
            </div>
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
              Destination
            </div>
            <div className="mt-0.5 font-semibold">Arc Testnet</div>
            <div className="font-mono text-[11px] text-muted-foreground">
              Domain 26 · USDC ERC-20
            </div>
          </div>
          <div className="col-span-2">
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
              Recipient
            </div>
            <div className="font-mono text-xs text-foreground">
              {target ? truncateAddress(target, 6) : "Connect a wallet first"}
            </div>
          </div>
        </div>

        {/* Amount input */}
        <label className="mt-5 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Amount
        </label>
        <div className="mt-1 flex items-center gap-2">
          <Input
            type="text"
            inputMode="decimal"
            disabled={busy || !!state.done}
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d.]/g, "");
              setAmount(v);
            }}
            placeholder="10"
            className="font-mono text-lg"
            aria-label="USDC amount to bridge"
          />
          <div className="text-sm font-bold text-muted-foreground">USDC</div>
        </div>

        {/* Stepper */}
        <div className="mt-6">
          <OnrampStepIndicator state={state} />
        </div>

        {/* Per-step detail rows — only render rows for steps that have meaningful info */}
        <div className="mt-5 space-y-2 text-xs">
          {state.approve.phase === "skipped" && (
            <div className="flex items-center justify-between rounded-md border bg-green-50 px-3 py-2 dark:bg-green-950/30">
              <span className="font-semibold">Approve</span>
              <span className="text-muted-foreground">
                Allowance already sufficient — skipped
              </span>
            </div>
          )}
          {state.approve.phase === "success" && state.approve.txHash && (
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="font-semibold">Approve</span>
              <a
                href={snowtraceTxUrl(state.approve.txHash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
              >
                {state.approve.txHash.slice(0, 10)}…
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
            </div>
          )}
          {state.burn.txHash && (
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="font-semibold">Burn on Fuji</span>
              <a
                href={snowtraceTxUrl(state.burn.txHash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
              >
                {state.burn.txHash.slice(0, 10)}…
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
            </div>
          )}
          {state.attest.phase === "running" && (
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Attestation</span>
                <span className="font-mono text-muted-foreground">
                  {fmtElapsed(state.attest.elapsedMs)} · attempt{" "}
                  {state.attest.attempts ?? 0}
                </span>
              </div>
              <div className="mt-1 text-[10.5px] text-muted-foreground">
                Iris status:{" "}
                <span className="font-mono">
                  {state.attest.irisStatus ?? "pending"}
                </span>
                {" · "}
                Circle&apos;s signers attest the burn before Arc will mint.
              </div>
            </div>
          )}
          {state.attest.phase === "success" && (
            <div className="flex items-center justify-between rounded-md border bg-green-50 px-3 py-2 dark:bg-green-950/30">
              <span className="font-semibold">Attestation</span>
              <span className="text-muted-foreground">Complete</span>
            </div>
          )}
          {state.mint.txHash && (
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="font-semibold">Mint on Arc</span>
              <a
                href={arcscanTxUrl(state.mint.txHash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
              >
                {state.mint.txHash.slice(0, 10)}…
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
            </div>
          )}
          {state.mint.phase === "success" && state.mint.newBalance != null && (
            <div className="flex items-center justify-between rounded-md border bg-green-50 px-3 py-2 dark:bg-green-950/30">
              <span className="font-semibold">Arc USDC balance</span>
              <span className="font-mono">
                {formatUsdcBalance(state.mint.newBalance)} USDC
              </span>
            </div>
          )}
        </div>

        {/* Error band — only when an explicit failure exists */}
        {errorBand && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-red-500/40 bg-red-50 p-3 text-xs text-red-900 dark:bg-red-950/40 dark:text-red-200"
          >
            <div className="font-bold">{errorBand.title}</div>
            {errorBand.body && (
              <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[10.5px] opacity-90">
                {errorBand.body}
              </div>
            )}
            <div className="mt-2 font-semibold">{errorBand.cta}</div>
          </div>
        )}

        {/* CTA */}
        <div className="mt-6 flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => handleClose(false)}
            disabled={false}
          >
            {state.done === "ok" ? "Close" : "Cancel"}
          </Button>
          <Button
            type="button"
            className="flex-[2]"
            onClick={handleBridge}
            disabled={
              !address ||
              busy ||
              state.done === "ok" ||
              !amount ||
              Number(amount) <= 0
            }
          >
            {ctaLabel}
          </Button>
        </div>

        <p className="mt-3 text-center text-[10.5px] text-muted-foreground">
          Two transactions on your wallet — one on Fuji, one on Arc. No
          intermediary holds your funds.
        </p>
      </SheetContent>
    </Sheet>
  );
}
