import sharp from "sharp";
import { readFileSync } from "node:fs";
import { LAYER_ORDER, resolveLayerPath, type LayerCategory } from "./layers";

/**
 * Avatar selection: a required `base` filename + optional one filename per
 * other category. Every filename is validated against the on-disk catalog
 * (resolveLayerPath) — unknown/traversal filenames are dropped, never composed.
 */
export interface AvatarSelection {
  base: string; // base layer filename, e.g. "base_neutral_ghost_blue.png"
  layers?: Partial<Record<LayerCategory, string>>;
}

const CANVAS = 1254;

/**
 * Composite the selected layers (bottom → top per LAYER_ORDER) into a single
 * PNG buffer. Server-side only. Throws if the base is missing/invalid.
 */
export async function composeAvatar(sel: AvatarSelection): Promise<Buffer> {
  const basePath = resolveLayerPath("base", sel.base);
  if (!basePath) throw new Error(`invalid base: ${sel.base}`);

  const overlays: sharp.OverlayOptions[] = [];
  for (const cat of LAYER_ORDER) {
    if (cat === "base") continue;
    const chosen = sel.layers?.[cat];
    if (!chosen) continue;
    const p = resolveLayerPath(cat, chosen);
    if (!p) continue; // silently skip unknown — never composite unvalidated input
    overlays.push({ input: readFileSync(p), top: 0, left: 0 });
  }

  // Base is the bottom-most visible layer (after an optional background, which
  // if selected is composited first by being earlier in LAYER_ORDER → prepend).
  const bgPath = sel.layers?.background ? resolveLayerPath("background", sel.layers.background) : null;
  const bottom = bgPath ? readFileSync(bgPath) : readFileSync(basePath);
  const ordered = bgPath ? [{ input: readFileSync(basePath), top: 0, left: 0 }, ...overlays] : overlays;

  return sharp(bottom).resize(CANVAS, CANVAS).composite(ordered).png().toBuffer();
}

/** Deterministic content key for a selection (for idempotency / dedup). */
export function selectionKey(sel: AvatarSelection): string {
  const parts = [`base:${sel.base}`];
  for (const cat of LAYER_ORDER) {
    if (cat === "base") continue;
    const v = sel.layers?.[cat];
    if (v) parts.push(`${cat}:${v}`);
  }
  return parts.join("|");
}
