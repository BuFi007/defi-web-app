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
      // Privacy: ghost/shielded-pool requests carry depositor/recipient/amount,
      // which are correlatable (see PRIVACY_HARDENING_SPEC.md #7). sendDefaultPii
      // is on, so scrub request data for any ghost-related event before it leaves
      // the process — Sentry must never become an off-chain deanonymization sink.
      const tool = event.tags?.["mcp.tool"];
      const url = event.request?.url ?? "";
      const isGhost =
        (typeof tool === "string" && tool.includes("ghost")) || url.includes("/ghost");
      if (isGhost && event.request) {
        delete event.request.data;
        delete event.request.query_string;
        delete event.request.cookies;
        if (event.request.headers) delete event.request.headers;
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

  // Privacy: ghost/shielded-pool tool calls must NOT carry the caller wallet on
  // the span/exception — "wallet X used ghost mode at time T" is itself an
  // off-chain correlation point (PRIVACY_HARDENING_SPEC.md #7). beforeSend
  // already scrubs the request body; this scrubs the span attribute + tags so
  // Sentry holds zero ghost-linkable identity.
  const isGhost = toolName.includes("ghost");
  const wallet = isGhost ? "redacted-ghost" : (walletAddress ?? "anonymous");

  return Sentry.startSpan(
    {
      name: `mcp.tool/${toolName}`,
      op: "mcp.call",
      attributes: {
        "mcp.tool": toolName,
        "mcp.wallet": wallet,
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
            "mcp.wallet": wallet,
          },
          contexts: {
            mcp: {
              tool: toolName,
              wallet: isGhost ? null : walletAddress,
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
