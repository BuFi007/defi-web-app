/**
 * Circle Gateway proxy route.
 *
 * Wraps Circle Gateway's POST /v1/balances endpoint behind a GET so the
 * apps/web browser never has to hold a `CIRCLE_GATEWAY_API_KEY` (the only
 * sensitive piece of this integration). The request body is fully
 * server-derived — given a wallet address, we fan it out across every
 * Gateway-supported domain that maps to a hub or spoke chain we care
 * about, then re-shape the response into a chainId-keyed map the
 * apps/web hook can render directly.
 *
 *   GET /gateway/balance/:address[?env=testnet|mainnet]
 *
 *   →  {
 *        token: "USDC",
 *        total: "12.345670",                 // decimal string, 6 dp
 *        perDomain: { "1": "5.0", ... },     // raw upstream shape
 *        perChain:  { "43113": "5.0", ... }, // domain → chainId mapped
 *        env: "testnet"
 *      }
 *
 * Auth: optional. If `CIRCLE_GATEWAY_API_KEY` is set, we forward it as
 * `Authorization: Bearer <key>`. Public Gateway endpoints work without
 * it today, but we keep the indirection so the browser never sees the
 * key once Circle starts requiring it.
 *
 * Errors are mapped to the shared `{ error: string }` shape used by
 * sibling routes; upstream Gateway non-2xx responses surface as a 502
 * with the upstream status echoed in the body for debugging.
 */

import { Hono } from "hono";

// Domain ↔ chainId mapping, testnet leg. Pulled from the Circle
// `use-gateway` skill (references/SKILL.md → "Domain IDs (Testnet)").
// We intentionally only enumerate the chains the apps/web SPOKE_CHAINS
// table cares about (Avalanche Fuji, Arc Testnet, Ethereum Sepolia,
// Arbitrum Sepolia). Expanding the proxy to additional Gateway domains
// is a one-line addition.
const TESTNET_DOMAIN_BY_CHAIN_ID: Record<number, number> = {
  11155111: 0,  // Ethereum Sepolia
  43113: 1,     // Avalanche Fuji
  11155420: 2,  // OP Sepolia
  421614: 3,    // Arbitrum Sepolia
  84532: 6,     // Base Sepolia
  80002: 7,     // Polygon Amoy
  1301: 10,     // Unichain Sepolia
  4801: 14,     // World Chain Sepolia
  5042002: 26,  // Arc Testnet
};

// Mainnet leg is wired but unused by the current apps/web popover (we
// only render testnet hubs). Kept so the same proxy can serve mainnet
// once the rest of the stack is ready.
const MAINNET_DOMAIN_BY_CHAIN_ID: Record<number, number> = {
  1: 0,       // Ethereum
  43114: 1,   // Avalanche
  10: 2,      // OP
  42161: 3,   // Arbitrum
  8453: 6,    // Base
  137: 7,     // Polygon PoS
  130: 10,    // Unichain
  146: 13,    // Sonic
  480: 14,    // World Chain
  1329: 16,   // Sei
};

const GATEWAY_TESTNET_URL = "https://gateway-api-testnet.circle.com";
const GATEWAY_MAINNET_URL = "https://gateway-api.circle.com";

type GatewayEnv = "testnet" | "mainnet";

interface UpstreamBalanceEntry {
  domain: number;
  depositor: string;
  balance: string;
}
interface UpstreamBalancesResponse {
  token: string;
  balances: UpstreamBalanceEntry[];
}

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

function selectMapping(env: GatewayEnv): Record<number, number> {
  return env === "mainnet" ? MAINNET_DOMAIN_BY_CHAIN_ID : TESTNET_DOMAIN_BY_CHAIN_ID;
}

function selectUpstream(env: GatewayEnv): string {
  // Allow override via env var (matches the apps/web NEXT_PUBLIC override
  // pattern) so staging environments can point at a mock or fixture.
  const override = process.env.CIRCLE_GATEWAY_API_URL?.replace(/\/$/, "");
  if (override) return override;
  return env === "mainnet" ? GATEWAY_MAINNET_URL : GATEWAY_TESTNET_URL;
}

