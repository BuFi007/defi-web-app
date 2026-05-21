/**
 * CCTP V2 onramp — contract addresses, chain IDs, and ABIs.
 *
 * Lifts the constants from `scripts/cctp-onramp.ts` (the reference CLI
 * implementation) into a single browser-importable module so the
 * onramp hook + sheet can stay symmetric with what the keeper script
 * does. If the script ever rotates an address, this file rotates too —
 * single source of truth on the web side.
 *
 * NOTE on Permit2 vs ERC-20 approve: CCTP V2's TokenMessengerV2 reads
 * the burnToken via the standard ERC-20 allowance — `safeTransferFrom`
 * under the hood. There is NO Permit2 path on the burn side. The
 * task brief's "Approve Permit2" wording is a misnomer; we use the
 * plain `approve(spender, amount)` ERC-20 path, identical to the
 * script (`cctp-onramp.ts:418-427`).
 */

import { parseAbi, type Address } from "viem";

// ── Chain IDs ─────────────────────────────────────────────────────────────
export const FUJI_CHAIN_ID = 43113 as const;
export const ARC_CHAIN_ID = 5042002 as const;

// ── CCTP V2 domains ───────────────────────────────────────────────────────
export const FUJI_CCTP_DOMAIN = 1 as const;
export const ARC_CCTP_DOMAIN = 26 as const;

// ── Token addresses (USDC ERC-20) ─────────────────────────────────────────
export const FUJI_USDC: Address =
  "0x5425890298aed601595a70AB815c96711a31Bc65";
// Arc's USDC precompile — has split ledgers (native gas vs ERC-20). CCTP
// mints credit the ERC-20 ledger; FxMarginAccount reads the ERC-20 ledger.
export const ARC_USDC: Address =
  "0x3600000000000000000000000000000000000000";

// ── CCTP V2 contracts ─────────────────────────────────────────────────────
// Sourced from packages/contracts/deployments/telarana-{avalanche-fuji,arc-testnet}.json
export const FUJI_TOKEN_MESSENGER_V2: Address =
  "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
export const ARC_MESSAGE_TRANSMITTER_V2: Address =
  "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";

// ── CCTP V2 tuning ────────────────────────────────────────────────────────
// FAST finality (~30s on Fuji) — matches FxSpoke.sol constants in
// the keeper script. STANDARD (=2000) would wait for hard finality
// (~13 min on AVAX); FAST is the right default for an interactive UX.
export const FINALITY_FAST = 1000 as const;

// Iris API (Circle's attestation service) — sandbox/testnet endpoint.
export const IRIS_SANDBOX_BASE =
  "https://iris-api-sandbox.circle.com" as const;

// Default per-call maxFee in raw USDC (0.0005 USDC). Circle quotes
// ~0.0001 for fast lanes; 500 is a safe headroom that almost never
// blocks attestation. Surfaced in the UI as a tooltip line, not a
// slider — the user shouldn't have to tune this.
export const DEFAULT_MAX_FEE_RAW = 500n;

// Default attestation polling cadence/timeout. The script polls at 5s
// for up to 10 minutes. In the sheet we tighten the timeout to 120s
// because that's the realistic FAST window on Fuji — anything slower
// indicates an Iris hiccup the user should see and retry.
export const DEFAULT_POLL_MS = 5_000 as const;
export const DEFAULT_TIMEOUT_MS = 120_000 as const;
// If Iris HTTP-429s us, back off polling to 10s. The skill brief
// explicitly calls this out.
export const BACKOFF_POLL_MS = 10_000 as const;

// Block-explorer URL helpers — keep co-located so the sheet doesn't
// hard-code these patterns at the call site.
export function snowtraceTxUrl(hash: string): string {
  return `https://testnet.snowtrace.io/tx/${hash}`;
}
export function arcscanTxUrl(hash: string): string {
  return `https://explorer-testnet.arc.network/tx/${hash}`;
}

// ── ABIs ──────────────────────────────────────────────────────────────────
// Mirrors `cctp-onramp.ts` — only the call shapes we need to (a) read
// USDC balance/allowance, (b) approve TokenMessengerV2 on Fuji, (c)
// burn via depositForBurn, (d) mint via receiveMessage on Arc. We
// also export `parseAbi`d versions so callers can pass them straight
// to viem's `writeContract` / `simulateContract` without intermediate
// type assertions.
export const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const TOKEN_MESSENGER_V2_ABI = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
]);

export const MESSAGE_TRANSMITTER_V2_ABI = parseAbi([
  "function receiveMessage(bytes message, bytes attestation) returns (bool success)",
  "event MessageSent(bytes message)",
]);
