"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAccount, useChainId, useSignTypedData } from "wagmi";
import type { Hex } from "viem";
import { UserRejectedRequestError } from "viem";

import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";
import {
  getPerpsReplacementDevWallet,
  publishPerpsReplacementE2eState,
} from "@/lib/perps/dev-mock-wallet";
import {
  buildWalletSessionTypedData,
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
const REJECT_KEY = "perps-replacement-session-rejected";

function isUserRejection(error: unknown): boolean {
  if (error instanceof UserRejectedRequestError) return true;
  const anyErr = error as { code?: number; name?: string; message?: string } | null;
  if (!anyErr) return false;
  if (anyErr.code === 4001) return true; // EIP-1193 user-rejected
  if (anyErr.name === "UserRejectedRequestError") return true;
  return typeof anyErr.message === "string" && /user rejected/i.test(anyErr.message);
}

/**
 * MetaMask returns EIP-1193 code 4100 ("The requested account and/or method
 * has not been authorized by the user.") when we ask for a signature before
 * `eth_requestAccounts` has been granted. This races during the Dynamic ↔
 * MetaMask handshake: wagmi flips `isConnected` true on connector init, but
 * the Connect popup is still open — any `eth_signTypedData_v4` we fire in
 * that window gets rejected as unauthorized AND triggers a second Sign
 * popup overlay on top of the still-open Connect popup. Detect it so we can
 * back off instead of flooding the console.
 */
function isNotAuthorizedError(error: unknown): boolean {
  const anyErr = error as { code?: number; message?: string } | null;
  if (!anyErr) return false;
  if (anyErr.code === 4100) return true;
  return (
    typeof anyErr.message === "string" &&
    /has not been authorized by the user/i.test(anyErr.message)
  );
}

function readSessionRejected(address?: string): boolean {
  if (typeof window === "undefined" || !address) return false;
  return window.sessionStorage.getItem(`${REJECT_KEY}:${address.toLowerCase()}`) === "1";
}

function writeSessionRejected(address?: string) {
  if (typeof window === "undefined" || !address) return;
  window.sessionStorage.setItem(`${REJECT_KEY}:${address.toLowerCase()}`, "1");
}

export function PerpsReplacementAgent() {
  // CRITICAL: we use `status === "connected"` here, NOT just `isConnected`.
  // During the Dynamic ↔ MetaMask handshake wagmi briefly reports
  // `isConnected: true` while `status` is still `"connecting"` /
  // `"reconnecting"` — the connector exists but `eth_requestAccounts`
  // hasn't been granted yet. If we fire a `signTypedData` in that window
  // MetaMask rejects with code 4100 ("not been authorized by the user")
  // and opens a Sign popup on top of the still-open Connect popup,
  // producing the double-popup the user is seeing.
  const { address, status } = useAccount();
  const chainId = useChainId();
  const { signTypedDataAsync } = useSignTypedData();
  const { toast } = useToast();
  const devWallet = useMemo(() => getPerpsReplacementDevWallet(), []);
  const effectiveAddress = devWallet?.address ?? address;
  const effectiveChainId = devWallet?.chainId ?? chainId;
  const isAgentConnected = Boolean(devWallet) || status === "connected";
  const inFlightRef = useRef(false);
  const activeEventsRef = useRef(new Set<string>());
  // Sticky: once the user declines the session signature, pause the agent for
  // the rest of the session. Refreshing clears it (sessionStorage scope).
  const rejectedRef = useRef(readSessionRejected(effectiveAddress));

  const getSessionProof = useCallback(async (): Promise<WalletSessionProof | null> => {
    if (!effectiveAddress || !effectiveChainId) return null;
    if (rejectedRef.current) return null;
    const cached = readCachedWalletSession(effectiveAddress, effectiveChainId);
    if (cached) return cached;
    // Give MetaMask a beat to fully process `eth_requestAccounts` before we
    // ask for a signature. Without this delay, opening a fresh tab + clicking
    // Log In → Avalanche races a `signTypedData_v4` ahead of the Connect
    // approval, which MetaMask rejects with code 4100 and spawns a second
    // popup on top of the still-open Connect dialog.
    if (!devWallet) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const session = buildWalletSessionTypedData({
      address: effectiveAddress as `0x${string}`,
      chainId: effectiveChainId,
    });
    let signature: Hex;
    try {
      signature = (devWallet
        ? await devWallet.signSessionTypedData(session.typedData)
        : await signTypedDataAsync({
            domain: session.typedData.domain,
            types: session.typedData.types,
            primaryType: session.typedData.primaryType,
            message: session.typedData.message,
          })) as Hex;
    } catch (error) {
      if (isUserRejection(error)) {
        rejectedRef.current = true;
        writeSessionRejected(effectiveAddress);
      }
      throw error;
    }
    const proof: WalletSessionProof = {
      address: effectiveAddress,
      chainId: effectiveChainId,
      message: session.message,
      signature,
      iat: session.iat,
      exp: session.exp,
      typedData: session.typedData,
    };
    writeCachedWalletSession(proof);
    return proof;
  }, [devWallet, effectiveAddress, effectiveChainId, signTypedDataAsync]);

  useEffect(() => {
    if (!devWallet) return;
    publishPerpsReplacementE2eState({
      enabled: true,
      address: devWallet.address,
      chainId: devWallet.chainId,
    });
  }, [devWallet]);

  // When the connected chain changes, evict any wallet-session entries cached
  // under OTHER chain ids for this address. A user switching MetaMask from
  // Avalanche mainnet → Fuji mid-login otherwise leaves a signed-but-useless
  // mainnet session sitting in localStorage indefinitely. Keeping localStorage
  // clean here also means a future bug that pins the wrong chainId can't
  // silently reuse a stale proof — we'll always sign fresh on the new chain.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!effectiveAddress || !effectiveChainId) return;
    const keepKey = `bufx.wallet-session:${effectiveChainId}:${effectiveAddress.toLowerCase()}`;
    const prefix = `bufx.wallet-session:`;
    const suffix = `:${effectiveAddress.toLowerCase()}`;
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (key === keepKey) continue;
      if (key.startsWith(prefix) && key.endsWith(suffix)) toRemove.push(key);
    }
    for (const key of toRemove) window.localStorage.removeItem(key);
  }, [effectiveAddress, effectiveChainId]);

  const handleEvent = useCallback(
    async (event: PerpsReplacementNeededEvent, signal: AbortSignal) => {
      if (!effectiveAddress || activeEventsRef.current.has(event.eventId)) return;
      activeEventsRef.current.add(event.eventId);

      let proof: WalletSessionProof | null;
      try {
        proof = await getSessionProof();
      } catch (error) {
        activeEventsRef.current.delete(event.eventId);
        if (isUserRejection(error)) return; // sticky-rejected; stay quiet
        if (isNotAuthorizedError(error)) {
          // Wallet still mid-handshake — back off silently. Next poll tick
          // will retry once `status === "connected"` settles.
          return;
        }
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
                if (isUserRejection(error)) {
                  // User declined: dismiss the toast without reopening.
                  // Don't mark sticky-rejected here — they may want to retry
                  // a future replacement; only the session-proof rejection
                  // is sticky.
                  prompt.dismiss();
                  return;
                }
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
    // Re-check sticky rejection whenever the address changes; user may have
    // switched wallets to a non-rejected one.
    rejectedRef.current = readSessionRejected(effectiveAddress);
    if (rejectedRef.current) return;

    const controller = new AbortController();

    const poll = async () => {
      if (rejectedRef.current || inFlightRef.current) return;
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
        if (controller.signal.aborted) return;
        if (isUserRejection(error)) {
          // Already marked rejected inside getSessionProof; just stop polling.
          // Don't toast — the wallet UI already showed the prompt the user
          // declined, additional noise is what they're complaining about.
          return;
        }
        if (isNotAuthorizedError(error)) {
          // The wallet is still mid-handshake (Connect popup open) or the
          // user revoked site access. Stay silent — the next poll tick will
          // retry once `status` has actually settled to "connected". The
          // outer `useEffect` won't fire `void poll()` again until then
          // because we gate on `status === "connected"` above.
          return;
        }
        console.warn("perps replacement agent poll failed", error);
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
