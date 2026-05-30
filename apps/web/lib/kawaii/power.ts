/**
 * Kawaii "power" = a wallet's trading footprint, read live from the Envio
 * HyperIndex (services/envio-yield). Power gates the trait wardrobe
 * (KAWAII_TRAIT_TIERS) and is the single number Galxe / the leaderboard would
 * also read — so it lives here, server-side, never invented by the client.
 *
 * Sources (all per-trader, already indexed — no new on-chain hook needed):
 *   - Perp notional  : PositionChange (|sizeDeltaE18| × entryPriceE18)
 *   - Spot notional  : SpotSwap.quoteAmount (USDC quote)
 *   - Bento boost    : ArcadePlacement.chips (the on-chain mini-game)
 *
 * Power is intentionally simple to start (USD notional + bento). The vision's
 * anti-wash (fee floor, per-epoch cap, distinct counterparties) layers on top
 * later — tune POWER_WEIGHTS without touching callers.
 */

// Local Envio dev Hasura by default; override for hosted/prod. The hosted dev
// indexer (indexer.dev.hyperindex.xyz/6ff8fed/v1/graphql) is the public fallback.
const ENVIO_URL =
  process.env.KAWAII_ENVIO_GRAPHQL_URL ||
  process.env.ENVIO_GRAPHQL_URL ||
  process.env.ENVIO_URL ||
  "http://localhost:8080/v1/graphql";

// Local Hasura ships with admin secret "testing"; harmless to send to public endpoints.
const ENVIO_ADMIN_SECRET = process.env.ENVIO_ADMIN_SECRET ?? "testing";

const ARC_CHAIN_ID = 5042002; // kawaii testnet tier trades on Arc Testnet
const USDC_DECIMALS = 6; // SpotSwap quote (USDC) units
const PAGE = 1000;

/** Power weights — one-line tunable. power = perpUSD·w + spotUSD·w + chips·w. */
export const POWER_WEIGHTS = {
  perpUsdPerPower: 1, // 1 power per $1 of perp notional
  spotUsdPerPower: 1, // 1 power per $1 of spot notional
  bentoChipPower: 5, // 5 power per Bento chip placed
} as const;

const POWER_QUERY = `query KawaiiPower($trader: String!, $chainId: Int!, $limit: Int!) {
  PositionChange(where: {trader: {_eq: $trader}, chainId: {_eq: $chainId}}, limit: $limit) {
    sizeDeltaE18
    entryPriceE18
  }
  SpotSwap(where: {sender: {_eq: $trader}, chainId: {_eq: $chainId}}, limit: $limit) {
    quoteAmount
  }
  ArcadePlacement(where: {player: {_eq: $trader}, chainId: {_eq: $chainId}}, limit: $limit) {
    chips
  }
}`;

type PowerResult = { power: number; perpUsd: number; spotUsd: number; bentoChips: number; source: "envio" | "unavailable" };

function absBig(s: string): bigint {
  const b = BigInt(s);
  return b < 0n ? -b : b;
}

/** Compute a wallet's power from the Envio indexer. Fails SAFE → power 0 (never
 *  throws), so a downed indexer just leaves the wardrobe locked, never errors the gate. */
export async function computePower(address: string): Promise<PowerResult> {
  const trader = address.toLowerCase();
  const empty: PowerResult = { power: 0, perpUsd: 0, spotUsd: 0, bentoChips: 0, source: "unavailable" };
  try {
    const res = await fetch(ENVIO_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hasura-admin-secret": ENVIO_ADMIN_SECRET },
      body: JSON.stringify({ query: POWER_QUERY, variables: { trader, chainId: ARC_CHAIN_ID, limit: PAGE } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return empty;
    const json = (await res.json()) as {
      data?: {
        PositionChange?: Array<{ sizeDeltaE18: string; entryPriceE18: string }>;
        SpotSwap?: Array<{ quoteAmount: string }>;
        ArcadePlacement?: Array<{ chips: number }>;
      };
      errors?: unknown;
    };
    if (!json.data || json.errors) return empty;

    let perpUsd = 0;
    for (const t of json.data.PositionChange ?? []) {
      // |size|/1e18 (base units) × price/1e18 = USD notional
      perpUsd += (Number(absBig(t.sizeDeltaE18)) / 1e18) * (Number(BigInt(t.entryPriceE18)) / 1e18);
    }
    let spotUsd = 0;
    for (const s of json.data.SpotSwap ?? []) {
      spotUsd += Number(BigInt(s.quoteAmount)) / 10 ** USDC_DECIMALS;
    }
    let bentoChips = 0;
    for (const p of json.data.ArcadePlacement ?? []) bentoChips += Number(p.chips ?? 0);

    const power = Math.floor(
      perpUsd * POWER_WEIGHTS.perpUsdPerPower +
        spotUsd * POWER_WEIGHTS.spotUsdPerPower +
        bentoChips * POWER_WEIGHTS.bentoChipPower,
    );
    return { power: Math.max(0, power), perpUsd, spotUsd, bentoChips, source: "envio" };
  } catch {
    return empty; // network/timeout/parse → fail safe
  }
}
