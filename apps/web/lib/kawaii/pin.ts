import { PinataSDK } from "pinata";
import { KAWAII_URI_REGEX } from "./config";

/**
 * Pinata pinning (image + metadata) → CIDv1. Content-addressed, so re-pinning
 * identical bytes returns the same CID (retry-safe). Reuses the sendero pattern.
 * Env: PINATA_JWT (required), PINATA_GATEWAY (optional, for reads).
 */
function pinata(): PinataSDK {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error("PINATA_JWT missing — cannot pin Kawaii art");
  return new PinataSDK({ pinataJwt: jwt, pinataGateway: process.env.PINATA_GATEWAY || "gateway.pinata.cloud" });
}

export async function pinImagePng(png: Buffer, name = "kawaii.png"): Promise<string> {
  const file = new File([new Uint8Array(png)], name, { type: "image/png" });
  const res = await pinata().upload.public.file(file);
  return res.cid; // CIDv1
}

export async function pinMetadataJson(metadata: Record<string, unknown>): Promise<string> {
  const res = await pinata().upload.public.json(metadata);
  return res.cid; // CIDv1
}

/** Build the `ipfs://<cid>` tokenURI and assert it's a CIDv1 ipfs uri (no gateway/ipns/query). */
export function toTokenUri(cid: string): string {
  const uri = `ipfs://${cid}`;
  if (!KAWAII_URI_REGEX.test(uri)) throw new Error(`refusing non-CIDv1 ipfs uri: ${uri}`);
  return uri;
}
