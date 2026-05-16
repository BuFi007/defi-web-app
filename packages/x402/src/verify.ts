/**
 * Built-in verifiers.
 *
 * `mockVerifier` accepts any payload that includes a `mockReceipt` flag —
 * used for tests and dev.
 *
 * `circleGatewayVerifier` is a thin wrapper around the Circle Gateway
 * batch facilitator. It is lazy-imported so the dep can be added later
 * by the app that actually needs it, without forcing every consumer of
 * @bufi/x402 to install the SDK.
 */

import type {
  DecodedPaymentPayload,
  PaymentRequirements,
  PaymentVerifier,
  VerifierContext,
} from "./types";

export const mockVerifier: PaymentVerifier = {
  name: "mock",
  async buildAccepts(ctx) {
    return [
      {
        scheme: "exact",
        network: "mock-testnet",
        asset: "0x0000000000000000000000000000000000000000",
        amount: usdcMicro(ctx.priceUsdc),
        payTo: ctx.sellerAddress,
        maxTimeoutSeconds: 604_800,
        description: `bufi tool: ${ctx.toolName}`,
        extra: {
          name: "mock",
          version: "1",
          verifyingContract: "0x0000000000000000000000000000000000000000",
        },
      },
    ];
  },
  async verify(payload, ctx) {
    if (!payload.payload?.mockReceipt) {
      throw new Error("mockVerifier: payload.mockReceipt missing");
    }
    return {
      payer: String(payload.payload.payer ?? "0xMOCK"),
      amountUsdc: usdcMicro(ctx.priceUsdc),
      settlementTx: "0xmock",
      network: "mock-testnet",
      receiptId: `mock_${Date.now()}`,
      paidAtUnixSeconds: Math.floor(Date.now() / 1000),
    };
  },
};

/**
 * Lazy Circle Gateway verifier. The actual SDK
 * (@circle-fin/x402-batching/server) is imported on first `verify()` /
 * `buildAccepts()` call so consumers that pick another verifier don't
 * need to install it.
 *
 * Discovery + facilitator pattern is the one used by sendero's
 * `apps/edge/src/lib/x402-middleware.ts` — adapted here as a verifier
 * implementation.
 */
export function createCircleGatewayVerifier(opts: {
  facilitatorUrl: string;
}): PaymentVerifier {
  let _facilitator: unknown | null = null;
  let _discovery: PaymentRequirements[] | null = null;

  async function loadFacilitator() {
    if (_facilitator) return _facilitator;
    const mod = await import(
      "@circle-fin/x402-batching/server" as string
    ).catch((e) => {
      throw new Error(
        `@bufi/x402: install @circle-fin/x402-batching to use the Circle Gateway verifier (${(e as Error).message})`,
      );
    });
    const Ctor = (mod as { BatchFacilitatorClient: new (a: { url: string }) => unknown })
      .BatchFacilitatorClient;
    _facilitator = new Ctor({ url: opts.facilitatorUrl });
    return _facilitator;
  }

  async function discover(): Promise<
    Array<{
      network: string;
      extra: {
        name: string;
        version: string;
        verifyingContract: string;
        minValiditySeconds: number;
        assets: Array<{ address: string; symbol: string }>;
      };
    }>
  > {
    const url = new URL("/v1/x402/supported", opts.facilitatorUrl).toString();
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`x402 discovery failed: ${res.status}`);
    }
    const json = (await res.json()) as { kinds: unknown };
    return (json.kinds as ReturnType<typeof discover> extends Promise<infer T> ? T : never) ?? [];
  }

  return {
    name: "circle-gateway",
    async buildAccepts(ctx: VerifierContext) {
      if (!_discovery) {
        const kinds = await discover();
        _discovery = kinds.map((k) => {
          const usdc =
            k.extra.assets.find((a) => a.symbol === "USDC") ?? k.extra.assets[0];
          return {
            scheme: "exact" as const,
            network: k.network,
            asset: usdc.address,
            amount: usdcMicro(ctx.priceUsdc),
            payTo: ctx.sellerAddress,
            maxTimeoutSeconds: Math.max(k.extra.minValiditySeconds + 100, 604_900),
            description: `bufi tool: ${ctx.toolName}`,
            extra: {
              name: k.extra.name,
              version: k.extra.version,
              verifyingContract: k.extra.verifyingContract,
            },
          };
        });
      }
      return _discovery;
    },
    async verify(payload: DecodedPaymentPayload, ctx: VerifierContext) {
      const facilitator = (await loadFacilitator()) as {
        settle: (
          payload: DecodedPaymentPayload,
        ) => Promise<{
          receipt: { payer: string; settlementTx: string; network: string; receiptId: string };
        }>;
      };
      const result = await facilitator.settle(payload);
      return {
        payer: result.receipt.payer,
        amountUsdc: usdcMicro(ctx.priceUsdc),
        settlementTx: result.receipt.settlementTx,
        network: result.receipt.network,
        receiptId: result.receipt.receiptId,
        paidAtUnixSeconds: Math.floor(Date.now() / 1000),
      };
    },
  };
}

/** Convert a decimal USDC string ("0.0050") to atomic micro-USDC ("5000"). */
export function usdcMicro(usdc: string): string {
  const [whole, frac = ""] = usdc.split(".");
  const padded = (frac + "000000").slice(0, 6);
  const micro = BigInt(whole) * 1_000_000n + BigInt(padded || "0");
  return micro.toString();
}
