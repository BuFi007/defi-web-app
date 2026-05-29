"use client";

import { useEffect, useState } from "react";
import { useAccount, useSignMessage, useWriteContract } from "wagmi";
import { createPublicClient, http, parseAbi } from "viem";
import { arcTestnet } from "viem/chains";
import { KAWAII_GATE } from "@/lib/kawaii/config";

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

  const price = Number(KAWAII_GATE.testnet.priceUsdc) / 1e6;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0718]/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-violet-500/40 bg-[#0d0a1a]/95 p-7 shadow-[0_0_60px_-15px_rgba(124,92,255,0.5)]">
        <div className="text-center">
          <div className="text-4xl">👻</div>
          <h2 style={{ fontFamily: "Knicknack" }} className="mt-2 text-3xl text-violet-400">
            Kawaii Punks
          </h2>
          <p className="mt-1 text-sm text-violet-200/70">Invite-only beta · Arc Testnet</p>
          <p className="mt-3 text-xs text-violet-200/50">
            A customizable, cross-chain avatar. Powers up as you trade. Testnet is for trying it —
            upgrade to mainnet later to climb the leaderboard.
          </p>
        </div>

        {/* Socials requisite (A.6 wires OAuth; for now links + manual verify) */}
        <div className="mt-5">
          <p className="text-xs font-medium text-violet-200/70">Follow to qualify (all 3):</p>
          <div className="mt-2 flex gap-2">
            {SOCIALS.map((s) => {
              const ok = verifiedSocials.includes(s.id);
              // discord/x → OAuth redirect; telegram → login widget (wired separately, A.6 note)
              const href = address && s.id !== "telegram" ? `/api/kawaii/social/${s.id}/start?wallet=${address}` : undefined;
              return (
                <a
                  key={s.id}
                  href={href}
                  className={`flex-1 rounded-full border py-1.5 text-center text-xs ${
                    ok ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200" : "border-violet-500/30 text-violet-100 hover:bg-violet-500/10"
                  }`}
                >
                  {ok ? "✓ " : ""}
                  {s.label}
                </a>
              );
            })}
          </div>
        </div>

        {/* Base picker */}
        <div className="mt-5">
          <p className="text-xs font-medium text-violet-200/70">Choose your base:</p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {catalog.open.slice(0, 7).map((b) => (
              <button
                key={b}
                onClick={() => setBaseId(b)}
                className={`aspect-square rounded-lg border text-[9px] ${
                  baseId === b ? "border-violet-400 bg-violet-500/20" : "border-violet-500/20 hover:border-violet-500/40"
                }`}
                title={b}
              >
                {b.replace(/^base_|\.png$/g, "").slice(0, 8)}
              </button>
            ))}
            {/* Reserved — visible, locked */}
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
          disabled={!isConnected || !baseId || busy}
          className="mt-6 w-full rounded-full bg-white py-3 font-medium text-violet-700 transition hover:bg-violet-50 disabled:opacity-40"
        >
          {busy ? "…" : `Mint Kawaii Punk · ${price} USDC`}
        </button>
        {status && <p className="mt-3 text-center text-xs text-violet-200/80">{status}</p>}

        <p className="mt-5 text-center text-[11px] text-violet-200/50">
          No NFT?{" "}
          <a href="https://mcp.bu.finance" className="text-violet-300 underline">
            Trade via our AI agent with nanopayments
          </a>{" "}
          — no mint needed.
        </p>
      </div>
    </div>
  );
}
