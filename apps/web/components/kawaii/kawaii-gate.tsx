"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useSignMessage, useWriteContract, useReadContract } from "wagmi";
import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { arcTestnet } from "viem/chains";
import {
  KAWAII_GATE,
  KAWAII_LAYER_ORDER,
  KAWAII_TRAIT_TIERS,
  KAWAII_GUILD_URLNAME,
} from "@/lib/kawaii/config";

/**
 * Kawaii Punks — Token Gate (bold drop-poster edition).
 *
 * Faithful port of the Claude Code "Bufi Trade Island" gate design (gate.jsx +
 * gate.css, the `kg-*` class system) — the pink "NFT is NOT DEAD" campaign
 * poster + mint side. Rendered EMBEDDED inside the dynamic-island Identity tab
 * (not fullscreen): pre-mint surface with every other tab locked until mint.
 *
 * Wired to OUR real backend, not the design's mocks:
 *   - bases + reserved legends from /api/kawaii/catalog
 *   - X + Discord follow state from /api/kawaii/social/status (Guild.xyz, free)
 *   - live USDC-on-Arc balance via wagmi
 *   - mint runs the real sign → /api/kawaii/mint → USDC-on-Arc → resubmit flow
 * The net toggle defaults to Mainnet (pre-launch preview); the working mint
 * settles on Arc Testnet (the deployed sandbox, 10 USDC).
 */

// ── asset map (design name → our real /assets/kawaii file) ──────────────────
const A = {
  logo: "/assets/kawaii/kawaii-punks-stacked.png", // clean Kawaii Punks logo (poster crown + solo bar)
  poster: "/assets/kawaii/nft-is-not-dead-poster.png",
  stickerDrop: "/assets/kawaii/sticker-punk-drop.png",
  stickerArc: "/assets/kawaii/sticker-arc-usdc.png",
  frame: "/assets/kawaii/frame.png",
  logoStacked: "/assets/kawaii/kawaii-punks-x-bufi-stacked.png",
  king: "/assets/kawaii/crown.png",
};
// Real stablecoin token icons (shared with the trade-island token chips).
const TOKEN_ICON = { jpyc: "/assets/stable-tokens/jpyc_token_icon.png", usdc: "/assets/stable-tokens/usdc_token_icon.svg" } as const;

const layerSrc = (cat: string, file: string) => `/api/kawaii/layer?cat=${cat}&file=${encodeURIComponent(file)}`;
const fileLabel = (f: string) => {
  const b = f.replace(/\.png$/i, "").replace(/[_-]+/g, " ").trim();
  return b.charAt(0).toUpperCase() + b.slice(1);
};

type ReservedDisplay = { display: string; platform: string; claimUrl: string; mock: boolean };
export type Catalog = {
  open: string[];
  reserved: Record<string, ReservedDisplay>;
  traits: Record<string, string[]>;
};

type Equip = Record<string, string>;