const gatewayRoutes = new Hono();

gatewayRoutes.get("/balance/:address", async (c) => {
  const address = c.req.param("address");
  if (!address || !ADDRESS_REGEX.test(address)) {
    return c.json({ error: "invalid address" }, 400);
  }

  const envParam = (c.req.query("env") ?? "testnet").toLowerCase();
  if (envParam !== "testnet" && envParam !== "mainnet") {
    return c.json({ error: "env must be 'testnet' or 'mainnet'" }, 400);
  }
  const env: GatewayEnv = envParam;

  const domainByChainId = selectMapping(env);
  const sources = Object.values(domainByChainId).map((domain) => ({
    domain,
    depositor: address,
  }));

  const upstreamUrl = `${selectUpstream(env)}/v1/balances`;
  const apiKey = process.env.CIRCLE_GATEWAY_API_KEY?.trim();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ token: "USDC", sources }),
      // Bound the wait — Gateway responses are typically sub-second; if
      // the API stalls we fail fast and let the UI render a graceful
      // empty state instead of pinning a request handler.
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? "upstream fetch failed";
    return c.json({ error: `gateway upstream unreachable: ${msg}` }, 502);
  }

  if (!upstream.ok) {
    // Surface upstream status so the apps/web hook can distinguish
    // "Gateway is down" from "key is missing" / "address malformed".
    let detail: unknown = null;
    try {
      detail = await upstream.json();
    } catch {
      detail = await upstream.text().catch(() => null);
    }
    return c.json(
      { error: `gateway upstream ${upstream.status}`, detail },
      502,
    );
  }

  let payload: UpstreamBalancesResponse;
  try {
    payload = (await upstream.json()) as UpstreamBalancesResponse;
  } catch (err) {
    return c.json({ error: `gateway upstream malformed: ${(err as Error).message}` }, 502);
  }

  // Re-key by chainId. The hook + popover think in chain ids, not
  // Circle domain numbers — keep the translation here so the UI never
  // imports the domain table.
  const chainIdByDomain = new Map<number, number>();
  for (const [chainIdStr, domain] of Object.entries(domainByChainId)) {
    chainIdByDomain.set(domain, Number(chainIdStr));
  }

  const perDomain: Record<string, string> = {};
  const perChain: Record<string, string> = {};
  let totalMicros = 0n;

  for (const entry of payload.balances ?? []) {
    perDomain[String(entry.domain)] = entry.balance;
    const chainId = chainIdByDomain.get(entry.domain);
    if (chainId !== undefined) {
      perChain[String(chainId)] = entry.balance;
    }
    // Sum in micro-USDC (6 dp) so we never compound float error across
    // domains. `entry.balance` is "<int>.<frac>" decimal-string.
    totalMicros += toMicros(entry.balance);
  }

  return c.json({
    token: payload.token ?? "USDC",
    total: fromMicros(totalMicros),
    perDomain,
    perChain,
    env,
  });
});

/** "12.345670" → 12345670n (6 decimals). Defensive against malformed
 *  upstream values: bad shapes contribute 0n rather than throwing the
 *  whole proxy response. */
function toMicros(decimal: string): bigint {
  if (typeof decimal !== "string") return 0n;
  const [whole, frac = ""] = decimal.split(".");
  if (!whole && !frac) return 0n;
  const wholeBig = whole && /^\d+$/.test(whole) ? BigInt(whole) : 0n;
  // Pad/truncate fractional part to 6 dp.
  const frac6 = (frac + "000000").slice(0, 6);
  if (!/^\d{0,6}$/.test(frac6)) return wholeBig * 1_000_000n;
  return wholeBig * 1_000_000n + BigInt(frac6);
}

/** Inverse of `toMicros`. Always emits 6 decimal places to stay
 *  byte-for-byte compatible with upstream responses. */
function fromMicros(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export { gatewayRoutes };
