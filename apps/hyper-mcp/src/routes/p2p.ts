import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { cache } from "@hyper/cache";

// p2p venue — direct agent access to the p2p.me market-maker order book (the
// fiat-bank last mile for currencies with no on-chain stablecoin, e.g. ARS).
//
// Where /api/ramp is the consumer on/off-ramp ABSTRACTION (corridor + USDC-hub
// framing), /api/p2p is the raw VENUE: place a real order on the p2p.me book,
// track it, and publish the merchant payment address once a trader accepts.
//
// The MCP holds no keys and no float, so writes are PROXIED to the p2p
// settlement service (which holds the relayer + enforces the demo caps). The
// caller's Privy `Authorization: Bearer` is forwarded verbatim — the MCP never
// mints or inspects it. Swap P2P_SETTLEMENT_URL for any service that speaks the
// same /api/p2p/* contract.
const P2P_SETTLEMENT_URL = process.env.P2P_SETTLEMENT_URL ?? "https://api.cachin.app";

type ProxyResult = { status: number; json: Record<string, unknown> };

async function proxy(req: Request, path: string, body: unknown): Promise<ProxyResult> {
  const auth = req.headers.get("authorization");
  if (!auth) return { status: 401, json: { error: "Missing Authorization: Bearer <privy token>." } };
  try {
    const res = await fetch(`${P2P_SETTLEMENT_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  } catch (e) {
    return { status: 502, json: { error: `settlement service unreachable: ${String(e).slice(0, 140)}` } };
  }
}

const markets = route
  .get("/p2p/markets")
  .use(cache({ maxAge: 300, staleWhileRevalidate: 600 }))
  .meta({ mcp: { title: "p2p — Markets", description: "The p2p.me fiat-bank venue: currencies tradable against USDC via human market-makers (bank-transfer last mile). Use this venue when a currency has no on-chain stablecoin pool; for stablecoin corridors use FxSwap (/api/fxswap) instead. Live rates come from /api/p2p/quote." } })
  .output(z.object({ venue: z.string(), settlementUrl: z.string(), currencies: z.array(z.object({ code: z.string(), rail: z.string(), note: z.string() })) }))
  .handle(async () =>
    ok({
      venue: "p2p.me",
      settlementUrl: P2P_SETTLEMENT_URL,
      currencies: [
        { code: "ARS", rail: "Transferencias 3.0 bank transfer", note: "Argentine peso — no on-chain stablecoin; settles via market-maker bank transfer." },
      ],
    }),
  );

const quote = route
  .post("/p2p/quote")
  .body(z.object({ userId: z.string(), amount: z.string().regex(/^\d+(\.\d+)?$/).default("1"), currency: z.enum(["ARS", "USDC"]).default("USDC") }))
  .meta({ mcp: { title: "p2p — Quote", description: "Live market-maker rate from the p2p.me book (e.g. ARS-per-USDC sell price). Proxied to the settlement service; requires the caller's Privy Bearer token. Preview before post__api_p2p_order_create." } })
  .output(z.object({ ok: z.boolean().optional(), resolvedAmounts: z.record(z.any()).optional(), error: z.string().optional() }))
  .handle(async ({ req, body }) => {
    const r = await proxy(req, "/api/p2p/order-quote", body);
    return ok(r.json);
  });

const orderCreate = route
  .post("/p2p/order/create")
  .body(z.object({ currency: z.enum(["ARS"]).default("ARS"), userId: z.string(), amount: z.string().regex(/^\d+$/), paymentAddress: z.string().optional() }))
  .meta({ mcp: { title: "p2p — Create Order", description: "Place a REAL order on the p2p.me book via the settlement service (relayer funds the USDC float on Base; demo caps enforced). `amount` is the integer fiat amount; `paymentAddress` is the raw QR 3.0 / CBU string from /api/ramp/qr/parse. Returns orderId — then poll post__api_p2p_order_status." } })
  .output(z.object({ ok: z.boolean().optional(), orderId: z.string().nullable().optional(), orderStatus: z.string().optional(), placeOrderTxHash: z.string().optional(), nextAction: z.string().optional(), error: z.string().optional() }))
  .handle(async ({ req, body }) => {
    const r = await proxy(req, "/api/p2p/order-create", body);
    return ok(r.json);
  });

const orderStatus = route
  .post("/p2p/order/status")
  .body(z.object({ orderId: z.string() }))
  .meta({ mcp: { title: "p2p — Order Status", description: "Status of a p2p.me order: placed -> accepted -> paid -> completed (or cancelled). When `canSetPaymentAddress` is true, publish the merchant CBU via post__api_p2p_order_set_payment_address." } })
  .output(z.object({ ok: z.boolean().optional(), order: z.object({ orderId: z.string(), status: z.string(), canSetPaymentAddress: z.boolean().optional() }).optional(), error: z.string().optional() }))
  .handle(async ({ req, body }) => {
    const r = await proxy(req, "/api/p2p/order-status", body);
    return ok(r.json);
  });

const setPaymentAddress = route
  .post("/p2p/order/set-payment-address")
  .body(z.object({ orderId: z.string(), paymentAddress: z.string() }))
  .meta({ mcp: { title: "p2p — Set Payment Address", description: "Publish the merchant payment address (raw QR 3.0 / CBU) on an ACCEPTED order so the market-maker knows where to send the pesos. Encrypted for the merchant key server-side via setSellOrderUpi. Call only once status=accepted (canSetPaymentAddress=true)." } })
  .output(z.object({ ok: z.boolean().optional(), status: z.string().optional(), error: z.string().optional() }))
  .handle(async ({ req, body }) => {
    const r = await proxy(req, "/api/p2p/order-set-payment-address", body);
    return ok(r.json);
  });

export default new Hyper({ prefix: "/api" }).use([markets, quote, orderCreate, orderStatus, setPaymentAddress]);