function GateCheck() {
  return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3 3 7-7" /></svg>;
}
function Arrow() {
  return <span className="arrow"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h10M9 4l4 4-4 4" /></svg></span>;
}
// Chain pips — same circular brand-mark style as the loan/borrow market cards
// (HubPip): the canonical /networks SVGs on a neutral disc with a tinted ring.
const CHAIN_ICON = {
  avax: { src: "/networks/avax.svg", color: "#E84142", name: "Avalanche" },
  arc: { src: "/networks/arc.svg", color: "#3a1b78", name: "Arc" },
} as const;
function ChainPip({ k }: { k: keyof typeof CHAIN_ICON }) {
  const c = CHAIN_ICON[k];
  return (
    <span className="kg-chain-pip" title={c.name} style={{ boxShadow: `inset 0 0 0 1.2px ${c.color}40` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={c.src} alt={c.name} />
    </span>
  );
}

function GateBrand({ name }: { name: string }) {
  if (name === "discord")
    return <div className="brand-ic" style={{ background: "#5865F2" }}><svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.5a14.6 14.6 0 0 1 4.3 1.4A19.4 19.4 0 0 0 4.5 4.9 14.6 14.6 0 0 1 8.9 3.5L8.6 3a19.8 19.8 0 0 0-4.9 1.4C1 8.4.3 12.3.6 16.1a19.9 19.9 0 0 0 6 3l.8-1.1c-.7-.3-1.3-.6-1.9-1l.5-.3a14.2 14.2 0 0 0 12.1 0l.5.3c-.6.4-1.2.7-1.9 1l.8 1.1a19.9 19.9 0 0 0 6-3c.4-4.5-.7-8.4-3.5-11.7zM8.7 13.8c-1 0-1.7-.9-1.7-1.9s.8-1.9 1.7-1.9 1.7.9 1.7 1.9-.8 1.9-1.7 1.9zm6.6 0c-1 0-1.7-.9-1.7-1.9s.8-1.9 1.7-1.9 1.7.9 1.7 1.9-.8 1.9-1.7 1.9z" /></svg></div>;
  return <div className="brand-ic" style={{ background: "#000" }}><svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M18.9 2H22l-7.4 8.4L23 22h-6.8l-5.3-7-6.1 7H1.7l7.9-9L1 2h7l4.8 6.3L18.9 2zm-2.4 18h1.9L7.6 4H5.6l10.9 16z" /></svg></div>;
}

// ── In-gate avatar customizer ────────────────────────────────────────────
// Base skin is the fixed bottom layer (always selectable, all bases unlocked).
// Background is a color behind the transparent avatar PNG. Accessories layer on
// top and stay LOCKED until minted + the category's power tier is reached.
const KG_CAT_ORDER = ["head_accessories", "eyeglasses", "eyes", "face_marks", "jewelry", "neckwear", "tops", "hair_front", "brows", "hair_back", "outerwear_details"];
const KG_CAT_LABEL: Record<string, string> = {
  base: "Base", background: "Background",
  head_accessories: "Headwear", eyeglasses: "Glasses", eyes: "Eyes", face_marks: "Marks",
  jewelry: "Jewelry", neckwear: "Neck", tops: "Tops", hair_front: "Hair", hair_back: "Hair·B",
  brows: "Brows", outerwear_details: "Patches",
};

// Background swatches — the avatar PNG is transparent alpha, so the chosen color
// shows behind it (no image asset needed).
const KG_BG = [
  { id: "none", css: "transparent", label: "None" },
  { id: "lav", css: "#ece0ff", label: "Lavender" },
  { id: "mint", css: "#d5f5e3", label: "Mint" },
  { id: "peach", css: "#ffe6d8", label: "Peach" },
  { id: "sky", css: "#d8edf3", label: "Sky" },
  { id: "rose", css: "#ffe0ef", label: "Rose" },
  { id: "sun", css: "#fff3c4", label: "Sun" },
  { id: "grape", css: "linear-gradient(135deg,#8a6aff,#ff7ad0)", label: "Grape" },
  { id: "ocean", css: "linear-gradient(135deg,#3fa9f5,#5fd6a8)", label: "Ocean" },
  { id: "dusk", css: "linear-gradient(135deg,#ff9ad6,#b98aff)", label: "Dusk" },
];

function kgCatUnlocked(cat: string, power: number, minted: boolean): boolean {
  if (cat === "base" || cat === "background") return true; // always selectable
  if (!minted) return false; // accessories stay locked until you mint
  return power >= (KAWAII_TRAIT_TIERS[cat]?.power ?? 0);
}

function LockGlyph() {
  return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5 7V5a3 3 0 016 0v2" /></svg>;
}
function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {dir === "left" ? <path d="M10 3 5 8l5 5" /> : <path d="M6 3l5 5-5 5" />}
    </svg>
  );
}

// One carousel page = 4 columns × 2 rows.
const KG_PAGE = 8;
type CItem =
  | { k: "base"; id: string }
  | { k: "bg"; id: string; css: string; label: string }
  | { k: "none" }
  | { k: "trait"; id: string };

