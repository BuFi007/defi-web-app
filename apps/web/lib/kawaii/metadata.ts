import { createHash, createHmac } from "node:crypto";
import { KAWAII_GATE, RESERVED_BASES } from "./config";
import type { AvatarSelection } from "./compose";
import { LAYER_ORDER } from "./layers";

/**
 * ERC-1155 metadata for a Kawaii avatar. Reserved bases carry a signed
 * `attestation` (HMAC over base/owner/chainId/contract) so the verified badge
 * is forgery-proof: a copycat can't reproduce the signature. The attestation
 * key is a backend secret (KAWAII_ATTEST_SECRET), never shipped to the client.
 */
export interface KawaiiMetadata {
  name: string;
  description: string;
  image: string; // ipfs://<imageCid>
  attributes: Array<{ trait_type: string; value: string }>;
  attestation?: { base: string; owner: string; chainId: number; contract: string; sig: string };
}

function attest(payload: { base: string; owner: string; chainId: number; contract: string }): string {
  const secret = process.env.KAWAII_ATTEST_SECRET;
  if (!secret) throw new Error("KAWAII_ATTEST_SECRET missing — cannot sign reserved attestation");
  const msg = `${payload.base}|${payload.owner}|${payload.chainId}|${payload.contract}`;
  return createHmac("sha256", secret).update(msg).digest("hex");
}

export function buildMetadata(args: {
  baseId: string;
  selection: AvatarSelection;
  imageCid: string;
  chainId: number;
  contract: string;
  owner: string;
}): KawaiiMetadata {
  const { baseId, selection, imageCid, chainId, contract, owner } = args;
  const attributes: Array<{ trait_type: string; value: string }> = [
    { trait_type: "Base", value: baseId },
  ];
  for (const cat of LAYER_ORDER) {
    if (cat === "base") continue;
    const v = selection.layers?.[cat];
    if (v) attributes.push({ trait_type: cat, value: v.replace(/\.png$/i, "") });
  }

  const isReserved = baseId in RESERVED_BASES;
  const meta: KawaiiMetadata = {
    name: isReserved ? `Kawaii Punk — ${RESERVED_BASES[baseId as keyof typeof RESERVED_BASES].display}` : "Kawaii Punk",
    description:
      "BUFX Kawaii Punk avatar. Customizable, cross-chain (Avalanche ⇄ Arc), powers up with trading activity.",
    image: `ipfs://${imageCid}`,
    attributes,
  };
  if (isReserved) {
    meta.attestation = { base: baseId, owner, chainId, contract, sig: attest({ base: baseId, owner, chainId, contract }) };
  }
  return meta;
}

/** Stable hash of a composed image (for dedup / idempotency). */
export function imageDigest(png: Buffer): string {
  return createHash("sha256").update(png).digest("hex");
}

export { KAWAII_GATE };
