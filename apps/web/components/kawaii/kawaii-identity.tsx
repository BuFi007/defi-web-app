"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { KAWAII_TRAIT_TIERS, KAWAII_LAYER_ORDER } from "@/lib/kawaii/config";
import { KawaiiGate, type Catalog } from "@/components/kawaii/kawaii-gate";
import type { KawaiiMint } from "@/lib/kawaii/use-kawaii-beta";

/**
 * Kawaii Punks — IDENTITY TAB (the NFT token gate AND the avatar studio).
 *
 * Ported from the Claude Code "Bufi Trade Island" design (light-violet editorial
 * register), wired to OUR real backend rather than the design's mock data:
 *   - avatars compose real assets via /api/kawaii/layer?cat=&file=
 *   - bases + traits come from /api/kawaii/catalog (the real asset dir)
 *   - the wardrobe is power-gated by /api/kawaii/power against KAWAII_TRAIT_TIERS
 *   - minting runs the real sign → /api/kawaii/mint → USDC-on-Arc → resubmit flow
 *   - socials verify (free) through Guild.xyz via /api/kawaii/social/status
 *   - an agentic Punk carries an ERC-8004 badge (status.agentId) → AGENT stamp
 *
 * Two lives in one surface: pre-mint it renders the pink campaign GATE
 * (components/kawaii/kawaii-gate.tsx); post-mint it's the profile + Studio
 * customizer that unlocks traits as the wallet earns 力 (power) by trading.
 */

// ── helpers ───────────────────────────────────────────────────────────────
const layerSrc = (cat: string, file: string) => `/api/kawaii/layer?cat=${cat}&file=${encodeURIComponent(file)}`;

/** Pretty label from a raw asset filename (e.g. "twin_buns_black_purple.png" → "Twin buns black purple"). */
function fileLabel(file: string) {
  const base = file.replace(/\.png$/i, "").replace(/[_-]+/g, " ").trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** A category is unlocked once the wallet's earned power clears its tier threshold. */
const catUnlocked = (cat: string, power: number) => power >= (KAWAII_TRAIT_TIERS[cat]?.power ?? 0);

const equipKey = (addr?: string) => `bufi-kawaii-equip-${(addr ?? "anon").toLowerCase()}`;

/** Persisted equip is a map {category: filename}. Stored locally per wallet. */
type Equip = Record<string, string>;

function loadEquip(addr?: string): Equip {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(equipKey(addr)) || "{}");
  } catch {
    return {};
  }
}
function saveEquip(addr: string | undefined, e: Equip) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(equipKey(addr), JSON.stringify(e));
  } catch {
    /* quota — non-fatal */
  }
}

// ── icons (line register, ported from kp-shared/kawaii.jsx) ─────────────────
function KPIcon({ name, size = 14 }: { name: string; size?: number }) {
  const p = { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "check") return <svg {...p}><path d="M3 8.5l3 3 7-7" /></svg>;
  if (name === "plus") return <svg {...p}><path d="M8 3v10M3 8h10" /></svg>;
  if (name === "x") return <svg {...p}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
  if (name === "lock") return <svg {...p}><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5 7V5a3 3 0 016 0v2" /></svg>;
  if (name === "wallet") return <svg {...p}><rect x="2" y="4" width="12" height="9" rx="1.5" /><path d="M11 8.5h2" /></svg>;
  if (name === "copy") return <svg {...p}><rect x="4" y="4" width="8" height="9" rx="1" /><path d="M2 11V3a1 1 0 011-1h7" /></svg>;
  return <svg {...p}><circle cx="8" cy="8" r="3" /></svg>;
}

const CAT_LABELS: Record<string, string> = {
  head_accessories: "Headwear", hair_front: "Hair / front", hair_back: "Hair / back",
  eyeglasses: "Glasses", eyes: "Eyes", brows: "Brows", face_marks: "Face marks",
  jewelry: "Jewelry", neckwear: "Neckwear", tops: "Tops", outerwear_details: "Patches",
  ears: "Ears", handhelds: "Handhelds", companions: "Companions", special: "Special", fx: "FX",
};

