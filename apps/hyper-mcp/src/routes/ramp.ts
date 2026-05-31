import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { cache } from "@hyper/cache";
import { createPublicClient, http, fallback, formatUnits, parseUnits } from "viem";
import { ARC, contractAddress, tokenAddress } from "../registry/index.ts";

// Ramp layer — the consumer on/off-ramp + QR-payment surface that sits ON TOP of
// the FX rail. Two corridor types, one USDC hub:
//
//   • native-pool  — currencies with a BuFi stablecoin (EURC/MXNB/QCAD/AUDF):
//     on/off-ramp is a FxSwap USDC<->local-stable swap. LPs earn the FX spread.
//   • fiat-bank    — currencies without a stablecoin yet (e.g. ARS): on/off-ramp
//     routes USDC<->bank via an external p2p market-maker (p2p.me adapter).
//
// In both directions USDC is the hub — the thesis is that local money reaches
// global liquidity *through* the USD stable, and the spread is the only fee.
// This is a stateless quote/intent builder (like spot.ts / fxswap.ts): it prices
// the leg and returns what to sign / where to settle; it never holds custody.

const ARC_RPC = process.env.ARC_TESTNET_RPC ?? ARC.rpc;
const ARC_RPC_FALLBACK = process.env.ARC_TESTNET_RPC_FALLBACK ?? "https://rpc.testnet.arc.network";
const arcClient = createPublicClient({ transport: fallback([http(ARC_RPC), http(ARC_RPC_FALLBACK)]) });

// The external p2p market-maker settlement service (the fiat-bank last mile).
// In the playground this is the kiwipay `server/` p2p.me proxy; swap the URL for
// any RampProvider that speaks the same order contract.
const P2P_SETTLEMENT_URL = process.env.P2P_SETTLEMENT_URL ?? "https://api.cachin.app";

const USDC = tokenAddress("arc", "USDC");

// ── Provider model ──────────────────────────────────────────────────────────
// A corridor is one local currency + how it bridges to the USDC hub. Adding a
// new fiat rail (Bitso, Manteca, …) is a new `fiat-bank` entry with a settlement
// URL; adding a new stablecoin is a new `native-pool` entry with its FxSwap hook.
type NativeCorridor = {
  code: string;
  kind: "native-pool";
  asset: "EURC" | "MXNB" | "QCAD" | "AUDF";
  hook: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  dec: number;
  pyth: string;
};
type FiatCorridor = {
  code: string;
  kind: "fiat-bank";
  provider: "p2pdotme";
  settlementUrl: string;
  // ISO-4217 numeric the local QR encodes (53 tag), for QR parsing.
  iso: string;
};
type Corridor = NativeCorridor | FiatCorridor;

function nativePool(asset: NativeCorridor["asset"], pyth: string, usdcIsToken0: boolean): NativeCorridor {
  const local = tokenAddress("arc", asset);
  return {
    code: asset,
    kind: "native-pool",
    asset,
    hook: contractAddress("arc", `lpInsuranceLayer.fxSwapHooks.${asset}`),
    token0: usdcIsToken0 ? USDC : local,
    token1: usdcIsToken0 ? local : USDC,
    dec: 6, // USDC + all BuFi local stables are 6-decimal
    pyth,
  };
}

const CORRIDORS: Record<string, Corridor> = {
  // Stablecoin corridors — settle natively on Arc via FxSwap. (token0/token1
  // order mirrors fxswap.ts POOLS: QCAD has the asset as token0, the rest USDC.)
  EURC: nativePool("EURC", "EUR/USD", true),
  MXNB: nativePool("MXNB", "USD/MXN", true),
  AUDF: nativePool("AUDF", "AUD/USD", true),
  QCAD: nativePool("QCAD", "USD/CAD", false),
  // Fiat-bank corridor — no ARS stablecoin yet, so the last mile is a real bank
  // transfer via the p2p.me market-maker book. The QR carries ISO 032.
  ARS: { code: "ARS", kind: "fiat-bank", provider: "p2pdotme", settlementUrl: P2P_SETTLEMENT_URL, iso: "032" },
};

