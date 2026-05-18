"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Hex } from "viem";
import { UserRejectedRequestError } from "viem";
import { useSignTypedData } from "wagmi";

import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";
import { useDevWallet } from "@/lib/dev-wallet";
import {
  useBufiAddress,
  useBufiIsConnected,
  useEnsureSession,
} from "@/lib/session";
import {
  bufxApiUrl,
  fetchReplacementNeededEvents,
  freshReplacementNonce,
  markReplacementEventHandled,
  normalizeReplacementTypedData,
  prepareReplacementOrder,
  readHandledReplacementEvents,
  replacementDeadline,
  submitReplacementOrder,
} from "@/lib/perps/replacement-agent";

/**
 * Residual-order recovery agent.
 *
 * Before this rewrite:
 *   - 429 LOC, 4 useEffects, a setInterval(8000), useRef-tracked
 *     in-flight flag, and signTypedData fired on the FIRST tick before
 *     even checking whether there were events to handle. Fresh MetaMask
 *     connects → 4100 spam every 8s forever.
 *
 * After:
 *   - 1 React Query for the public count endpoint (no auth, 30s poll).
 *   - When count === 0 we render nothing and never sign.
 *   - Only when count > 0 do we render a CTA button. Clicking the button
 *     calls ensureHeaders (signs once if needed), fetches the event list,
 *     and prompts the user with a Sign toast for the actual order.
 *
 * Off by default. Set NEXT_PUBLIC_PERPS_REPLACEMENT_AGENT=1 in prod.
 * The NEXT_PUBLIC_PERPS_REPLACEMENT_E2E shim path keeps working via the
 * unified DevWalletProvider.
 */
const AGENT_ENABLED =
  process.env.NEXT_PUBLIC_PERPS_REPLACEMENT_AGENT === "1" ||
  process.env.NEXT_PUBLIC_PERPS_REPLACEMENT_E2E === "1";

const COUNT_POLL_MS = 30_000;

export function PerpsReplacementAgent() {
  const isConnected = useBufiIsConnected();
  const address = useBufiAddress();

  // Public, no-auth count poll. Cheap, doesn't ask for a signature.
  const { data: count = 0 } = useQuery({
    queryKey: ["perps", "replacement-count", address?.toLowerCase()] as const,
    queryFn: async () => {
      if (!address) return 0;
      const url = bufxApiUrl("/perps/replacement-needed/count", { address });
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) return 0;
      const body = (await res.json()) as { count?: number };
      return Number(body.count ?? 0);
    },
    enabled: AGENT_ENABLED && isConnected && !!address,
    refetchInterval: COUNT_POLL_MS,
    staleTime: COUNT_POLL_MS / 2,
  });

  if (!AGENT_ENABLED || !isConnected || !address || count === 0) return null;
  return <ReplacementToastLauncher count={count} />;
}

function ReplacementToastLauncher({ count }: { count: number }) {
  const { toast } = useToast();
  const { ensureHeaders } = useEnsureSession();
  const devWallet = useDevWallet();
  const { signTypedDataAsync } = useSignTypedData();
  const [busy, setBusy] = useState(false);

  const handleShow = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const headers = await ensureHeaders("perps.replacement");
      const events = await fetchReplacementNeededEvents({ headers, limit: 25 });
      const handled = readHandledReplacementEvents(headers["X-Wallet-Address"]!);
      const next = events.find((e) => !handled.has(e.eventId));
      if (!next) {
        toast({
          title: "Nothing to replace",
          description: "All residual orders are already handled.",
        });
        return;
      }
      const nonce = freshReplacementNonce();
      const deadline = replacementDeadline();
      const prepared = await prepareReplacementOrder({
        event: next,
        headers,
        nonce,
        deadline,
      });
      const prompt = toast({
        title: "Residual perp order ready",
        description: `${shortId(prepared.replacementOf)} has ${prepared.remainingSizeDelta} left. Sign to re-enter it.`,
        action: (
          <ToastAction
            data-testid="perps-replacement-sign"
            altText="Sign replacement order"
            onClick={async () => {
              try {
                prompt.update({
                  id: prompt.id,
                  open: true,
                  title: "Confirm in wallet",
                  description: "Sign the residual order replacement.",
                });
                const typed = normalizeReplacementTypedData(prepared);
                const signature: Hex = devWallet
                  ? ((await devWallet.signTypedData(
                      typed as Parameters<typeof devWallet.signTypedData>[0],
                    )) as Hex)
                  : ((await signTypedDataAsync(
                      typed as Parameters<typeof signTypedDataAsync>[0],
                    )) as Hex);
                await submitReplacementOrder({
                  event: next,
                  headers,
                  nonce,
                  deadline,
                  signature,
                });
                markReplacementEventHandled(
                  headers["X-Wallet-Address"]!,
                  next.eventId,
                );
                prompt.update({
                  id: prompt.id,
                  open: true,
                  title: "Replacement submitted",
                  description: "Back in the matcher book.",
                });
              } catch (err) {
                if (err instanceof UserRejectedRequestError) {
                  prompt.dismiss();
                  return;
                }
                prompt.update({
                  id: prompt.id,
                  open: true,
                  variant: "destructive",
                  title: "Replacement not submitted",
                  description: (err as Error).message,
                });
              }
            }}
          >
            Sign
          </ToastAction>
        ),
      });
    } catch (err) {
      if (err instanceof UserRejectedRequestError) return;
      toast({
        variant: "destructive",
        title: "Wallet session needed",
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  }, [busy, devWallet, ensureHeaders, signTypedDataAsync, toast]);

  return (
    <button
      type="button"
      data-testid="perps-replacement-show"
      onClick={handleShow}
      disabled={busy}
      className="fixed bottom-4 right-4 z-50 px-3 py-2 rounded-lg shadow-md text-sm font-medium bg-[var(--primary,#6954CF)] text-white disabled:opacity-50"
    >
      {busy ? "Loading…" : `${count} residual order${count === 1 ? "" : "s"} — review`}
    </button>
  );
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}
