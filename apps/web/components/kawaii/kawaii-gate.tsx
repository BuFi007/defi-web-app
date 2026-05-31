"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAccount, useSignMessage, useWriteContract, useReadContract } from "wagmi";
import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { arcTestnet } from "viem/chains";
import {
  KAWAII_GATE,
  KAWAII_LAYER_ORDER,
  KAWAII_TRAIT_TIERS,
} from "@/lib/kawaii/config";
import { useScopedI18n, useCurrentLocale } from "@/locales/client";
import { itemMeta, nftFileOf } from "@/lib/kawaii/item-meta";

// Category key → i18n key (labels live in the Kawaii namespace, all 6 locales).
const CAT_TKEY: Record<string, string> = {
  base: "catBase", background: "catBackground", head_accessories: "catHeadwear",
  eyeglasses: "catGlasses", eyes: "catEyes", face_marks: "catMarks", jewelry: "catJewelry",
  neckwear: "catNeck", tops: "catTops", hair_front: "catHair", hair_back: "catHairB",
  brows: "catBrows", outerwear_details: "catPatches",
};
const RARITY_TKEY: Record<string, string> = { Legendary: "rarityLegendary", Rare: "rarityRare", Common: "rarityCommon" };

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
  stickerArc: "/assets/kawaii/arc-sticker.png", // Arc anarchy sticker (no coin)
  usdcCoin: "/assets/kawaii/usdc-coin.png", // separate USDC coin, layered on top
  frame: "/assets/kawaii/frame.png",
  logoStacked: "/assets/kawaii/kawaii-punks-x-bufi-stacked.png",
  king: "/assets/kawaii/crown.png",
  spookyFx: "/assets/kawaii/spooky-fx.png", // "WE MAKE SPOOKY FOREX…" art
  stableFx: "/assets/kawaii/decentralized-stablefx.png", // "Decentralized StableFX" logo
};
// Real stablecoin token icons (shared with the trade-island token chips).
const TOKEN_ICON = { jpyc: "/assets/stable-tokens/jpyc_token_icon.png", usdc: "/assets/stable-tokens/usdc_token_icon.svg" } as const;

const layerSrc = (cat: string, file: string) => `/api/kawaii/layer?cat=${cat}&file=${encodeURIComponent(file)}`;
const fileLabel = (f: string) => {
  const b = f.replace(/\.png$/i, "").replace(/[_-]+/g, " ").trim();
  return b.charAt(0).toUpperCase() + b.slice(1);
};
const rarityOf = (f: string) => (/legendary/i.test(f) ? "Legendary" : /rare/i.test(f) ? "Rare" : "Common");

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