function KGCustomizer({ catalog, base, setBase, bg, setBg, equip, setEquip, power = 0, minted = false, split = false }: {
  catalog: Catalog;
  base: string | null;
  setBase: (b: string) => void;
  bg: string;
  setBg: (c: string) => void;
  equip: Equip;
  setEquip: (e: Equip) => void;
  power?: number;
  minted?: boolean;
  split?: boolean; // post-mint: avatar left, options right (4×4 carousel)
}) {
  const accessoryCats = useMemo(() => KG_CAT_ORDER.filter((c) => (catalog.traits?.[c]?.length ?? 0) > 0), [catalog]);
  const cats = useMemo(() => ["base", "background", ...accessoryCats], [accessoryCats]);
  const [cat, setCat] = useState("base"); // base is the first selectable item
  const [page, setPage] = useState(0);
  const bases = catalog.open;
  const unlocked = kgCatUnlocked(cat, power, minted);

  const layers = useMemo(() => {
    const sel: Equip = { ...(base ? { base } : {}), ...equip };
    return KAWAII_LAYER_ORDER.filter((c) => sel[c]).map((c) => ({ cat: c, file: sel[c] }));
  }, [base, equip]);

  function toggleTrait(file: string) {
    if (!unlocked) return;
    const next = { ...equip };
    if (next[cat] === file) delete next[cat];
    else next[cat] = file;
    setEquip(next);
  }
  function pick(c: string) { setCat(c); setPage(0); }

  // Unified item list for the active category → paginated 4×2 carousel.
  const items: CItem[] = useMemo(() => {
    if (cat === "base") return bases.map((b) => ({ k: "base", id: b }));
    if (cat === "background") return KG_BG.map((b) => ({ k: "bg", id: b.id, css: b.css, label: b.label }));
    const files = catalog.traits?.[cat] ?? [];
    const head: CItem[] = unlocked && equip[cat] ? [{ k: "none" }] : [];
    return [...head, ...files.map((f): CItem => ({ k: "trait", id: f }))];
  }, [cat, bases, catalog, unlocked, equip]);
  const perPage = split ? 16 : KG_PAGE;
  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  const pageClamped = Math.min(page, pageCount - 1);
  const pageItems = items.slice(pageClamped * perPage, pageClamped * perPage + perPage);

  function renderTile(it: CItem, i: number) {
    if (it.k === "base") {
      return (
        <button key={"b:" + it.id} className={"kg-cust-tile " + (base === it.id ? "on" : "")} onClick={() => setBase(it.id)} title={fileLabel(it.id)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <span className="kg-cust-pic"><img src={layerSrc("base", it.id)} alt="" loading="lazy" /></span>
          {base === it.id && <span className="kg-cust-tick"><GateCheck /></span>}
        </button>
      );
    }
    if (it.k === "bg") {
      return (
        <button key={"g:" + it.id} className={"kg-cust-tile bg " + (bg === it.css ? "on" : "")} onClick={() => setBg(it.css)} title={it.label}>
          <span className="kg-cust-pic" style={{ background: it.css }} />
          {bg === it.css && <span className="kg-cust-tick"><GateCheck /></span>}
          <span className="kg-cust-cap">{it.label}</span>
        </button>
      );
    }
    if (it.k === "none") {
      return (
        <button key={"none:" + i} className="kg-cust-tile none" onClick={() => { const n = { ...equip }; delete n[cat]; setEquip(n); }}>
          <span className="none-x"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg></span>
          <span className="kg-cust-cap">None</span>
        </button>
      );
    }
    const file = it.id;
    const on = equip[cat] === file;
    return (
      <button key={"t:" + file} className={"kg-cust-tile " + (on ? "on " : "") + (unlocked ? "" : "locked")} onClick={() => toggleTrait(file)} title={fileLabel(file)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <span className="kg-cust-pic"><img src={layerSrc(cat, file)} alt="" loading="lazy" /></span>
        {!unlocked && <span className="kg-cust-lock"><LockGlyph /></span>}
        {on && <span className="kg-cust-tick"><GateCheck /></span>}
        <span className="kg-cust-cap">{unlocked ? fileLabel(file).split(" ").slice(0, 2).join(" ") : `${KAWAII_TRAIT_TIERS[cat]?.power ?? 0} pwr`}</span>
      </button>
    );
  }

  // Description of the active category / selected item (left of the avatar).
  const descName =
    cat === "base" ? (base ? fileLabel(base) : "—")
    : cat === "background" ? (KG_BG.find((b) => b.css === bg)?.label ?? "None")
    : equip[cat] ? fileLabel(equip[cat]) : (KG_CAT_LABEL[cat] ?? cat);
  const descSub =
    cat === "base" ? "Your fixed base skin"
    : cat === "background" ? "Colour behind your punk"
    : !unlocked ? `Unlocks at ${KAWAII_TRAIT_TIERS[cat]?.power ?? 0} pwr`
    : equip[cat] ? "Equipped" : `Tap to add ${(KG_CAT_LABEL[cat] ?? cat).toLowerCase()}`;

  return (
    <div className={"kg-cust" + (split ? " split" : "")}>
      {/* Stage = 2 cols: item description (left) · avatar (right) */}
      <div className="kg-cust-stage">
        <div className="kg-cust-desc">
          <span className="kg-cust-desc-cat">{cat === "base" ? "Base" : cat === "background" ? "Background" : KG_CAT_LABEL[cat] ?? cat}</span>
          <span className="kg-cust-desc-name">{descName}</span>
          <span className="kg-cust-desc-sub">{descSub}</span>
        </div>
        {/* bg lives ON the avatar square (same size as the base PNG) — a layer
            behind the transparent base, not the whole stage. */}
        <div className="kg-cust-av" style={{ background: bg || "transparent" }}>
          {layers.map((l) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={l.cat} src={layerSrc(l.cat, l.file)} alt="" />
          ))}
        </div>
      </div>
      <div className="kg-cust-panel">
        <div className="kg-cust-head">
          <span className="kg-cust-title">{cat === "base" ? "Choose your base" : cat === "background" ? "Background" : KG_CAT_LABEL[cat] ?? cat}</span>
          <span className="kg-cust-hint">{pageCount > 1 ? `${pageClamped + 1} / ${pageCount}` : minted ? "Unlock more as you trade →" : "Mint + trade to unlock →"}</span>
        </div>
        <div className="kg-cust-cats">
          {cats.map((c) => {
            const ok = kgCatUnlocked(c, power, minted);
            return (
              <button key={c} className={(cat === c ? "active " : "") + (ok ? "" : "locked")} onClick={() => pick(c)}>
                {KG_CAT_LABEL[c] ?? c}{!ok && " 🔒"}
              </button>
            );
          })}
        </div>
        {/* 4×2 carousel: ◀ [grid] ▶ — all horizontal, chevrons centered */}
        <div className="kg-cust-carousel">
          <button className="kg-cust-nav" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={pageClamped === 0} aria-label="Previous">
            <Chevron dir="left" />
          </button>
          <div className="kg-cust-grid" key={cat + ":" + pageClamped}>
            {pageItems.map((it, i) => renderTile(it, i))}
          </div>
          <button className="kg-cust-nav" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={pageClamped >= pageCount - 1} aria-label="Next">
            <Chevron dir="right" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
export function KawaiiGate({ catalog, onMinted, onSkip, embedded = true }: {
  catalog: Catalog;
  onMinted?: () => void;
  onSkip?: () => void;
  embedded?: boolean;
}) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();

  const [follows, setFollows] = useState<{ x: boolean; discord: boolean }>({ x: false, discord: false });
  const [socialSource, setSocialSource] = useState<"guild" | "oauth">("guild"); // Guild is the always-on oracle
  const [net, setNet] = useState<"mainnet" | "testnet">("mainnet"); // mainnet = default preview
  const [payWith, setPayWith] = useState<"jpyc" | "usdc">("jpyc");
  const [leftView, setLeftView] = useState<"poster" | "punk">("punk"); // customizer (base selection) is central
  const [base, setBase] = useState<string | null>(null);
  const [bg, setBg] = useState<string>("transparent"); // avatar background (none by default; swatch adds color behind the transparent PNG)
  const [equip, setEquip] = useState<Equip>({});
  const [phase, setPhase] = useState<"gate" | "minting">("gate");
  const [prog, setProg] = useState(0);
  const [minted, setMinted] = useState(false);
  const [status, setStatus] = useState("");
  const [whitelisted, setWhitelisted] = useState(false); // waives payment → Free Mint (socials still required)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const bases = catalog.open; // show ALL bases (scrollable grid)
  const baseFile = base ?? bases[0] ?? null;

  const isMainnet = net === "mainnet";
  const testUsd = Number(KAWAII_GATE.testnet.priceUsdc) / 1e6; // 10
  const netLabel = isMainnet ? "Arc Mainnet" : "Arc Testnet";
  const mintLabel = whitelisted
    ? "Free Mint"
    : isMainnet
      ? payWith === "jpyc" ? "Mint · ¥525 JPYC" : "Mint on Arc · $5 USDC"
      : `Mint · ${testUsd} testnet USDC`;

  // Poll verified socials — on mount AND when the tab regains focus (the user
  // returns from joining guild.xyz/kawaii-punks in another tab → re-check).
  useEffect(() => {
    if (!address) return;
    let alive = true;
    const check = () => {
      fetch(`/api/kawaii/social/status?wallet=${address}`)
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          const v: string[] = d.verified ?? [];
          setFollows({ x: v.includes("x"), discord: v.includes("discord") });
          if (d.source) setSocialSource(d.source);
        })
        .catch(() => {});
      fetch(`/api/kawaii/status?wallet=${address}`)
        .then((r) => r.json())
        .then((d) => { if (alive) setWhitelisted(!!d.whitelisted); })
        .catch(() => {});
    };
    check();
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { alive = false; window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [address]);

  // Live USDC-on-Arc balance.
  const { data: usdcBal } = useReadContract({
    address: KAWAII_GATE.testnet.usdc as `0x${string}`,
    abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: KAWAII_GATE.testnet.chainId,
    query: { enabled: !!address, refetchInterval: 12000 },
  });
  const usdcOnArc = usdcBal != null ? Number(formatUnits(usdcBal as bigint, 6)) : null;

  const allFollowed = follows.x && follows.discord;
  const needed = whitelisted ? 0 : isMainnet ? (payWith === "jpyc" ? 3.5 : 5) : testUsd;
  const balanceOk = whitelisted || usdcOnArc == null ? true : usdcOnArc >= needed;
  // Socials are ALWAYS required (whitelist only waives payment, not the follow gate).
  const canMint = isConnected && allFollowed && balanceOk && !!baseFile && phase === "gate";

  function followHref(id: "x" | "discord") {
    return socialSource === "guild" ? `https://guild.xyz/${KAWAII_GUILD_URLNAME}` : address ? `/api/kawaii/social/${id}/start?wallet=${address}` : undefined;
  }

  async function submit(body: Record<string, unknown>) {
    const res = await fetch("/api/kawaii/mint", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { res, data: await res.json() };
  }

  async function runMint() {
    if (!address || !baseFile) return;
    setPhase("minting");
    setProg(0.1);
    try {
      setStatus("Sign the mint request in your wallet…");
      const deadline = Math.floor(Date.now() / 1000) + 600;
      const nonce = crypto.randomUUID();
      const message = `Kawaii Punk mint\nwallet:${address}\nbase:${baseFile}\ndeadline:${deadline}\nnonce:${nonce}`;
      const signature = await signMessageAsync({ message });
      const baseBody = { wallet: address, baseId: baseFile, deadline, nonce, signature };
      setProg(0.35);
      setStatus("Minting…");
      let { res, data } = await submit(baseBody);

      if (!res.ok && data.error === "payment_required") {
        setStatus(`Approve ${Number(data.priceUsdc) / 1e6} USDC in your wallet…`);
        const txHash = await writeContractAsync({
          address: KAWAII_GATE.testnet.usdc as `0x${string}`,
          abi: parseAbi(["function transfer(address,uint256) returns (bool)"]),
          functionName: "transfer",
          args: [data.to as `0x${string}`, BigInt(data.priceUsdc)],
        });
        setProg(0.6);
        setStatus("Confirming on Arc…");
        const pc = createPublicClient({ chain: arcTestnet, transport: http() });
        await pc.waitForTransactionReceipt({ hash: txHash });
        setProg(0.8);
        setStatus("Registering your Punk…");
        ({ res, data } = await submit({ ...baseBody, paymentTx: txHash }));
      }

      if (!res.ok) {
        if (data.error === "socials_required") setStatus(`Verify your socials first: ${(data.missing ?? []).join(", ")}`);
        else if (data.error === "payment_unverified") setStatus(`Payment not verified: ${data.reason}`);
        else setStatus(data.error ?? "Mint failed");
        setPhase("gate");
        return;
      }
      setProg(1);
      setStatus("Done");
      setTimeout(() => { setMinted(true); setLeftView("punk"); setPhase("gate"); }, 450);
    } catch (e) {
      setStatus((e as Error).message ?? "Mint cancelled");
      setPhase("gate");
    }
  }

  if (!mounted) return null;

  // ── Post-mint: single-panel solo dashboard ──
  if (minted) {
    return (
      <div className={"kg-root" + (embedded ? " embedded" : "")}>
        <div className="kg-card solo">
          <div className="kg-solo-bar">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="kg-solo-logo" src={A.logo} alt="Kawaii Punks" />
            <span className="kg-solo-net">● {netLabel}</span>
            <span className="kg-solo-badge">1 / 1 punk · minted</span>
            <button className="kg-mint kg-solo-enter" onClick={() => onMinted?.()}>
              Enter BU.FI <Arrow />
            </button>
          </div>
          <div className="kg-solo-body">
            <KGCustomizer catalog={catalog} base={baseFile} setBase={setBase} bg={bg} setBg={setBg} equip={equip} setEquip={setEquip} power={0} minted />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={"kg-root" + (embedded ? " embedded" : "")}>
      <div className="kg-card">
        {onSkip && (
          <button className="kg-close" onClick={onSkip} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        )}

        {/* LEFT — poster hero / live Kawaii Punk preview. The logo + poster art +
            stickers + tagline are POSTER-ONLY chrome; "Your Kawaii Punk" shows
            just the composed avatar customizer. */}
        <div className="kg-poster">
          <div className="kg-left-toggle">
            <button className={leftView === "poster" ? "active" : ""} onClick={() => setLeftView("poster")}>Poster</button>
            <button className={leftView === "punk" ? "active" : ""} onClick={() => setLeftView("punk")} title="Preview your Kawaii Punk">Your Kawaii Punk</button>
          </div>
          <div className="kg-poster-stage">
            <div className="kg-poster-glow" />
            {leftView === "poster" ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="kg-kawaii-logo" src={A.logo} alt="Kawaii Punks" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="kg-poster-img" src={A.poster} alt="NFT is not dead" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="kg-sticker-drop" src={A.stickerDrop} alt="Punk Drop" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="kg-sticker-arc" src={A.stickerArc} alt="Arc · USDC" />
              </>
            ) : (
              <KGCustomizer catalog={catalog} base={baseFile} setBase={setBase} bg={bg} setBg={setBg} equip={equip} setEquip={setEquip} power={0} minted={false} />
            )}
          </div>
          {leftView === "poster" && <div className="kg-tagline">We build. We scratch. <span className="own">We own.</span> ♥ <span className="own">Stablecoin Summer</span></div>}
        </div>

        {/* RIGHT — mint side (no washi-frame shell — clean surface, more room) */}
        <div className="kg-panel">
          {/* Net toggle pinned top-right of the panel */}
          <div className="kg-net">
            <button className={isMainnet ? "active" : ""} onClick={() => setNet("mainnet")}>
              <span className="kg-net-chains"><ChainPip k="avax" /><ChainPip k="arc" /></span>
              Mainnet
            </button>
            <button className={!isMainnet ? "active" : ""} onClick={() => setNet("testnet")}>
              <span className="kg-net-chains"><ChainPip k="arc" /></span>
              Testnet
            </button>
          </div>
          {/* Big Kawaii Punks × BU.FI logo, top-center */}
          <div className="kg-logo-crown">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={A.logoStacked} alt="Kawaii Punks × BU.FI" />
          </div>

          <h2 className="kg-slogan">NFT is NOT DEAD. <span className="scratch">Stablecoin Summer</span></h2>

          <span className="kg-label">Follow to qualify</span>
          <div className="kg-follows two">
            {(["x", "discord"] as const).map((id) => (
              <a key={id} href={followHref(id)} target={socialSource === "guild" ? "_blank" : undefined} rel="noreferrer"
                className={"kg-follow " + (follows[id] ? "done" : "")} style={{ textDecoration: "none" }}>
                <GateBrand name={id} />
                <span className="name">{id === "x" ? "X" : "Discord"}</span>
                <span className="state"><GateCheck /></span>
              </a>
            ))}
          </div>

          {isMainnet ? (
            <div className={"kg-pay" + (whitelisted ? " free" : "")}>
              <div className="kg-pay-head">
                <span className="kg-label">Pay with</span>
                <span className="kg-pay-hint">{whitelisted ? "Whitelisted · free mint" : "Save 30% with JPYC"}</span>
              </div>
              <div className="kg-pay-opts">
                <button className={"kg-pay-opt jpyc " + (payWith === "jpyc" ? "active" : "")} onClick={() => setPayWith("jpyc")}>
                  {!whitelisted && <span className="kg-pay-ribbon">Best</span>}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <span className="pay-row"><img className="pay-ic-img" src={TOKEN_ICON.jpyc} alt="JPYC" width={26} height={26} /><span className="pay-meta"><span className="pay-name">JPYC</span><span className="pay-sub">on Avalanche</span></span></span>
                  <span className="pay-price-row"><span className={"pay-yen" + (whitelisted ? " scratch" : "")}>¥525</span>{whitelisted ? <span className="pay-free">¥0</span> : <span className="pay-usd">≈ $3.50</span>}</span>
                  <span className={"pay-save" + (whitelisted ? " free" : "")}>{whitelisted ? "FREE" : "30% off"}</span>
                </button>
                <button className={"kg-pay-opt usdc " + (payWith === "usdc" ? "active" : "")} onClick={() => setPayWith("usdc")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <span className="pay-row"><img className="pay-ic-img" src={TOKEN_ICON.usdc} alt="USDC" width={26} height={26} /><span className="pay-meta"><span className="pay-name">USDC</span><span className="pay-sub">on Arc</span></span></span>
                  <span className="pay-price-row"><span className={"pay-yen" + (whitelisted ? " scratch" : "")}>$5</span>{whitelisted ? <span className="pay-free">$0</span> : <span className="pay-usd">≈ ¥750</span>}</span>
                  <span className={"pay-save" + (whitelisted ? " free" : " plain")}>{whitelisted ? "FREE" : "List"}</span>
                </button>
              </div>
              <div className="kg-bal">
                <span className="kg-bal-dot" />
                {whitelisted
                  ? <><strong>Whitelisted</strong> — price waived, you pay <strong>$0</strong>. Verify socials to claim.</>
                  : <>Balance <strong>{usdcOnArc == null ? "…" : usdcOnArc.toFixed(2)} USDC</strong> on Arc</>}
              </div>
            </div>
          ) : (
            <div className="kg-testnote">
              <span className="kg-testnote-ic">{whitelisted ? "🎟️" : "🧪"}</span>
              {whitelisted
                ? <span><strong>Whitelisted · Free Mint</strong> — <s>{testUsd} USDC</s> price waived on <strong>Arc Testnet</strong>. Verify X + Discord below to claim.</span>
                : <span>Sandbox mint on <strong>Arc Testnet</strong> · {testUsd} testnet USDC. <strong>Only mainnet mints become real NFTs</strong> — testnet punks stay on testnet.</span>}
            </div>
          )}

          {/* Base selection lives in the "Your Kawaii Punk" customizer (left),
              not here — keeps the mint side lean. */}

          <button className="kg-mint" disabled={!canMint} onClick={runMint} title={!allFollowed ? "Follow X + Discord to qualify" : !balanceOk ? "Top up USDC on Arc" : undefined}>
            {mintLabel}
            <Arrow />
          </button>

          <div className="kg-altlink">
            <span className="kg-one">🔒 One punk per wallet</span> · No NFT? <a href="https://mcp.bu.finance" target="_blank" rel="noreferrer">Trade via our AI agent</a>
          </div>
        </div>

        {/* Minting overlay */}
        {phase === "minting" && (
          <div className="kg-minting">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <div className="mint-av"><img src={baseFile ? layerSrc("base", baseFile) : A.logo} alt="" /></div>
            <h2>Minting your Kawaii Punk…</h2>
            <div className="progress"><div className="fill" style={{ width: prog * 100 + "%" }} /></div>
            <div className="status">{status || (prog < 1 ? "Confirming on Arc…" : "Done")}</div>
          </div>
        )}
      </div>
    </div>
  );
}
