"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useAccount, useSignMessage, useWriteContract } from "wagmi";
import { createPublicClient, http, parseAbi } from "viem";
import { arcTestnet } from "viem/chains";
import { KAWAII_GATE } from "@/lib/kawaii/config";
import { KawaiiFund } from "./kawaii-fund";
import AnimatedBackground from "@/components/animated-background";

/**
 * Kawaii Punks invite gate — ADDITIVE overlay, modeled on Tower Exchange's
 * invite-only modal and the app's existing "Welcome / Connect Wallet" card
 * (dark card, Knicknack display headline, Poppins body, violet accent + glow,
 * white rounded-full CTA). Does NOT restyle existing UX — render it only when a
 * connected wallet lacks a Kawaii Punk.
 *
 * Flow: connect (handled upstream) → verify socials (Discord+TG+X) → pick a base
 * → sign the mint intent → POST /api/kawaii/mint. Reserved bases show locked.
 * Trading via the AI-MCP nanopay gate needs no NFT (advertised below).
 */
const SOCIALS = [
  { id: "discord", label: "Discord" },
  { id: "telegram", label: "Telegram" },
  { id: "x", label: "X" },
] as const;

const TIERS = {
  testnet: { label: "Testnet", chain: "Arc Testnet", price: 100, socials: "all 3", mintable: true },
  mainnet: { label: "Mainnet", chain: "Avalanche", price: 5, socials: "X + one", mintable: false },
} as const;
type TierKey = keyof typeof TIERS;

type ReservedDisplay = { display: string; platform: string; claimUrl: string; mock: boolean };
export type Catalog = { open: string[]; reserved: Record<string, ReservedDisplay> };

