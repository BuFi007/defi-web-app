/**
 * The two BUFI lending/trading hubs (Avalanche Fuji + Arc Testnet) and
 * everything needed to talk about them in the UI: chain id, short label,
 * long label, accent colour, on-disk icon path.
 *
 * This module is the SINGLE SOURCE OF TRUTH for hub metadata. Before
 * this file existed, the same facts lived in five places:
 *   apps/web/components/trade-island/loan.tsx
 *     - LOAN_HUBS               (full HubChain-shape records)
 *     - HUB_NAME_BY_CHAIN_ID    (chainId -> "arc" | "fuji")
 *     - HUB_CHAIN_IDS           ({ arc: 5042002, fuji: 43113 })
 *   apps/web/components/trade-island/market-picker.tsx
 *     - hubLabel(chainId)       (chainId -> "Arc" | "Fuji" | "chain <id>")
 *   apps/web/lib/perps/hooks.ts
 *     - PERPS_HUB_CHAIN_IDS     ([5042002, 43113] as const)
 *
 * Adding a third hub now means appending one entry to HUBS below; every
 * surface picks it up automatically.
 *
 * Lending-specific overlay (FxMarketRegistry contract address per hub)
 * still lives in trade-island/loan.tsx — that's application metadata,
 * not platform metadata, and doesn't belong in @bufi/location.
 */

export type HubKey = "arc" | "fuji";

export type HubChainId = 5042002 | 43113;

export interface HubChain {
  /** Short slug used as a map key and in routing ("arc", "fuji"). */
  key: HubKey;
  /** EVM chain id. Narrow union so callers stay type-safe. */
  chainId: HubChainId;
  /** Long-form name shown in tooltips and section headers. */
  name: string;
  /** Filter-pill / breadcrumb label ("Arc", "Fuji"). */
  short: string;
  /** Brand accent colour for badges. Hex string. */
  color: string;
  /** Public-path SVG/PNG icon shipped under apps/web/public/networks. */
  iconUrl: string;
  /** Legacy text-glyph fallback when the icon doesn't load. */
  glyph: string;
}

export const HUBS: Record<HubKey, HubChain> = {
  arc: {
    key: "arc",
    chainId: 5042002,
    name: "Arc Hub",
    short: "Arc",
    color: "#1a1340",
    iconUrl: "/networks/arc.svg",
    glyph: "◆",
  },
  fuji: {
    key: "fuji",
    chainId: 43113,
    name: "Fuji Hub",
    short: "Fuji",
    color: "#e84142",
    iconUrl: "/networks/avax.svg",
    glyph: "▲",
  },
};

/**
 * Stable-order list of HubChain records, useful for `.map` over every hub
 * (matches the wagmi/connectkit hub ordering).
 */
export const HUB_LIST: readonly HubChain[] = [HUBS.arc, HUBS.fuji];

/** Just the chain ids. Equivalent to the old PERPS_HUB_CHAIN_IDS. */
export const HUB_CHAIN_IDS = HUB_LIST.map((h) => h.chainId) as readonly HubChainId[];

/**
 * chainId -> HubChain | null. Returns null for non-hub chains so callers
 * can fall back to "spoke" treatment without a separate guard.
 */
export function hubByChainId(chainId: number): HubChain | null {
  for (const hub of HUB_LIST) {
    if (hub.chainId === chainId) return hub;
  }
  return null;
}

/**
 * chainId -> short pill label. Returns "chain <id>" for unknown ids so a
 * new hub doesn't render an empty chip while the team wires it up.
 */
export function hubLabel(chainId: number): string {
  return hubByChainId(chainId)?.short ?? `chain ${chainId}`;
}

/**
 * Inverse lookup: HubKey -> chainId. Type-safe alternative to the
 * legacy `HUB_CHAIN_IDS = { arc: 5042002, fuji: 43113 }` object.
 */
export function chainIdByHubKey(key: HubKey): HubChainId {
  return HUBS[key].chainId;
}

/**
 * chainId -> HubKey | null. Replaces HUB_NAME_BY_CHAIN_ID.
 */
export function hubKeyByChainId(chainId: number): HubKey | null {
  return hubByChainId(chainId)?.key ?? null;
}

/**
 * Type guard for narrowing arbitrary numbers down to a HubChainId.
 * Convenient when reading chain ids out of untyped sources (cookies,
 * URL params, third-party SDKs).
 */
export function isHubChainId(chainId: number): chainId is HubChainId {
  return HUB_CHAIN_IDS.includes(chainId as HubChainId);
}
