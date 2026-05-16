/**
 * Shared types for the x402 middleware + verifier abstraction.
 */

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  asset: string;
  /** USDC atomic units (6 dp), stringified. */
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  description: string;
  extra: {
    name: string;
    version: string;
    verifyingContract: string;
  };
}

export interface PaymentRequiredEnvelope {
  x402Version: 1;
  /** Multi-accept array — buyer picks one network. */
  accepts: PaymentRequirements[];
  /** Resource the buyer is paying for. */
  resource: { url: string; description: string; mimeType: string };
  error?: string;
}

export interface DecodedPaymentPayload {
  x402Version: number;
  payload: Record<string, unknown>;
  accepted?: PaymentRequirements;
  resource?: { url: string; description: string; mimeType: string };
  extensions?: Record<string, unknown>;
}

export interface PaymentReceipt {
  payer: string;
  amountUsdc: string;
  settlementTx: string;
  network: string;
  /** Provider-issued receipt id. */
  receiptId: string;
  paidAtUnixSeconds: number;
}

export interface VerifierContext {
  toolName: string;
  priceUsdc: string;
  sellerAddress: string;
}

/**
 * Pluggable verifier. Implementations: Circle Gateway batch facilitator,
 * a local mock for tests, future custom providers. The middleware never
 * imports a provider SDK directly — it only sees this interface.
 */
export interface PaymentVerifier {
  readonly name: string;
  /** Build the 402 multi-accept envelope. */
  buildAccepts(ctx: VerifierContext): Promise<PaymentRequirements[]>;
  /**
   * Verify a buyer-submitted payment. Resolves with a receipt on success
   * or throws with a human-readable reason on rejection.
   */
  verify(
    payload: DecodedPaymentPayload,
    ctx: VerifierContext,
  ): Promise<PaymentReceipt>;
}
