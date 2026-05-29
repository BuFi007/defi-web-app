// Canonical deployed-contract registry loader. Routes import this to wire
// against the live protocol surface (source of truth: contracts.json, compiled
// from fx-telarana/deployments + on-chain verification). See contracts.json _meta.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ChainKey = "arc" | "fuji";

const raw = readFileSync(join(import.meta.dir, "contracts.json"), "utf8");
// Loosely typed — the JSON is the source of truth; callers narrow as needed.
export const registry = JSON.parse(raw) as {
  arc: ChainEntry;
  fuji: ChainEntry;
  _meta: Record<string, unknown>;
};

interface ChainEntry {
  chainId: number;
  rpc: string;
  tokens: Record<string, string>;
  [family: string]: unknown;
}

export const ARC = registry.arc;
export const FUJI = registry.fuji;

/** Resolve a token symbol → address on a chain (case-insensitive). Throws if unknown. */
export function tokenAddress(chain: ChainKey, symbol: string): `0x${string}` {
  const tokens = registry[chain].tokens;
  const hit =
    tokens[symbol] ??
    tokens[Object.keys(tokens).find((k) => k.toLowerCase() === symbol.toLowerCase()) ?? ""];
  if (!hit) throw new Error(`unknown token "${symbol}" on ${chain}`);
  return hit as `0x${string}`;
}

/** Deep-get a contract address by dotted path under a chain, e.g. "lpInsuranceLayer.fxOracleV2". */
export function contractAddress(chain: ChainKey, path: string): `0x${string}` {
  let cur: unknown = registry[chain];
  for (const seg of path.split(".")) {
    cur = (cur as Record<string, unknown>)?.[seg];
  }
  if (typeof cur !== "string" || !cur.startsWith("0x")) {
    throw new Error(`no contract at "${path}" on ${chain}`);
  }
  return cur as `0x${string}`;
}

/** All token symbols on a chain (for enums / discovery). */
export function tokenSymbols(chain: ChainKey): string[] {
  return Object.keys(registry[chain].tokens);
}
