"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAccount, useChainId, useSignMessage, useSignTypedData } from "wagmi";
import type { Hex } from "viem";

import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";
import {
  getPerpsReplacementDevWallet,
  publishPerpsReplacementE2eState,
} from "@/lib/perps/dev-mock-wallet";
import {
  buildWalletSessionMessage,
  fetchReplacementNeededEvents,
  freshReplacementNonce,
  markReplacementEventHandled,
  normalizeReplacementTypedData,
  prepareReplacementOrder,
  readCachedWalletSession,
  readHandledReplacementEvents,
  readReplacementCursor,
  replacementDeadline,
  submitReplacementOrder,
  walletSessionHeaders,
  writeCachedWalletSession,
  writeReplacementCursor,
  type PerpsReplacementNeededEvent,
  type WalletSessionProof,
} from "@/lib/perps/replacement-agent";

const POLL_MS = 8_000;

export function PerpsReplacementAgent() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();
  const { toast } = useToast();
  const devWallet = useMemo(() => getPerpsReplacementDevWallet(), []);
  const effectiveAddress = devWallet?.address ?? address;
  const effectiveChainId = devWallet?.chainId ?? chainId;
  const isAgentConnected = Boolean(devWallet) || isConnected;
  const inFlightRef = useRef(false);
  const activeEventsRef = useRef(new Set<string>());

  const getSessionProof = useCallback(async (): Promise<WalletSessionProof | null> => {
    if (!effectiveAddress || !effectiveChainId) return null;
    const cached = readCachedWalletSession(effectiveAddress, effectiveChainId);
    if (cached) return cached;
    const session = buildWalletSessionMessage({
      address: effectiveAddress,
      chainId: effectiveChainId,
    });
    const signature = devWallet
      ? await devWallet.signMessage(session.message)
      : await signMessageAsync({ message: session.message });
    const proof = {
      address: effectiveAddress,
      chainId: effectiveChainId,
      message: session.message,
      signature: signature as Hex,
      iat: session.iat,
      exp: session.exp,
    };
    writeCachedWalletSession(proof);
    return proof;
  }, [devWallet, effectiveAddress, effectiveChainId, signMessageAsync]);

  useEffect(() => {
    if (!devWallet) return;
    publishPerpsReplacementE2eState({
      enabled: true,
      address: devWallet.address,
      chainId: devWallet.chainId,
    });
  }, [devWallet]);

  const handleEvent = useCallback(
    async (event: PerpsReplacementNeededEvent, signal: AbortSignal) => {
      if (!effectiveAddress || activeEventsRef.current.has(event.eventId)) return;
      activeEventsRef.current.add(event.eventId);

      let proof: WalletSessionProof | null;
      try {
        proof = await getSessionProof();
      } catch (error) {
        activeEventsRef.current.delete(event.eventId);
        publishPerpsReplacementE2eState({
          enabled: true,
          lastError: (error as Error).message,
        });
        toast({
          variant: "destructive",
          title: "Wallet session needed",
          description: (error as Error).message,
        });
        return;
      }
      if (!proof) {
        activeEventsRef.current.delete(event.eventId);
        return;
      }
      const headers = walletSessionHeaders(proof);
      const nonce = freshReplacementNonce();
      const deadline = replacementDeadline();

      let prepared;
      try {
        prepared = await prepareReplacementOrder({
          event,
          headers,
          nonce,
          deadline,
          signal,
        });
      } catch (error) {
        activeEventsRef.current.delete(event.eventId);
        if (String((error as Error).message).includes("409")) {
          markReplacementEventHandled(effectiveAddress, event.eventId);
          return;
        }
        publishPerpsReplacementE2eState({
          enabled: true,
          lastError: (error as Error).message,
        });
        toast({
          variant: "destructive",
          title: "Residual order needs attention",
          description: (error as Error).message,
        });
        return;
      }

      publishPerpsReplacementE2eState({
        enabled: true,
        lastToast: {
          eventId: event.eventId,
          intentId: event.payload.intentId,
          replacementOf: prepared.replacementOf,
          remainingSizeDelta: prepared.remainingSizeDelta,
        },
      });
      const prompt = toast({
        title: "Residual perp order ready",
        description: `${shortId(prepared.replacementOf)} has ${prepared.remainingSizeDelta} left. Sign a fresh nonce to re-enter it.`,
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
                const signature = devWallet
                  ? await devWallet.signTypedData(prepared.typedData)
                  : await signTypedDataAsync(
                      normalizeReplacementTypedData(
                        prepared,
                      ) as Parameters<typeof signTypedDataAsync>[0],
                    );
                const freshProof = await getSessionProof();
                if (!freshProof) throw new Error("wallet session unavailable");
                await submitReplacementOrder({
                  event,
                  headers: walletSessionHeaders(freshProof),
                  nonce,
                  deadline,
                  signature: signature as Hex,
                });
                markReplacementEventHandled(effectiveAddress, event.eventId);
                activeEventsRef.current.delete(event.eventId);
                publishPerpsReplacementE2eState({
                  enabled: true,
                  lastSubmitted: {
                    eventId: event.eventId,
                    intentId: event.payload.intentId,
                    replacementOf: prepared.replacementOf,
                    remainingSizeDelta: prepared.remainingSizeDelta,
                  },
                });
                prompt.update({
                  id: prompt.id,
                  open: true,
                  title: "Replacement submitted",
                  description: "The residual order is back in the matcher book.",
                });
              } catch (error) {
                activeEventsRef.current.delete(event.eventId);
                publishPerpsReplacementE2eState({
                  enabled: true,
                  lastError: (error as Error).message,
                });
                prompt.update({
                  id: prompt.id,
                  open: true,
                  variant: "destructive",
                  title: "Replacement not submitted",
                  description: (error as Error).message,
                });
              }
            }}
          >
            Sign
          </ToastAction>
        ),
      });
    },
    [
      devWallet,
      effectiveAddress,
      getSessionProof,
      signTypedDataAsync,
      toast,
    ],
  );

  useEffect(() => {
    if (!isAgentConnected || !effectiveAddress) return;
    const controller = new AbortController();

    const poll = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const proof = await getSessionProof();
        if (!proof) return;
        const cursor = readReplacementCursor(effectiveAddress);
        const events = await fetchReplacementNeededEvents({
          headers: walletSessionHeaders(proof),
          after: cursor === undefined ? undefined : Math.max(0, cursor - 1),
          limit: 25,
          signal: controller.signal,
        });
        if (events.length > 0) {
          writeReplacementCursor(
            effectiveAddress,
            Math.max(...events.map((event) => event.createdAt)),
          );
        }
        const handled = readHandledReplacementEvents(effectiveAddress);
        const next = events.find(
          (event) =>
            !handled.has(event.eventId) &&
            !activeEventsRef.current.has(event.eventId),
        );
        if (next) await handleEvent(next, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("perps replacement agent poll failed", error);
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [effectiveAddress, getSessionProof, handleEvent, isAgentConnected]);

  return null;
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}