const swapHookAbi = [
  { type: "function", name: "quote", stateMutability: "view", inputs: [{ name: "amountIn", type: "uint256" }, { name: "zeroForOne", type: "bool" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "effectiveSpreadBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "tradableAssets", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const zRampSide = z.enum(["onramp", "offramp"]);
// onramp  = local money -> USDC hub (entering global liquidity)
// offramp = USDC hub -> local money (exiting to the local economy)

// ── QR 3.0 / EMVCo MPM parser (minimal) ───────────────────────────────────────
// EMV merchant-presented QR is flat TLV: [tag(2)][len(2)][value]. We pull amount
// (54), currency (53, ISO-4217 numeric), merchant name (59) + city (60). The raw
// payload is echoed back as `paymentAddress` — that's what the p2p settlement
// service consumes verbatim. NOTE: this is an MVP extractor (no CRC-16 / nested
// account-template decode); production should reuse `@p2pdotme/sdk/qr-parsers`.
const ISO_NUMERIC: Record<string, string> = {
  "032": "ARS", "986": "BRL", "484": "MXN", "124": "CAD",
  "036": "AUD", "840": "USD", "978": "EUR",
};

function parseEmvTlv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= raw.length) {
    const tag = raw.slice(i, i + 2);
    const len = Number(raw.slice(i + 2, i + 4));
    if (!Number.isFinite(len) || i + 4 + len > raw.length) break;
    out[tag] = raw.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

// ── Routes ────────────────────────────────────────────────────────────────────

const corridors = route
  .get("/ramp/corridors")
  .use(cache({ maxAge: 300, staleWhileRevalidate: 600 }))
  .meta({ mcp: { title: "Ramp — Corridors", description: "List supported on/off-ramp corridors. native-pool corridors (EURC/MXNB/QCAD/AUDF) settle via FxSwap on Arc and LPs earn the FX spread; fiat-bank corridors (ARS) settle the last mile via an external p2p market-maker. USDC is the hub for both." } })
  .output(z.object({ hub: z.string(), chainId: z.number(), corridors: z.array(z.object({ code: z.string(), kind: z.string(), settle: z.string(), pyth: z.string().optional(), provider: z.string().optional() })) }))
  .handle(async () =>
    ok({
      hub: "USDC",
      chainId: ARC.chainId,
      corridors: Object.values(CORRIDORS).map((c) =>
        c.kind === "native-pool"
          ? { code: c.code, kind: c.kind, settle: `FxSwap USDC/${c.asset} on Arc`, pyth: c.pyth }
          : { code: c.code, kind: c.kind, settle: `p2p bank transfer via ${c.settlementUrl}`, provider: c.provider },
      ),
    }),
  );

const qrParse = route
  .post("/ramp/qr/parse")
  .body(z.object({ payload: z.string().min(8) }))
  .meta({ mcp: { title: "Ramp — Parse QR", description: "Parse an EMVCo merchant-presented QR (e.g. Argentine Transferencias 3.0). Returns the merchant, encoded fiat amount + currency, and the matching ramp corridor. The raw payload is echoed as paymentAddress for the settlement service. MVP extractor — swap in @p2pdotme/sdk/qr-parsers for full CRC/account-template decode." } })
  .output(z.object({ currency: z.string().nullable(), iso: z.string().nullable(), fiat: z.string().nullable(), merchantName: z.string().nullable(), merchantCity: z.string().nullable(), corridor: z.string().nullable(), paymentAddress: z.string() }))
  .handle(async ({ body }) => {
    const tlv = parseEmvTlv(body.payload);
    const iso = tlv["53"] ?? null;
    const currency = iso ? (ISO_NUMERIC[iso] ?? null) : null;
    const corridor = currency && CORRIDORS[currency] ? currency : null;
    return ok({
      currency,
      iso,
      fiat: tlv["54"] ?? null,
      merchantName: tlv["59"] ?? null,
      merchantCity: tlv["60"] ?? null,
      corridor,
      paymentAddress: body.payload,
    });
  });

const quote = route
  .post("/ramp/quote")
  .body(z.object({ corridor: z.enum(["EURC", "MXNB", "QCAD", "AUDF", "ARS"]), side: zRampSide, amount: z.string().regex(/^\d+(\.\d+)?$/) }))
  .meta({ mcp: { title: "Ramp — Quote", description: "Quote an on/off-ramp leg. onramp = local money -> USDC; offramp = USDC -> local money. native-pool corridors return a live FxSwap quote (amountOut + spreadBps + liquidity ceiling); fiat-bank corridors return a settlement descriptor pointing at the p2p service that holds the live rate. `amount` is the input side of the leg." } })
  .output(z.object({ corridor: z.string(), kind: z.string(), side: z.string(), amountIn: z.string(), tokenIn: z.string().optional(), tokenOut: z.string().optional(), amountOut: z.string().optional(), spreadBps: z.number().nullable().optional(), tradableOut: z.string().optional(), settlement: z.object({ provider: z.string(), url: z.string(), rateEndpoint: z.string(), note: z.string() }).optional(), error: z.string().optional() }))
  .handle(async ({ body }) => {
    const c = CORRIDORS[body.corridor]!;

    if (c.kind === "fiat-bank") {
      // No on-chain pool — the live rate + order live in the p2p settlement svc.
      return ok({
        corridor: c.code,
        kind: c.kind,
        side: body.side,
        amountIn: body.amount,
        settlement: {
          provider: c.provider,
          url: c.settlementUrl,
          rateEndpoint: `${c.settlementUrl}/api/p2p/order-quote`,
          note: `${c.code} settles via bank transfer; call /ramp/order to open a settlement order through ${c.provider}.`,
        },
      });
    }

    // native-pool: price the FxSwap leg directly off the hook.
    // onramp  = local -> USDC : tokenIn = local stable
    // offramp = USDC -> local : tokenIn = USDC
    const localAddr = tokenAddress("arc", c.asset);
    const tokenIn = body.side === "onramp" ? localAddr : USDC;
    const tokenOut = body.side === "onramp" ? USDC : localAddr;
    const zeroForOne = tokenIn.toLowerCase() === c.token0.toLowerCase();

    let amountInAtomic: bigint;
    try {
      amountInAtomic = parseUnits(body.amount, c.dec);
    } catch {
      return ok({ corridor: c.code, kind: c.kind, side: body.side, amountIn: body.amount, tokenIn, tokenOut, spreadBps: null, error: "bad amount" });
    }

    try {
      const [outAtomic, spread, tradable] = await Promise.all([
        arcClient.readContract({ address: c.hook, abi: swapHookAbi, functionName: "quote", args: [amountInAtomic, zeroForOne] }) as Promise<bigint>,
        arcClient.readContract({ address: c.hook, abi: swapHookAbi, functionName: "effectiveSpreadBps" }).catch(() => null) as Promise<number | null>,
        arcClient.readContract({ address: c.hook, abi: swapHookAbi, functionName: "tradableAssets", args: [tokenOut] }).catch(() => null) as Promise<bigint | null>,
      ]);
      return ok({
        corridor: c.code,
        kind: c.kind,
        side: body.side,
        amountIn: body.amount,
        tokenIn,
        tokenOut,
        amountOut: formatUnits(outAtomic, c.dec),
        spreadBps: spread === null ? null : Number(spread),
        tradableOut: tradable === null ? undefined : formatUnits(tradable, c.dec),
      });
    } catch (e) {
      return ok({ corridor: c.code, kind: c.kind, side: body.side, amountIn: body.amount, tokenIn, tokenOut, spreadBps: null, error: `quote reverted: ${String(e).slice(0, 140)} (pool may be paused / oracle stale / no liquidity)` });
    }
  });

const order = route
  .post("/ramp/order")
  .body(z.object({ corridor: z.enum(["EURC", "MXNB", "QCAD", "AUDF", "ARS"]), side: zRampSide, amount: z.string().regex(/^\d+(\.\d+)?$/), paymentAddress: z.string().optional() }))
  .meta({ mcp: { title: "Ramp — Open Order", description: "Open a settlement order for the corridor. native-pool corridors return the FxSwap executeIntent shape to sign on Arc (see /api/fxswap/intent-shape). fiat-bank corridors return the p2p settlement route: POST the returned descriptor to the settlement service's /api/p2p/order-create with the QR paymentAddress to place the real bank-rail order." } })
  .output(z.object({ corridor: z.string(), kind: z.string(), side: z.string(), route: z.string(), execute: z.object({ via: z.string(), endpoint: z.string().optional(), router: z.string().optional(), function: z.string().optional(), body: z.record(z.any()).optional(), notes: z.array(z.string()) }) }))
  .handle(async ({ body }) => {
    const c = CORRIDORS[body.corridor]!;

    if (c.kind === "fiat-bank") {
      return ok({
        corridor: c.code,
        kind: c.kind,
        side: body.side,
        route: `${c.code} <-> USDC via ${c.provider}`,
        execute: {
          via: c.provider,
          endpoint: `${c.settlementUrl}/api/p2p/order-create`,
          body: { currency: c.code, amount: body.amount, paymentAddress: body.paymentAddress ?? null },
          notes: [
            "POST this body to `endpoint` with the user's Privy Bearer token.",
            "paymentAddress is the raw QR payload from /ramp/qr/parse (the merchant CBU/CVU).",
            "Poll the settlement service's /api/p2p/order-status; publish the address once status=accepted.",
            "Off-ramp economics: USDC float settles real fiat — keep the demo caps on (spec §10).",
          ],
        },
      });
    }

    return ok({
      corridor: c.code,
      kind: c.kind,
      side: body.side,
      route: `${body.side === "onramp" ? `${c.asset} -> USDC` : `USDC -> ${c.asset}`} via FxSwap on Arc`,
      execute: {
        via: "fxswap",
        router: contractAddress("arc", "lpInsuranceLayer.fxRouter"),
        function: "executeIntent(FxIntent intent, bytes intentSig, bytes permit, bytes permitSig) → buyAmount",
        notes: [
          "Build the FxIntent from /api/fxswap/intent-shape (sellToken/buyToken per side), EIP-712 sign as taker.",
          "For a shielded ramp use /api/ghost/swap (relayCrossCurrency) instead.",
          "LP FX spread on this leg is indexed via Envio (SpotFxExecuted.appliedSpreadBps).",
        ],
      },
    });
  });

export default new Hyper({ prefix: "/api" }).use([corridors, qrParse, quote, order]);
