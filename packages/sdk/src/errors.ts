/**
 * Typed error classes thrown by the BUFI SDK.
 *
 * All async functions in this SDK throw one of these or rethrow a viem
 * `BaseError`. Integrators can `instanceof`-narrow to handle each case.
 */

/**
 * Thrown when the BUFI REST API returns a non-2xx response.
 *
 * The `status` field is the HTTP status code, and `body` is the raw JSON
 * payload (or text) returned by the server. The `endpoint` field is the
 * `path?query` portion of the URL — useful for log scoping.
 */
export class BufiApiError extends Error {
  public readonly status: number;
  public readonly endpoint: string;
  public readonly body: unknown;
  public readonly requestId: string | undefined;

  constructor(args: {
    message: string;
    status: number;
    endpoint: string;
    body: unknown;
    requestId?: string;
  }) {
    super(args.message);
    this.name = "BufiApiError";
    this.status = args.status;
    this.endpoint = args.endpoint;
    this.body = args.body;
    this.requestId = args.requestId;
  }
}

/**
 * Thrown when wallet signing fails (user rejects, wallet disconnects, or the
 * typed-data shape is invalid).
 */
export class SignatureError extends Error {
  public readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "SignatureError";
    this.cause = cause;
  }
}

/**
 * Thrown when the on-chain oracle for a market is stale beyond the configured
 * `maxStaleSeconds`. The keeper will refuse to match orders in this state, so
 * the SDK fails fast on the client side rather than burn a signature.
 */
export class OracleStaleError extends Error {
  public readonly marketId: string;
  public readonly ageSeconds: number;
  public readonly maxStaleSeconds: number;

  constructor(args: { marketId: string; ageSeconds: number; maxStaleSeconds: number }) {
    super(
      `oracle for ${args.marketId} is stale: age=${args.ageSeconds}s, max=${args.maxStaleSeconds}s`,
    );
    this.name = "OracleStaleError";
    this.marketId = args.marketId;
    this.ageSeconds = args.ageSeconds;
    this.maxStaleSeconds = args.maxStaleSeconds;
  }
}

/**
 * Thrown when the SDK is asked to operate on a chain that has no deployed
 * contracts in `@bufi/contracts`. Typically a misconfigured `chainId` on the
 * client.
 */
export class UnsupportedChainError extends Error {
  public readonly chainId: number;

  constructor(chainId: number) {
    super(`chain ${chainId} is not supported by @bufi/sdk`);
    this.name = "UnsupportedChainError";
    this.chainId = chainId;
  }
}

/**
 * Thrown when a market symbol or id is not present in the live market
 * registry returned by the API.
 */
export class UnknownMarketError extends Error {
  public readonly marketId: string;

  constructor(marketId: string) {
    super(`unknown market: ${marketId}`);
    this.name = "UnknownMarketError";
    this.marketId = marketId;
  }
}
