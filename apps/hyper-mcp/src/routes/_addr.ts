// Shared EVM-address validation for routes that take an `:address` path param.
// A missing/malformed address must NOT return an empty-200 (a client reads that
// as a confident "no holdings"); it must be a 400 instead.

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function isEvmAddress(value: unknown): value is string {
  return typeof value === "string" && EVM_ADDRESS_RE.test(value);
}

/** Canonical 400 body for an invalid `:address` param. */
export function invalidAddressBody(value: string) {
  return {
    status: 400,
    code: "INVALID_ADDRESS" as const,
    message: `Invalid wallet address: ${JSON.stringify(value)}. Expected a 0x-prefixed 40-hex-character EVM address (e.g. 0x1234...abcd).`,
    why: "The :address path parameter was missing or did not match /^0x[a-fA-F0-9]{40}$/.",
    fix: "Pass a valid checksummed or lowercase 20-byte EVM address as the path segment.",
  };
}