function KGCustomizer({ catalog, base, setBase, bg, setBg, equip, setEquip, power = 0, minted = false, split = false, liveCid = null }: {
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
  liveCid?: string | null; // minted metadata CID → "View on IPFS"
}) {
  const tRaw = useScopedI18n("Kawaii");
  const locale = useCurrentLocale();
  // Loose wrapper: next-international widens JSON values to `string`, so it can't
  // infer {placeholders} for typed params — interpolate them ourselves.
  const t = (k: string, vars?: Record<string, string | number>) => {
    let s = (tRaw as (key: string) => string)(k as never);
    if (vars) for (const [key, v] of Object.entries(vars)) s = s.split("{" + key + "}").join(String(v));
    return s;
  };
  const catLabel = (c: string) => t(CAT_TKEY[c] ?? "catBase");
  const accessoryCats = useMemo(() => KG_CAT_ORDER.filter((c) => (catalog.traits?.[c]?.length ?? 0) > 0), [catalog]);
  const cats = useMemo(() => ["base", "background", ...accessoryCats], [accessoryCats]);
  const [cat, setCat] = useState("base"); // base is the first selectable item
  const [page, setPage] = useState(0);
  // Locked items can be PREVIEWED (read description + render on the avatar) but
  // are never added to `equip` — they can't be minted on top. One preview at a time.
  const [preview, setPreview] = useState<{ cat: string; file: string } | null>(null);
  // Post-mint Save/Reset. The editor is hydrated from the LIVE on-chain
  // metadata (KawaiiGate) so what you edit is your actual Punk; the baseline
  // below is captured once that hydration lands, so `dirty` reflects real edits.
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [savedSnap, setSavedSnap] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); // signing + submitting
  const [confirming, setConfirming] = useState(false); // polling the on-chain tx
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [currentCid, setCurrentCid] = useState<string | null>(liveCid);
  useEffect(() => { setCurrentCid(liveCid); }, [liveCid]);
  useEffect(() => {
    if (minted && savedSnap == null && base) setSavedSnap(JSON.stringify({ base, bg, equip }));
  }, [minted, base, bg, equip, savedSnap]);
  const curSnap = JSON.stringify({ base, bg, equip });
  const dirty = minted && savedSnap != null && curSnap !== savedSnap;

  // Poll the async Circle setTokenURI tx until it confirms (or fails) so the
  // user sees "✓ confirmed on-chain" rather than a hanging "Updating…".
  async function pollConfirm(txId: string) {
    setConfirming(true);
    try {
      for (let i = 0; i < 24; i++) { // ~24 × 3s ≈ 72s
        await new Promise((r) => setTimeout(r, 3000));
        let st = "";
        try {
          const r = await fetch(`/api/kawaii/update/status?txId=${encodeURIComponent(txId)}`);
          const d = await r.json().catch(() => ({}));
          st = String(d?.state ?? "").toUpperCase();
        } catch { /* transient — keep polling */ }
        if (st === "CONFIRMED" || st === "COMPLETE") {
          setSavedSnap(curSnap); // baseline now matches what's on-chain
          setSaveMsg("✓ Confirmed on-chain");
          setTimeout(() => setSaveMsg(null), 4000);
          return;
        }
        if (st === "FAILED" || st === "CANCELLED" || st === "DENIED") {
          setSaveMsg("✗ On-chain update failed");
          setTimeout(() => setSaveMsg(null), 6000);
          return;
        }
      }
      setSaveMsg("Still confirming… check back shortly");
      setTimeout(() => setSaveMsg(null), 6000);
    } finally {
      setConfirming(false);
    }
  }

  async function saveLook() {
    // Push the new look on-chain: sign the update intent → /api/kawaii/update
    // re-composes the image AND rebuilds the metadata from the SAME selection,
    // then setTokenURI — image + attributes are always written together. bg is
    // display-only, so only base + equipped traits go on-chain.
    if (!address || !base) return;
    setSaving(true);
    setSaveMsg("Sign to update your Punk…");
    let txId: string | null = null;
    try {
      const deadline = Math.floor(Date.now() / 1000) + 600;
      const nonce = crypto.randomUUID();
      const message = `Kawaii Punk update\nwallet:${address}\nbase:${base}\ndeadline:${deadline}\nnonce:${nonce}`;
      const signature = await signMessageAsync({ message });
      const res = await fetch("/api/kawaii/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: address, baseId: base, layers: equip, deadline, nonce, signature }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.ipfsCid) setCurrentCid(data.ipfsCid as string);
        txId = (data.txId as string) ?? null;
        setSaveMsg("Updating on-chain…");
      } else {
        setSaveMsg(data.reason || data.error || "Update failed");
      }
    } catch (e) {
      const m = (e as Error)?.message ?? "";
      setSaveMsg(/reject|denied|cancel/i.test(m) ? "Signature cancelled" : "Update failed");
    } finally {
      setSaving(false);
    }
    if (txId) void pollConfirm(txId);
    else setTimeout(() => setSaveMsg(null), 4000);
  }
  function resetLook() {
    if (savedSnap == null) return;
    try {
      const s = JSON.parse(savedSnap) as { base?: string; bg?: string; equip?: Equip };
      if (s.base) setBase(s.base);
      setBg(typeof s.bg === "string" ? s.bg : "transparent");
      setEquip(s.equip ?? {});
    } catch { /* ignore */ }
  }
  const ipfsUrl = currentCid ? `https://${currentCid}.ipfs.dweb.link` : null;
  const bases = catalog.open;
  const unlocked = kgCatUnlocked(cat, power, minted);

  const layers = useMemo(() => {
    const sel: Equip = { ...(base ? { base } : {}), ...equip };
    if (preview) sel[preview.cat] = preview.file; // preview overlays its slot (visual only)
    return KAWAII_LAYER_ORDER.filter((c) => sel[c]).map((c) => ({ cat: c, file: sel[c] }));
  }, [base, equip, preview]);

  function onTrait(file: string) {
    if (unlocked) {
      // Real equip toggle (mintable). Clear any locked preview in this slot.
      setPreview((p) => (p && p.cat === cat ? null : p));
      const next = { ...equip };
      if (next[cat] === file) delete next[cat];
      else next[cat] = file;
      setEquip(next);
    } else {
      // Locked → preview only (read + render, NOT equipped / NOT mintable).
      setPreview((p) => (p && p.cat === cat && p.file === file ? null : { cat, file }));
    }
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
    const previewing = !unlocked && preview?.cat === cat && preview?.file === file;
    return (
      <button key={"t:" + file} className={"kg-cust-tile " + (on ? "on " : "") + (previewing ? "previewing " : "") + (unlocked ? "" : "locked")} onClick={() => onTrait(file)} title={unlocked ? fileLabel(file) : `${fileLabel(file)} — locked, tap to preview`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <span className="kg-cust-pic"><img src={layerSrc(cat, file)} alt="" loading="lazy" /></span>
        {!unlocked && !previewing && <span className="kg-cust-lock"><LockGlyph /></span>}
        {(on || previewing) && <span className="kg-cust-tick">{previewing ? <LockGlyph /> : <GateCheck />}</span>}
        <span className="kg-cust-cap">{unlocked ? fileLabel(file).split(" ").slice(0, 2).join(" ") : `${KAWAII_TRAIT_TIERS[cat]?.power ?? 0} pwr`}</span>
      </button>
    );
  }

  // Description of the active category / selected item (left of the avatar).
  // A locked item that's being previewed shows its name + a "preview only" note.
  const previewingHere = preview?.cat === cat ? preview.file : null;
  const catName = catLabel(cat);
  const catLow = catName.toLowerCase();
  const activeFile = cat === "base" ? base : cat === "background" ? null : (previewingHere || equip[cat] || null);
  // Per-item metadata from item-map.json (name + description + rarity) — the
  // map is the single source of truth; falls back to a filename-derived label.
  const activeMeta = activeFile && cat !== "background" ? itemMeta(cat, activeFile, locale) : null;
  const activeRarity = activeMeta?.rarity ?? null;
  const activeOrigin = activeMeta?.origin ?? null; // mythical-creature bases carry a country/region of origin
  const descName =
    cat === "background" ? (KG_BG.find((b) => b.css === bg)?.label ?? "None")
    : activeMeta ? activeMeta.name
    : catName;
  // The item's own description — readable for any item, locked or not.
  const descBody =
    cat === "background" ? t("bgDesc")
    : activeMeta?.desc ? activeMeta.desc
    : cat === "base" ? t("baseDesc")
    : activeFile ? t("traitDesc", { rarity: t(RARITY_TKEY[rarityOf(activeFile)]), cat: catLow })
    : t("pickPrompt", { cat: catLow });
  const descSub =
    cat === "base" ? t("fixedAlways")
    : cat === "background" ? t("freeToChange")
    : !unlocked ? t("previewOnly", { n: KAWAII_TRAIT_TIERS[cat]?.power ?? 0 })
    : equip[cat] ? t("equipped") : t("tapToAdd", { cat: catLow });

  return (
    <div className={"kg-cust" + (split ? " split" : "")}>
      {/* Stage = 2 cols: item description (left) · avatar (right) */}
      <div className="kg-cust-stage">
        <div className="kg-cust-desc">
          <span className="kg-cust-desc-cat">{catName}</span>
          <span className="kg-cust-desc-name">
            {descName}
            {activeRarity && <em className={"kg-rar " + activeRarity.toLowerCase()}>{activeRarity}</em>}
          </span>
          {activeOrigin && (
            <span className="kg-cust-origin" title={`Folk origin: ${activeOrigin.country}${activeOrigin.region ? " · " + activeOrigin.region : ""}`}>
              <span className="kg-flag">{activeOrigin.flag}</span>
              <span className="kg-origin-place">{activeOrigin.country}</span>
              {activeOrigin.scope !== "country" && activeOrigin.region && (
                <em className="kg-origin-region">{activeOrigin.region}</em>
              )}
            </span>
          )}
          <span className="kg-cust-desc-body">{descBody}</span>
          <span className="kg-cust-desc-sub">{descSub}</span>
        </div>
        {/* bg lives ON the avatar square (same size as the base PNG) — a layer
            behind the transparent base, not the whole stage. */}
        <div className={"kg-cust-av" + (preview ? " previewing" : "")} style={{ background: bg || "transparent" }}>
          {layers.map((l) => (
            // Avatar composites the NFT variant (position-correct layer that goes
            // into the minted Punk), not the big menu product-shot.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={l.cat} src={layerSrc(l.cat, nftFileOf(l.cat, l.file))} alt="" />
          ))}
          {preview && (
            <span className="kg-av-lock"><LockGlyph /> {t("lockedPreview")}</span>
          )}
        </div>
        {/* Post-mint: view the live NFT on IPFS + Save/Reset to update the look */}
        {minted && (
          <div className="kg-cust-actions">
            {saveMsg && <span className="kg-act-msg">{saveMsg}</span>}
            {ipfsUrl && (
              <a className="kg-act view" href={ipfsUrl} target="_blank" rel="noreferrer">View live ↗</a>
            )}
            <button className="kg-act reset" onClick={resetLook} disabled={!dirty || saving || confirming}>Reset</button>
            <button className="kg-act save" onClick={saveLook} disabled={!dirty || saving || confirming}>{saving ? "Saving…" : confirming ? "Confirming…" : "Save"}</button>
          </div>
        )}
      </div>
      <div className="kg-cust-panel">
        <div className="kg-cust-head">
          <span className="kg-cust-title">{cat === "base" ? t("chooseYourBase") : catName}</span>
          <span className="kg-cust-hint">{pageCount > 1 ? `${pageClamped + 1} / ${pageCount}` : minted ? t("unlockMore") : t("mintToUnlock")}</span>
        </div>
        <div className="kg-cust-cats">
          {cats.map((c) => {
            const ok = kgCatUnlocked(c, power, minted);
            return (
              <button key={c} className={(cat === c ? "active " : "") + (ok ? "" : "locked")} onClick={() => pick(c)}>
                {catLabel(c)}{!ok && " 🔒"}
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
export function KawaiiGate({ catalog, onMinted, onSkip, embedded = true, alreadyMinted = false, liveCid = null, mintedBaseId = null }: {
  catalog: Catalog;
  onMinted?: () => void;
  onSkip?: () => void;
  embedded?: boolean;
  alreadyMinted?: boolean; // wallet already holds a Punk → open straight to the customizer
  liveCid?: string | null; // minted metadata CID → "View on IPFS" deep link + trait hydration
  mintedBaseId?: string | null; // the minted base → seed the editor with the real Punk
}) {
  const tRaw = useScopedI18n("Kawaii");
  const t = (k: string, vars?: Record<string, string | number>) => {
    let s = (tRaw as (key: string) => string)(k as never);
    if (vars) for (const [key, v] of Object.entries(vars)) s = s.split("{" + key + "}").join(String(v));
    return s;
  };
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();

  const [net, setNet] = useState<"mainnet" | "testnet">("mainnet"); // mainnet = default preview
  const [payWith, setPayWith] = useState<"jpyc" | "usdc">("jpyc");
  const [leftView, setLeftView] = useState<"poster" | "punk">("punk"); // customizer (base selection) is central
  const [base, setBase] = useState<string | null>(alreadyMinted ? mintedBaseId : null);
  const [bg, setBg] = useState<string>("transparent"); // avatar background (none by default; swatch adds color behind the transparent PNG)
  const [equip, setEquip] = useState<Equip>({});
  const [phase, setPhase] = useState<"gate" | "minting">("gate");
  const [prog, setProg] = useState(0);
  const [minted, setMinted] = useState(alreadyMinted);
  const [status, setStatus] = useState("");
  const [whitelisted, setWhitelisted] = useState(false); // waives payment → Free Mint
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // hasNft may resolve after mount → flip to the customizer when it does.
  useEffect(() => { if (alreadyMinted) setMinted(true); }, [alreadyMinted]);
  // Hydrate the editor from the LIVE on-chain metadata so you edit your ACTUAL
  // Punk (image + attributes are paired there). Seed base from mintedBaseId
  // instantly, then fetch the metadata CID to restore equipped traits.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!alreadyMinted) return;
    if (mintedBaseId) setBase((b) => b ?? mintedBaseId);
    if (hydratedRef.current || !liveCid) return;
    hydratedRef.current = true;
    fetch(`https://${liveCid}.ipfs.dweb.link`)
      .then((r) => r.json())
      .then((m: { attributes?: Array<{ trait_type?: string; value?: string }> }) => {
        const attrs = m?.attributes ?? [];
        const next: Equip = {};
        for (const a of attrs) {
          if (!a?.trait_type || !a?.value || a.trait_type === "Base") continue;
          next[a.trait_type] = /\.png$/i.test(a.value) ? a.value : `${a.value}.png`;
        }
        if (Object.keys(next).length) setEquip(next);
        const baseAttr = attrs.find((a) => a?.trait_type === "Base")?.value;
        if (baseAttr) setBase(baseAttr);
      })
      .catch(() => {});
  }, [alreadyMinted, mintedBaseId, liveCid]);

  // ── Gate-wide parallax ────────────────────────────────────────────────────
  // Spring-lerp the pointer position into --kg-px / --kg-py CSS vars on the
  // whole card (common ancestor of both panels), so EVERY image — poster, corner
  // art, and the right-panel crown logo — drifts as one parallax field by its own
  // --kg-depth. rAF-driven (no CSS transition) so it stays smooth. Gated to
  // fine-pointer + no-reduced-motion. Transform/opacity only.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, running = false;
    const tick = () => {
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      card.style.setProperty("--kg-px", cx.toFixed(3));
      card.style.setProperty("--kg-py", cy.toFixed(3));
      const settled = Math.abs(tx - cx) < 0.001 && Math.abs(ty - cy) < 0.001;
      if (settled && tx === 0 && ty === 0) { running = false; return; }
      raf = requestAnimationFrame(tick);
    };
    const start = () => { if (!running) { running = true; raf = requestAnimationFrame(tick); } };
    const onMove = (e: PointerEvent) => {
      const r = card.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 2;  // -1..1
      ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
      start();
    };
    const onLeave = () => { tx = 0; ty = 0; start(); };
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", onLeave);
    return () => {
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf);
      card.style.removeProperty("--kg-px");
      card.style.removeProperty("--kg-py");
    };
  }, []);

  const bases = catalog.open; // show ALL bases (scrollable grid)
  const baseFile = base ?? bases[0] ?? null;

  const isMainnet = net === "mainnet";
  const testUsd = Number(KAWAII_GATE.testnet.priceUsdc) / 1e6; // 10
  const mintLabel = whitelisted
    ? t("freeMint")
    : isMainnet
      ? payWith === "jpyc" ? t("mintJpyc") : t("mintArc")
      : t("mintTestnet", { n: testUsd });

  // Whitelist status (free mint) — on mount + when the tab regains focus.
  useEffect(() => {
    if (!address) return;
    let alive = true;
    const check = () => {
      fetch(`/api/kawaii/status?wallet=${address}`)
        .then((r) => r.json())
        .then((d) => { if (alive) setWhitelisted(!!d.whitelisted); })
        .catch(() => {});
    };
    check();
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; window.removeEventListener("focus", onFocus); };
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

  const needed = whitelisted ? 0 : isMainnet ? (payWith === "jpyc" ? 3.5 : 5) : testUsd;
  const balanceOk = whitelisted || usdcOnArc == null ? true : usdcOnArc >= needed;
  // No social gate — just connect, pick a base, and mint (whitelist = free, else pay).
  const canMint = isConnected && balanceOk && !!baseFile && phase === "gate";

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
      setTimeout(() => { setMinted(true); setLeftView("punk"); setPhase("gate"); onMinted?.(); }, 450);
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
          <div className="kg-solo-body">
            <KGCustomizer catalog={catalog} base={baseFile} setBase={setBase} bg={bg} setBg={setBg} equip={equip} setEquip={setEquip} power={0} minted liveCid={liveCid} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={"kg-root" + (embedded ? " embedded" : "")}>
      <div className="kg-card" ref={cardRef}>
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
            <button className={leftView === "poster" ? "active" : ""} onClick={() => setLeftView("poster")}>{t("poster")}</button>
            <button className={leftView === "punk" ? "active" : ""} onClick={() => setLeftView("punk")} title={t("yourPunk")}>{t("yourPunk")}</button>
          </div>
          <div className="kg-poster-stage">
            <div className="kg-poster-glow" />
            {leftView === "poster" ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="kg-kawaii-logo" src={A.logo} alt="Kawaii Punks" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="kg-poster-img" src={A.poster} alt="NFT is not dead" />
                {/* Four balanced corner decorations: wrapper owns parallax +
                    resting rotation (JS-driven via --kg-px/py), inner <img> owns
                    the entrance + hover (CSS transition). --kg-rot/--kg-depth per
                    corner. */}
                <span className="kg-deco kg-deco-fx" style={{ "--kg-rot": "-6deg", "--kg-depth": 8, "--kg-deco-delay": "50ms" } as CSSProperties}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={A.spookyFx} alt="We make spooky forex — decentralized and on-chain" />
                </span>
                <span className="kg-deco kg-sticker-drop" style={{ "--kg-rot": "6deg", "--kg-depth": 11, "--kg-deco-delay": "100ms" } as CSSProperties}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={A.stickerDrop} alt="Punk Drop" />
                </span>
                {/* Arc sticker + USDC coin as two separate layered assets */}
                <span className="kg-deco kg-arc-group" style={{ "--kg-rot": "-8deg", "--kg-depth": 11, "--kg-deco-delay": "150ms" } as CSSProperties}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="kg-sticker-arc" src={A.stickerArc} alt="Arc" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="kg-sticker-usdc" src={A.usdcCoin} alt="USDC" />
                </span>
                <span className="kg-deco kg-deco-stablefx" style={{ "--kg-rot": "4deg", "--kg-depth": 8, "--kg-deco-delay": "200ms" } as CSSProperties}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={A.stableFx} alt="Decentralized StableFX" />
                </span>
              </>
            ) : (
              <KGCustomizer catalog={catalog} base={baseFile} setBase={setBase} bg={bg} setBg={setBg} equip={equip} setEquip={setEquip} power={0} minted={false} />
            )}
          </div>
          {leftView === "poster" && <div className="kg-tagline">{t("tagline")} <span className="own">{t("taglineOwn")}</span> ♥ <span className="own">{t("sloganAccent")}</span></div>}
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

          <h2 className="kg-slogan">{t("sloganMain")} <span className="scratch">{t("sloganAccent")}</span></h2>

          {isMainnet ? (
            <div className={"kg-pay" + (whitelisted ? " free" : "")}>
              <div className="kg-pay-head">
                <span className="kg-label">{t("payWith")}</span>
                <span className="kg-pay-hint">{whitelisted ? t("whitelistedFreeMint") : t("save30")}</span>
              </div>
              <div className="kg-pay-opts">
                <button className={"kg-pay-opt jpyc " + (payWith === "jpyc" ? "active" : "")} onClick={() => setPayWith("jpyc")}>
                  {!whitelisted && <span className="kg-pay-ribbon">{t("best")}</span>}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <span className="pay-row"><img className="pay-ic-img" src={TOKEN_ICON.jpyc} alt="JPYC" width={26} height={26} /><span className="pay-meta"><span className="pay-name">JPYC</span><span className="pay-sub">{t("onAvalanche")}</span></span></span>
                  <span className="pay-price-row"><span className={"pay-yen" + (whitelisted ? " scratch" : "")}>¥525</span>{whitelisted ? <span className="pay-free">¥0</span> : <span className="pay-usd">≈ $3.50</span>}<span className={"pay-save" + (whitelisted ? " free" : "")}>{whitelisted ? t("free") : t("thirtyOff")}</span></span>
                </button>
                <button className={"kg-pay-opt usdc " + (payWith === "usdc" ? "active" : "")} onClick={() => setPayWith("usdc")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <span className="pay-row"><img className="pay-ic-img" src={TOKEN_ICON.usdc} alt="USDC" width={26} height={26} /><span className="pay-meta"><span className="pay-name">USDC</span><span className="pay-sub">{t("onArc")}</span></span></span>
                  <span className="pay-price-row"><span className={"pay-yen" + (whitelisted ? " scratch" : "")}>$5</span>{whitelisted ? <span className="pay-free">$0</span> : <span className="pay-usd">≈ ¥750</span>}<span className={"pay-save" + (whitelisted ? " free" : " plain")}>{whitelisted ? t("free") : t("listPrice")}</span></span>
                </button>
              </div>
              <div className="kg-bal">
                <span className="kg-bal-dot" />
                {whitelisted
                  ? t("whitelistedNote", { amount: "$0" })
                  : <>{t("balance")} <strong>{usdcOnArc == null ? "…" : usdcOnArc.toFixed(2)} USDC</strong> {t("onArc")}</>}
              </div>
            </div>
          ) : (
            <div className="kg-testnote">
              <span className="kg-testnote-ic">{whitelisted ? "🎟️" : "🧪"}</span>
              {whitelisted
                ? <span>{t("testnoteWl")}</span>
                : <span>{t("testnote", { n: testUsd })}</span>}
            </div>
          )}

          {/* Base selection lives in the "Your Kawaii Punk" customizer (left),
              not here — keeps the mint side lean. */}

          <button className="kg-mint" disabled={!canMint} onClick={runMint} title={!balanceOk ? "Top up USDC on Arc" : undefined}>
            {mintLabel}
            <Arrow />
          </button>

          <div className="kg-altlink">
            <span className="kg-one">🔒 {t("onePunkPerWallet")}</span> · {t("noNft")} <a href="https://mcp.bu.finance" target="_blank" rel="noreferrer">{t("tradeViaAgent")}</a>
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
