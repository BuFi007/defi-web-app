/**
 * Block-explorer URL helpers for the swap widget's "view tx" CTA.
 *
 * Co-located with the swap module instead of imported from lib/cctp so
 * deleting the legacy CCTP slice doesn't drag the swap widget with it.
 * Single source of truth for the chain → URL mapping:
 *   - Fuji  (43113)   → testnet.snowtrace.io
 *   - Arc TN (5042002) → explorer-testnet.arc.network
 *
 * Returns `null` for chains the widget doesn't know about so the UI
 * can fall back to "tx submitted" without exposing a broken link.
 */
export function explorerTxUrl(chainId: number, hash: string): string | null {
  if (chainId === 43113) return `https://testnet.snowtrace.io/tx/${hash}`;
  if (chainId === 5042002) return `https://explorer-testnet.arc.network/tx/${hash}`;
  return null;
}

export function shortHash(hash: string, head = 6, tail = 4): string {
  if (!hash.startsWith("0x")) return hash;
  if (hash.length <= head + tail + 2) return hash;
  return `${hash.slice(0, head + 2)}…${hash.slice(-tail)}`;
}