export function KawaiiGate({ catalog }: { catalog: Catalog }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const [baseId, setBaseId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [verifiedSocials, setVerifiedSocials] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [tier, setTier] = useState<TierKey>("testnet");
  const t = TIERS[tier];

  // Poll which socials are verified (also refreshes after returning from OAuth).
  useEffect(() => {
    if (!address) return;
    fetch(`/api/kawaii/social/status?wallet=${address}`)
      .then((r) => r.json())
      .then((d) => setVerifiedSocials(d.verified ?? []))
      .catch(() => {});
  }, [address]);

  async function submit(body: Record<string, unknown>) {
    const res = await fetch("/api/kawaii/mint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { res, data: await res.json() };
  }

  async function mint() {
    if (!address || !baseId) return;
    setBusy(true);
    try {
      setStatus("Sign the mint request in your wallet…");
      const deadline = Math.floor(Date.now() / 1000) + 600;
      const nonce = crypto.randomUUID();
      const message = `Kawaii Punk mint\nwallet:${address}\nbase:${baseId}\ndeadline:${deadline}\nnonce:${nonce}`;
      const signature = await signMessageAsync({ message });
      const base = { wallet: address, baseId, deadline, nonce, signature };

      setStatus("Minting…");
      let { res, data } = await submit(base);

      // Payment path (testnet = USDC on Arc): transfer USDC → agent, then resubmit with the tx.
      if (!res.ok && data.error === "payment_required") {
        setStatus(`Approve ${Number(data.priceUsdc) / 1e6} USDC in your wallet…`);
        const txHash = await writeContractAsync({
          address: KAWAII_GATE.testnet.usdc as `0x${string}`, // USDC token
          abi: parseAbi(["function transfer(address,uint256) returns (bool)"]),
          functionName: "transfer",
          args: [data.to as `0x${string}`, BigInt(data.priceUsdc)], // → earnings agent
        });
        setStatus("Confirming payment…");
        const pc = createPublicClient({ chain: arcTestnet, transport: http() });
        await pc.waitForTransactionReceipt({ hash: txHash });
        setStatus("Minting…");
        ({ res, data } = await submit({ ...base, paymentTx: txHash }));
      }

      if (!res.ok) {
        if (data.error === "socials_required") setStatus(`Verify your socials first: ${data.missing.join(", ")}`);
        else if (data.error === "payment_unverified") setStatus(`Payment not verified: ${data.reason}`);
        else setStatus(data.error ?? "Mint failed");
        return;
      }
      setStatus(`✅ Minted! tx ${String(data.txId).slice(0, 10)}…`);
    } catch (e) {
      setStatus((e as Error).message ?? "Mint cancelled");
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;
  // Portal to <body> to escape the app's stacking context so the overlay sits
  // above the header (z-100) and footer/player — they render behind it.
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto p-4">
      {/* The overlay IS the MBV magenta-kawaii animated background (no tint layer). */}
      <AnimatedBackground variant="pink" className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className="relative my-auto w-full max-w-2xl rounded-2xl border border-fuchsia-300/40 bg-[#1a0a18]/85 p-6 shadow-[0_0_80px_-10px_rgba(217,70,239,0.6)] sm:p-7">
        {/* Title: "Kawaii Punks" (pink) · by [BU.FI typographic logo], like the header. */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="text-3xl">👻</span>
            <h2 className="font-knick text-3xl text-fuchsia-400">Kawaii Punks</h2>
          </div>
          <div className="mt-1 flex items-center justify-center gap-1.5">
            <span className="font-knick text-sm text-violet-300">by</span>
            <span className="inline-flex items-center rounded-md bg-white/90 px-1.5 py-0.5">
              <Image src="/assets/tipografico-alpha.png" alt="BU.FI" width={743} height={256} className="h-auto w-[52px] select-none" priority={false} />
            </span>
          </div>
          <p className="mt-2 text-sm text-fuchsia-100/70">Invite-only beta · {t.chain}</p>
          <p className="mx-auto mt-2 max-w-md text-xs text-fuchsia-100/50">
            A customizable, cross-chain avatar. Powers up as you trade. Testnet is for trying it —
            upgrade to mainnet later to climb the leaderboard.
          </p>
          {/* Testnet / Mainnet toggle */}
          <div className="mt-3 flex justify-center">
            <div className="inline-flex rounded-full border border-fuchsia-400/30 p-0.5">
              {(Object.keys(TIERS) as TierKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setTier(k)}
                  className={`rounded-full px-4 py-1 text-xs transition ${
                    tier === k ? "bg-fuchsia-400/25 text-fuchsia-50" : "text-fuchsia-100/50 hover:text-fuchsia-100"
                  }`}
                >
                  {TIERS[k].label}
                  {!TIERS[k].mintable && <span className="ml-1 text-[9px] opacity-60">soon</span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Two columns: socials | fund */}
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-fuchsia-100/70">Follow to qualify ({t.socials}):</p>
            <div className="mt-2 flex flex-col gap-2">
              {SOCIALS.map((s) => {
                const ok = verifiedSocials.includes(s.id);
                const href = address && s.id !== "telegram" ? `/api/kawaii/social/${s.id}/start?wallet=${address}` : undefined;
                return (
                  <a
                    key={s.id}
                    href={href}
                    className={`rounded-full border py-1.5 text-center text-xs ${
                      ok ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200" : "border-fuchsia-400/30 text-fuchsia-50 hover:bg-fuchsia-400/10"
                    }`}
                  >
                    {ok ? "✓ " : ""}
                    {s.label}
                  </a>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col justify-start">
            {tier === "testnet" ? (
              <KawaiiFund />
            ) : (
              <div className="rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/5 p-3 text-[11px] leading-snug text-fuchsia-100/60">
                Mainnet mints pay {t.price} USDC (or JPYC −20%) on Avalanche and climb the leaderboard. Coming with the mainnet tier.
              </div>
            )}
          </div>
        </div>

        {/* Avatar selector — full width below the columns */}
        <div className="mt-5">
          <p className="text-xs font-medium text-fuchsia-100/70">Choose your base:</p>
          <div className="mt-2 grid grid-cols-5 gap-2 sm:grid-cols-6">
            {catalog.open.slice(0, 8).map((b) => (
              <button
                key={b}
                onClick={() => setBaseId(b)}
                className={`aspect-square overflow-hidden rounded-lg border bg-black/20 ${
                  baseId === b ? "border-fuchsia-400 ring-2 ring-fuchsia-400/50" : "border-fuchsia-400/20 hover:border-fuchsia-400/40"
                }`}
                title={b}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/kawaii/layer?cat=base&file=${encodeURIComponent(b)}`}
                  alt={b}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
            {Object.entries(catalog.reserved).map(([k, v]) => (
              <div
                key={k}
                className="relative aspect-square cursor-not-allowed rounded-lg border border-amber-400/40 bg-amber-400/5 text-[8px] text-amber-200/80"
                title={`Reserved — ${v.display}`}
              >
                <span className="absolute inset-0 flex items-center justify-center">🔒</span>
                <span className="absolute bottom-0.5 left-0 right-0 text-center">{v.display.slice(0, 8)}</span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-amber-200/50">🔒 reserved for criptopoeta · danissblue · Jeremy Allaire · Circle</p>
        </div>

        <button
          onClick={mint}
          disabled={!isConnected || !baseId || busy || !t.mintable}
          className="mt-5 w-full rounded-full bg-white py-3 font-medium text-fuchsia-700 transition hover:bg-fuchsia-50 disabled:opacity-40"
        >
          {!t.mintable ? "Mainnet — coming soon" : busy ? "…" : `Mint Kawaii Punk · ${t.price} USDC`}
        </button>
        {status && <p className="mt-3 text-center text-xs text-fuchsia-100/80">{status}</p>}

        <p className="mt-4 text-center text-[11px] text-fuchsia-100/50">
          No NFT?{" "}
          <a href="https://mcp.bu.finance" className="text-fuchsia-200 underline">
            Trade via our AI agent with nanopayments
          </a>{" "}
          — no mint needed.
        </p>
      </div>
    </div>,
    document.body,
  );
}
