import * as Sentry from "@sentry/bun";

const dsn = process.env.SENTRY_DSN_MCP
  ?? process.env.SENTRY_DSN
  ?? "https://cfdb5b78d1835fd93387971194ca0790@o4507693954301952.ingest.de.sentry.io/4511451532820560";

export function initSentry() {
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE ?? "bufi-hyper-mcp@0.1.0",

    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,

    enableLogs: true,
    sendDefaultPii: true,
    beforeSend(event) {
      if (event.tags) {
        event.fingerprint = [
          event.tags["mcp.tool"] as string ?? "unknown",
          event.exception?.values?.[0]?.type ?? "Error",
        ].filter(Boolean);
      }
      return event;
    },
  });
}

export function instrumentMcpCall(
  toolName: string,
  walletAddress: string | null,
  fn: () => Promise<Response>,
): Promise<Response> {
  if (!dsn) return fn();

  return Sentry.startSpan(
    {
      name: `mcp.tool/${toolName}`,
      op: "mcp.call",
      attributes: {
        "mcp.tool": toolName,
        "mcp.wallet": walletAddress ?? "anonymous",
        "mcp.protocol": "json-rpc-2.0",
      },
    },
    async (span) => {
      try {
        const response = await fn();
        span.setStatus({ code: 1, message: "ok" });
        return response;
      } catch (error) {
        span.setStatus({ code: 2, message: "error" });
        Sentry.captureException(error, {
          tags: {
            "mcp.tool": toolName,
            "mcp.wallet": walletAddress ?? "anonymous",
          },
          contexts: {
            mcp: {
              tool: toolName,
              wallet: walletAddress,
              protocol: "json-rpc-2.0",
            },
          },
        });
        throw error;
      }
    },
  );
}

export function captureTradeError(
  error: unknown,
  context: {
    tool: string;
    symbol?: string;
    side?: string;
    sizeUsdc?: string;
    leverage?: number;
    wallet?: string;
  },
) {
  if (!dsn) return;

  Sentry.captureException(error, {
    level: "error",
    tags: {
      "mcp.tool": context.tool,
      "trade.symbol": context.symbol ?? "unknown",
      "trade.side": context.side ?? "unknown",
      "trade.wallet": context.wallet ?? "unknown",
    },
    contexts: {
      trade: {
        symbol: context.symbol,
        side: context.side,
        sizeUsdc: context.sizeUsdc,
        leverage: context.leverage,
        wallet: context.wallet,
      },
    },
    fingerprint: ["trade-failure", context.tool, context.symbol ?? "unknown"],
  });
}

export function capturePaymentError(
  error: unknown,
  context: { tool: string; wallet?: string; priceUsdc?: string },
) {
  if (!dsn) return;

  Sentry.captureException(error, {
    level: "warning",
    tags: {
      "mcp.tool": context.tool,
      "x402.wallet": context.wallet ?? "unknown",
    },
    contexts: {
      x402: {
        tool: context.tool,
        wallet: context.wallet,
        priceUsdc: context.priceUsdc,
      },
    },
    fingerprint: ["x402-payment-failure", context.tool],
  });
}

export { Sentry };
