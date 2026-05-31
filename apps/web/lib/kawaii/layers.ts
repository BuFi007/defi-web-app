import { readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { KAWAII_LAYER_ORDER } from "./config";

/**
 * Kawaii avatar layer catalog + z-order. Assets live in KAWAII_LAYERS_DIR
 * (1254x1254 PNGs, one folder per category). 151MB raw → not committed;
 * local dev points at the nft-kawaii repo, prod points at hosted assets.
 * `base` is the user-chosen avatar base; the rest are optional traits.
 */
export const LAYERS_DIR =
  process.env.KAWAII_LAYERS_DIR || join(process.cwd(), "../../../nft-kawaii/layers");

/** Bottom → top compositing order (canonical list in config.ts, node-free). */
export const LAYER_ORDER = KAWAII_LAYER_ORDER;

export type LayerCategory = (typeof LAYER_ORDER)[number];

/** List the available PNG filenames per category from the assets dir (allowlist source). */
export function listLayerCatalog(): Record<string, string[]> {
  const catalog: Record<string, string[]> = {};
  for (const cat of LAYER_ORDER) {
    const dir = join(LAYERS_DIR, cat);
    catalog[cat] = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".png"))
      : [];
  }
  return catalog;
}

/** Subfolder (per category) holding the position-correct "NFT" trait variants
 *  that composite onto the avatar / minted image. The category root holds the
 *  big product-shot ("menu") images shown in the picker. */
export const POSITIONED_SUBDIR = "positioned";
export type LayerVariant = "menu" | "nft";

/**
 * Resolve a (category, filename) to an absolute path IFF it exists in the
 * catalog — guards against path traversal (filenames are user-influenced).
 * Returns null if the file isn't a real catalog entry.
 *
 * `variant`:
 *   - "menu" (default): the product-shot in `<dir>/<cat>/<file>` (picker).
 *   - "nft": the positioned layer in `<dir>/<cat>/positioned/<file>` that goes
 *     onto the avatar / minted image. Falls back to the menu image when no
 *     positioned variant exists yet. Bases are full-body — always the menu image.
 */
export function resolveLayerPath(category: string, filename: string, variant: LayerVariant = "menu"): string | null {
  if (!LAYER_ORDER.includes(category as LayerCategory)) return null;
  // strip any path components — only a bare filename is ever valid
  const safe = basename(filename);
  if (safe !== filename || !safe.toLowerCase().endsWith(".png")) return null;
  const dir = join(LAYERS_DIR, category);
  if (variant === "nft" && category !== "base") {
    const positioned = join(dir, POSITIONED_SUBDIR, safe);
    if (existsSync(positioned)) return positioned;
    // no positioned variant yet → fall through to the product-shot image
  }
  const full = join(dir, safe);
  if (!existsSync(full)) return null;
  return full;
}

/** Base files are the choosable avatar bases (skin/body). */
export function listBases(): string[] {
  return listLayerCatalog().base ?? [];
}
