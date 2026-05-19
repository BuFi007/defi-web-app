"use client";

import { useEffect } from "react";
import { toast } from "@/components/ui/use-toast";

// Detects the "Cannot set property ethereum of #<Window> which has only a
// getter" failure that MetaMask spams when another extension (Phantom,
// Brave Wallet, Rabby, Backpack, Coinbase Wallet, etc.) has frozen
// `window.ethereum` as a non-configurable getter. MetaMask's inpage.js
// gives up at that point; the user sees "MetaMask can't login".
//
// We can't fix the extension collision from page-land (it's between the
// two extensions' content scripts, before our JS even runs). What we
// CAN do is detect the hijack by probing the property descriptor and
// surface a clear workaround toast so the user knows it's not our app
// that's broken.
//
// EIP-6963 sidesteps this entirely (each wallet announces itself via
// events without touching `window.ethereum`), and Dynamic's wallet
// picker uses EIP-6963 first. So picking MetaMask from the modal
// should still work in most cases. The toast nudges the user toward
// the modal OR the MetaMask "Use as default" setting when the modal
// path doesn't surface MM either.
function detectHijack(): { hijacked: boolean; owner: string | null } {
  if (typeof window === "undefined") return { hijacked: false, owner: null };
  const desc = Object.getOwnPropertyDescriptor(window, "ethereum");
  if (!desc) return { hijacked: false, owner: null };
  // The MM error fires when the descriptor has a getter, no setter, and
  // is non-configurable. A plain assigned value (or a configurable
  // accessor) does NOT trigger MM's failure path.
  const hijacked =
    typeof desc.get === "function" && !desc.set && desc.configurable === false;
  if (!hijacked) return { hijacked: false, owner: null };
  // Best-effort owner sniff from the current `window.ethereum` value.
  // Most multi-wallet extensions advertise via boolean flags on the
  // provider object. Order matters — Brave masquerades as MM, so check
  // its tell first.
  const eth = (window as unknown as { ethereum?: Record<string, unknown> })
    .ethereum;
  if (!eth) return { hijacked: true, owner: null };
  if (eth.isBraveWallet) return { hijacked: true, owner: "Brave Wallet" };
  if (eth.isPhantom) return { hijacked: true, owner: "Phantom" };
  if (eth.isRabby) return { hijacked: true, owner: "Rabby" };
  if (eth.isCoinbaseWallet) return { hijacked: true, owner: "Coinbase Wallet" };
  if (eth.isBackpack) return { hijacked: true, owner: "Backpack" };
  if (eth.isTrust) return { hijacked: true, owner: "Trust Wallet" };
  return { hijacked: true, owner: null };
}

export function WalletConflictDetector() {
  useEffect(() => {
    // Wallet extensions inject AFTER document-ready. 1.5s is enough
    // headroom for the slowest extensions to land; longer than that and
    // the user has likely already clicked Connect and seen the error.
    const t = window.setTimeout(() => {
      const { hijacked, owner } = detectHijack();
      if (!hijacked) return;
      const ownerLabel = owner ?? "another wallet extension";
      toast({
        title: "MetaMask blocked by another wallet",
        description:
          `${ownerLabel} has locked window.ethereum, so MetaMask's injection failed. ` +
          `Fix: in MetaMask → menu → Settings → Advanced → enable "Use as default Ethereum wallet". ` +
          `Or disable ${ownerLabel}. Or pick MetaMask from the wallet modal (EIP-6963 still routes correctly there).`,
        duration: 15_000,
      });
    }, 1_500);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}

export default WalletConflictDetector;
