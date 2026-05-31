// Generate lib/kawaii/item-map.json from the on-disk layer catalog.
//
// The item map is the SINGLE source of truth that ties every avatar asset to
// its metadata: display name, per-item description, rarity, the MENU asset
// (the big product-shot PNG shown in the picker) and the NFT asset (the
// smaller, position-correct layer that actually composites into the minted
// Punk). Until per-item NFT variants are exported, `nft` falls back to `menu`
// and `nftReady` is false.
//
// Re-run after adding assets:  node scripts/gen-kawaii-item-map.mjs
// (reads KAWAII_LAYERS_DIR; preserves any hand-edited name/desc/nft already in
//  the committed JSON so curation is never clobbered.)

import { readdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LAYERS_DIR =
  process.env.KAWAII_LAYERS_DIR ||
  join(__dirname, "../../../../nft-kawaii/layers");
const OUT = join(__dirname, "../lib/kawaii/item-map.json");

// File-based categories (background is color swatches, handled in the UI).
const CATS = [
  "base", "eyes", "brows", "face_marks", "ears", "hair_back", "hair_front",
  "tops", "neckwear", "outerwear_details", "eyeglasses", "head_accessories",
  "jewelry", "handhelds", "companions", "special", "fx",
];

const fileLabel = (f) => {
  let b = f.replace(/\.png$/i, "").replace(/[_-]+/g, " ").trim();
  // strip a leading category-ish token ("base neutral …" → "neutral …")
  b = b.replace(/^base\s+/i, "").replace(/^(neutral)\s+/i, "");
  return b.charAt(0).toUpperCase() + b.slice(1);
};
const rarityOf = (f) =>
  /legendary/i.test(f) ? "Legendary" : /rare/i.test(f) ? "Rare" : "Common";

// Per-category description templates (the {name} default — curate in the JSON).
const DESC = {
  base: (n) => `${n} — your Punk's base skin: the body every trait stacks onto.`,
  eyes: (n) => `${n}: the eyes that set your Punk's whole mood.`,
  brows: (n) => `${n} brows — the small line that changes the entire expression.`,
  face_marks: (n) => `${n} — a face mark that gives your Punk its tell.`,
  ears: (n) => `${n} ears for a touch of character.`,
  hair_back: (n) => `${n} — the back hair layer, framing behind the head.`,
  hair_front: (n) => `${n} — the front hairstyle that crowns the face.`,
  tops: (n) => `${n}: the fit your Punk wears on-chain.`,
  neckwear: (n) => `${n} around the neck — finish the look.`,
  outerwear_details: (n) => `${n} — outerwear detailing layered over the top.`,
  eyeglasses: (n) => `${n}: eyewear with attitude.`,
  head_accessories: (n) => `${n} — headwear that tops the whole Punk off.`,
  jewelry: (n) => `${n}: the flex. Jewelry for the discerning Punk.`,
  handhelds: (n) => `${n} — something for your Punk to hold.`,
  companions: (n) => `${n}: a companion that rides along with your Punk.`,
  special: (n) => `${n} — a special, rarely-seen flourish.`,
  fx: (n) => `${n}: an aura/FX layer for maximum on-chain drama.`,
};

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { items: {} };
const prevItems = prev.items ?? {};

const items = {};
let total = 0;
for (const cat of CATS) {
  const dir = join(LAYERS_DIR, cat);
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".png"));
  for (const file of files.sort()) {
    const key = `${cat}/${file}`;
    const name = fileLabel(file);
    const gen = {
      name,
      desc: (DESC[cat] ?? ((n) => `${n}.`))(name),
      rarity: rarityOf(file),
      menu: file,
      nft: file,
      nftReady: false,
    };
    // Preserve curated overrides (anything a human edited in the JSON wins).
    const old = prevItems[key] ?? {};
    items[key] = {
      name: old.name ?? gen.name,
      desc: old.desc ?? gen.desc,
      rarity: old.rarity ?? gen.rarity,
      menu: gen.menu,
      nft: old.nft ?? gen.nft,
      nftReady: old.nftReady ?? gen.nftReady,
      // Curated mythical-creature origin (scripts/patch-kawaii-base-myths.mjs) — preserved.
      ...(old.origin ? { origin: old.origin } : {}),
      // Locale translations (scripts/patch-kawaii-i18n.mjs) — preserved.
      ...(old.i18n ? { i18n: old.i18n } : {}),
    };
    total++;
  }
}

const out = {
  version: 1,
  note: "Kawaii Punk item metadata. `menu` = picker product-shot PNG; `nft` = the position-correct layer that composites into the minted Punk (falls back to `menu` until exported). Edit name/desc/nft freely — the generator preserves them.",
  generatedItems: total,
  items,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${total} items → ${OUT}`);