// ── composed avatar — stacks base + equipped traits in canonical z-order ─────
function KPAv({ base, equip, agent = false, stamp = null, className = "" }: {
  base: string | null;
  equip: Equip;
  agent?: boolean;
  stamp?: string | null;
  className?: string;
}) {
  const layers = useMemo(() => {
    const sel: Equip = { ...(base ? { base } : {}), ...equip };
    return KAWAII_LAYER_ORDER.filter((c) => sel[c]).map((c) => ({ cat: c, file: sel[c] }));
  }, [base, equip]);

  return (
    <div className={"kp-av " + className}>
      {layers.map((l) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={l.cat} src={layerSrc(l.cat, l.file)} alt="" />
      ))}
      {stamp && <div className="corner-stamp">{stamp}</div>}
      {agent && <div className="corner-agent">AGENT</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// KawaiiIdentity — the identity-tab entry point (drop-in for KawaiiGate)
// ════════════════════════════════════════════════════════════════════════════
export function KawaiiIdentity({ catalog, hasNft, mint, refresh }: { catalog: Catalog; hasNft: boolean | null; mint: KawaiiMint | null; refresh?: () => void }) {
  const { address } = useAccount();
  const [power, setPower] = useState(0);
  const [showStudio, setShowStudio] = useState(false);
  const [equip, setEquip] = useState<Equip>({});
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/kawaii/power?wallet=${address}`).then((r) => r.json()).then((d) => setPower(Number(d.power) || 0)).catch(() => {});
    setEquip(loadEquip(address));
  }, [address]);

  if (!mounted) return null;

  // Pre-mint: the pink "NFT is NOT DEAD" gate (ported gate.jsx), embedded in the
  // Identity tab. On mint → onMinted re-checks status → hasNft flips → tabs unlock
  // and this tab re-renders to the profile below. (null fails OPEN to the gate too.)
  if (!hasNft) {
    return (
      <div className="identity-tab" style={{ position: "relative", height: "100%", minHeight: 460, flex: 1, padding: 0, margin: 0, maxWidth: "none", gap: 0, overflow: "hidden" }}>
        <KawaiiGate catalog={catalog} embedded onMinted={() => refresh?.()} />
      </div>
    );
  }

  // ── post-mint profile ──────────────────────────────────────────────────────
  const base = mint?.baseId && !mint.baseId.includes("/") ? mint.baseId : catalog.open[0] ?? null;
  const isAgent = !!mint?.agentId;
  const tierLabel = mint?.tier === "mainnet" || mint?.tier === "both" ? "Mainnet" : "Testnet";
  const benefitsLive = mint?.tier === "mainnet" || mint?.tier === "both"; // testnet Punks accrue no perks

  // Real unlock ladder: how many cosmetic categories the current power has opened.
  const cats = Object.keys(KAWAII_TRAIT_TIERS);
  const unlockedCount = cats.filter((c) => catUnlocked(c, power)).length;
  const nextCat = cats.map((c) => ({ c, p: KAWAII_TRAIT_TIERS[c].power })).filter((x) => x.p > power).sort((a, b) => a.p - b.p)[0];
  const equippedCount = Object.keys(equip).length;

  return (
    <div className="identity-tab">
      {/* Hero — avatar + name + actions */}
      <div className="kp-id-hero">
        <KPAv base={base} equip={equip} agent={isAgent} stamp={mint?.tokenId ? `#${mint.tokenId}` : null} />
        <div className="kp-id-meta">
          <div>
            <div className="kp-id-eyebrow">My identity · {isAgent ? "ERC-8004 agent · Arc" : "Kawaii Punk · Arc"}</div>
            <h1 className="kp-id-name">{address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "your punk"}</h1>
            <div className="kp-id-sub">
              {tierLabel} · {power.toLocaleString()} 力 power · {unlockedCount}/{cats.length} families unlocked
            </div>
          </div>
          <div className="kp-id-actions">
            <button className="kp-btn primary" onClick={() => setShowStudio(true)}>Customize</button>
            <button className="kp-btn" onClick={() => address && navigator.clipboard?.writeText(address)}>Copy</button>
          </div>
        </div>
      </div>

      {/* 5-cell stat strip — all REAL (no fabricated PnL/Sharpe) */}
      <div className="kp-stat-strip">
        <div className="kp-stat">
          <span className="k">Power · 力</span>
          <span className="v">{power.toLocaleString()}</span>
          <span className="vsub">earned by trading</span>
        </div>
        <div className="kp-stat">
          <span className="k">Wardrobe</span>
          <span className="v">{unlockedCount}<small style={{ fontWeight: 700, fontSize: 14, color: "var(--ink-3)" }}>/{cats.length}</small></span>
          <span className="vsub">families unlocked</span>
        </div>
        <div className="kp-stat">
          <span className="k">Wearing</span>
          <span className="v">{equippedCount}<small style={{ fontWeight: 700, fontSize: 14, color: "var(--ink-3)" }}>/11</small></span>
          <span className="vsub">slots equipped</span>
        </div>
        <div className="kp-stat">
          <span className="k">Token</span>
          <span className="v" style={{ fontSize: 18 }}>{mint?.tokenId ? `#${mint.tokenId}` : "—"}</span>
          <span className="vsub">ERC-1155</span>
        </div>
        <div className="kp-stat">
          <span className="k">Type</span>
          <span className="v" style={{ fontSize: 18 }}>{isAgent ? "AI agent" : "Human"}</span>
          <span className="vsub">{isAgent ? "ERC-8004 badge" : "self-custody"}</span>
        </div>
      </div>

      {/* Wearing — 11 slot grid */}
      <div className="kp-sec">
        <div className="kp-sec-head">
          <span className="nm">Wearing</span>
          <span className="sub">{equippedCount} of 11 slots</span>
          <button className="action" onClick={() => setShowStudio(true)}>Open Studio →</button>
        </div>
        <SlotGrid equip={equip} onClick={() => setShowStudio(true)} />
      </div>

      {/* Power ladder — the REAL unlock progression */}
      <div className="kp-sec">
        <div className="kp-sec-head">
          <span className="nm">Trait unlocks</span>
          <span className="sub">
            {nextCat ? `${(nextCat.p - power).toLocaleString()} 力 to ${CAT_LABELS[nextCat.c] ?? nextCat.c}` : "all families unlocked"}
          </span>
        </div>
        <div className="kp-dims-list">
          {cats.slice(0, 6).map((c) => {
            const tier = KAWAII_TRAIT_TIERS[c];
            const ok = catUnlocked(c, power);
            return (
              <DimRow
                key={c}
                label={CAT_LABELS[c] ?? c}
                value={Math.min(1, tier.power ? power / tier.power : 1)}
                v={`${tier.power} 力`}
                tier={ok ? "✓" : "🔒"}
                muted={!ok}
              />
            );
          })}
        </div>
      </div>

      {/* Membership perks — honest: testnet accrues none */}
      <div className="kp-sec">
        <div className="kp-sec-head">
          <span className="nm">Membership</span>
          <span className="sub">{benefitsLive ? "perks active" : "testnet — perks accrue on mainnet only"}</span>
        </div>
        <div className="kp-onchain">
          <div className="cell"><span className="k">Fee rebate</span><span className="v">{benefitsLive ? "−7 bps" : "—"}</span></div>
          <div className="cell"><span className="k">Leaderboard</span><span className="v">{benefitsLive ? "eligible" : "play-only"}</span></div>
          <div className="cell"><span className="k">Copy-trade</span><span className="v">{benefitsLive ? "enabled" : "soon"}</span></div>
          <div className="cell"><span className="k">Upgrade minter</span><span className="v">{benefitsLive ? "yes" : "no"}</span></div>
        </div>
      </div>

      {showStudio && (
        <StudioOverlay
          catalog={catalog}
          base={base}
          power={power}
          equip={equip}
          onSave={(e) => { setEquip(e); saveEquip(address, e); }}
          onClose={() => setShowStudio(false)}
        />
      )}
    </div>
  );
}

// ── Slot grid (the "wearing" 11-slot strip) ─────────────────────────────────
const SLOT_ORDER = ["head_accessories", "hair_front", "eyeglasses", "jewelry", "neckwear", "outerwear_details", "tops", "face_marks", "eyes", "brows", "hair_back"];
function SlotGrid({ equip, onClick }: { equip: Equip; onClick: () => void }) {
  return (
    <div className="kp-slots">
      {SLOT_ORDER.map((cat) => {
        const file = equip[cat];
        return (
          <div key={cat} className={"kp-slot " + (file ? "filled" : "empty")} title={file ? fileLabel(file) : `Add ${CAT_LABELS[cat] ?? cat}`} onClick={onClick}>
            {file ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={layerSrc(cat, file)} alt="" />
                <span className="slot-tag">{CAT_LABELS[cat] ?? cat}</span>
              </>
            ) : (
              <KPIcon name="plus" size={12} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function DimRow({ label, value, v, tier, muted }: { label: string; value: number; v: string; tier: string; muted?: boolean }) {
  return (
    <div className={"kp-dim " + (muted ? "muted" : "")}>
      <div className="lab">{label}</div>
      <div className="bar">
        <div className="fill" style={{ width: value * 100 + "%" }} />
        {[0.2, 0.4, 0.6, 0.8].map((p) => <div key={p} className="pip" style={{ left: p * 100 + "%" }} />)}
      </div>
      <div className="v">{v}</div>
      <div className="tier">{tier}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STUDIO OVERLAY — Sims-style 3-column customizer (real catalog, power-gated)
// ════════════════════════════════════════════════════════════════════════════
function StudioOverlay({ catalog, base, power, equip, onSave, onClose }: {
  catalog: Catalog;
  base: string | null;
  power: number;
  equip: Equip;
  onSave: (e: Equip) => void;
  onClose: () => void;
}) {
  // Only categories that actually have assets, in cheapest-power-first order.
  const cats = useMemo(
    () => Object.keys(KAWAII_TRAIT_TIERS).filter((c) => (catalog.traits?.[c]?.length ?? 0) > 0),
    [catalog],
  );
  const [cat, setCat] = useState(cats[0] ?? "eyes");
  const [working, setWorking] = useState<Equip>({ ...equip });
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function flash(msg: string, dur = 1400) { setToast(msg); setTimeout(() => setToast(null), dur); }

  const files = catalog.traits?.[cat] ?? [];
  const unlocked = catUnlocked(cat, power);
  const equippedFile = working[cat];

  function toggle(file: string) {
    if (!unlocked) { flash(`Unlocks at ${KAWAII_TRAIT_TIERS[cat]?.power} 力`); return; }
    setWorking((w) => {
      const next = { ...w };
      if (next[cat] === file) delete next[cat];
      else next[cat] = file;
      return next;
    });
    setDirty(true);
    flash(working[cat] === file ? "Removed" : "Equipped");
  }
  function clearCat() { if (!equippedFile) return; setWorking((w) => { const n = { ...w }; delete n[cat]; return n; }); setDirty(true); flash("Removed"); }
  function clearAll() { setWorking({}); setDirty(true); flash("Cleared all"); }
  function reset() { setWorking({ ...equip }); setDirty(false); flash("Reverted"); }
  function save() { onSave(working); setDirty(false); flash("Saved", 1600); setTimeout(onClose, 500); }

  const totalCats = Object.keys(KAWAII_TRAIT_TIERS).length;
  const unlockedCount = Object.keys(KAWAII_TRAIT_TIERS).filter((c) => catUnlocked(c, power)).length;

  return (
    <div className="kp-overlay">
      <div className="kp-studio">
        <div className="kp-studio-head">
          <span className="title">Studio</span>
          <span className="sub">{Object.keys(working).length}/11 equipped · {unlockedCount}/{totalCats} families unlocked</span>
          <div className="actions">
            {dirty && <span className="kp-id-eyebrow" style={{ color: "var(--rose-ink)" }}>Unsaved</span>}
            <button className="kp-btn ghost sm" onClick={reset} disabled={!dirty} style={{ opacity: dirty ? 1 : 0.4 }}>Reset</button>
            <button className="kp-btn primary sm" onClick={save} disabled={!dirty} style={{ opacity: dirty ? 1 : 0.4 }}>Save</button>
            <button className="kp-btn icon-only sm" onClick={onClose} aria-label="Close studio"><KPIcon name="x" /></button>
          </div>
        </div>

        <div className="kp-studio-body">
          {/* Left rail */}
          <div className="kp-rail">
            {cats.map((c) => {
              const ok = catUnlocked(c, power);
              return (
                <button key={c} className={"kp-rail-item " + (cat === c ? "active" : "")} onClick={() => setCat(c)}>
                  <span className="kp-rail-icon">{ok ? (KAWAII_TRAIT_TIERS[c]?.emoji ?? "•") : "🔒"}</span>
                  <span className="label">{CAT_LABELS[c] ?? c}</span>
                  <span className="ct">{catalog.traits?.[c]?.length ?? 0}</span>
                  {working[c] && <span className="dot-eq" />}
                </button>
              );
            })}
            <div className="kp-rail-sep" />
            <button className="kp-rail-item" onClick={clearAll}>
              <span className="kp-rail-icon"><KPIcon name="x" size={14} /></span>
              <span className="label">Clear all</span>
            </button>
          </div>

          {/* Center stage */}
          <div className="kp-stage">
            <div className="kp-stage-tools">
              <button className="kp-btn ghost sm" onClick={clearAll}>Clear</button>
            </div>
            <div className="kp-stage-av">
              <KPAv base={base} equip={working} />
            </div>
            <div className="kp-stage-info">
              <div className="item"><span className="k">Layers</span><span className="v">{Object.keys(working).length} / 11</span></div>
              <div className="item"><span className="k">Power</span><span className="v">{power.toLocaleString()} 力</span></div>
              <div className="item"><span className="k">Unlocked</span><span className="v">{unlockedCount} / {totalCats}</span></div>
            </div>
          </div>

          {/* Right panel */}
          <div className="kp-panel">
            <div className="kp-panel-head">
              <div className="cat-name">{CAT_LABELS[cat] ?? cat}</div>
              <div className="cat-meta">
                {unlocked ? `${files.length} available` : `🔒 unlocks at ${KAWAII_TRAIT_TIERS[cat]?.power} 力`}
              </div>
              {equippedFile ? (
                <div className="eq-strip">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <div className="thumb"><img src={layerSrc(cat, equippedFile)} alt="" /></div>
                  <div className="text">Wearing · {fileLabel(equippedFile)}</div>
                  <button className="remove" onClick={clearCat}>Remove</button>
                </div>
              ) : (
                <div className="eq-strip empty">
                  <div className="thumb"><KPIcon name="plus" size={12} /></div>
                  <div className="text">Empty</div>
                </div>
              )}
            </div>
            <div className="kp-panel-scroll">
              <div className="kp-trait-grid">
                {files.map((file) => {
                  const isEq = working[cat] === file;
                  const cls = ["kp-tile", !unlocked ? "locked" : "", isEq ? "equipped" : ""].join(" ");
                  return (
                    <button key={file} className={cls} onClick={() => toggle(file)} title={fileLabel(file)}>
                      <div className="pic">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={layerSrc(cat, file)} alt={fileLabel(file)} loading="lazy" />
                        {!unlocked && <div className="lock-overlay"><KPIcon name="lock" /></div>}
                        {isEq && <div className="check-overlay"><KPIcon name="check" size={11} /></div>}
                      </div>
                      <div className="meta">
                        <div className="nm">{fileLabel(file)}</div>
                        <div className="ft">{unlocked ? CAT_LABELS[cat] ?? cat : <>Unlocks · <span className="pri">{KAWAII_TRAIT_TIERS[cat]?.power} 力</span></>}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {toast && <div className="kp-toast">{toast}</div>}
      </div>
    </div>
  );
}
