/**
 * Encrypted localStorage for ZeroDev session keys.
 *
 * A session key is a fresh EOA private key the user authorizes the kernel
 * to accept *for a scoped set of actions* (settleMatch, cancelOrder,
 * margin deposit/withdraw) for a bounded time window. Holding it in
 * plaintext localStorage would defeat the purpose: any extension with
 * page access could exfiltrate it and continue trading from the kernel
 * until the policy expires.
 *
 * Mitigation here:
 *   1. Derive a non-extractable AES-GCM key via PBKDF2 from the user's
 *      wagmi address + a per-record salt (Web Crypto API). The address
 *      is public but it pins the encrypted blob to the connected wallet,
 *      so swapping wallets doesn't accidentally decrypt the wrong key.
 *   2. Store ciphertext + iv + salt + the kernel approval (already a
 *      serialised, signed-by-the-owner payload — owner sig is the
 *      load-bearing part for ERC-1271, not the private key).
 *   3. Persist `validUntil` next to the blob so callers can check expiry
 *      without decrypting.
 *
 * This is NOT cryptographic protection against a fully-compromised
 * browser — nothing in a Web Crypto API + localStorage stack can defend
 * against that. It's a "don't put a hot wallet in plaintext on disk"
 * guardrail that raises the bar from "trivial grep" to "active malware
 * with page-script execution + key derivation".
 */

"use client";

import type { Address, Hex } from "viem";

const STORAGE_KEY = "bufi.perps.session-key.v1";
const PBKDF2_ITERATIONS = 100_000;

export interface StoredSessionKeyRecord {
  /**
   * Lowercased wagmi address that authorised this session key. Used as
   * the PBKDF2 input so a session blob persisted by wallet A cannot be
   * silently used by wallet B.
   */
  ownerAddress: Address;
  /** The kernel smart-account address the session signs against. */
  kernelAddress: Address;
  /** chainId the kernel was created on (Arc Testnet = 5042002). */
  chainId: number;
  /** Unix seconds — the kernel + timestamp policy expire after this. */
  validUntil: number;
  /** Unix seconds the policy starts being valid. */
  validAfter: number;
  /** ZeroDev `serializePermissionAccount()` output (owner-signed approval). */
  approval: string;
  /** AES-GCM ciphertext of the session-key private key, base64url. */
  ciphertext: string;
  /** AES-GCM iv, base64url. */
  iv: string;
  /** PBKDF2 salt, base64url. */
  salt: string;
}

export interface DecryptedSessionKey {
  record: StoredSessionKeyRecord;
  sessionKeyPrivateKey: Hex;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function getSubtle(): SubtleCrypto {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error("session-key-storage: Web Crypto API unavailable");
  }
  return window.crypto.subtle;
}

async function deriveAesKey(
  ownerAddress: Address,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const baseKey = await subtle.importKey(
    "raw",
    new TextEncoder().encode(ownerAddress.toLowerCase()),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface PersistSessionKeyInput {
  ownerAddress: Address;
  kernelAddress: Address;
  chainId: number;
  validAfter: number;
  validUntil: number;
  approval: string;
  sessionKeyPrivateKey: Hex;
}

export async function persistSessionKey(
  input: PersistSessionKeyInput,
): Promise<StoredSessionKeyRecord> {
  const subtle = getSubtle();
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveAesKey(input.ownerAddress, salt);
  const plaintext = new TextEncoder().encode(input.sessionKeyPrivateKey);
  const cipherBuf = await subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    aesKey,
    plaintext as BufferSource,
  );
  const record: StoredSessionKeyRecord = {
    ownerAddress: input.ownerAddress,
    kernelAddress: input.kernelAddress,
    chainId: input.chainId,
    validAfter: input.validAfter,
    validUntil: input.validUntil,
    approval: input.approval,
    ciphertext: toBase64Url(new Uint8Array(cipherBuf)),
    iv: toBase64Url(iv),
    salt: toBase64Url(salt),
  };
  window.localStorage.setItem(storageKeyFor(input.ownerAddress, input.chainId), JSON.stringify(record));
  return record;
}

export function readSessionKeyRecord(
  ownerAddress: Address,
  chainId: number,
): StoredSessionKeyRecord | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(storageKeyFor(ownerAddress, chainId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSessionKeyRecord;
    if (parsed.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) return null;
    if (parsed.chainId !== chainId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isSessionKeyExpired(
  record: StoredSessionKeyRecord,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  return nowSeconds >= record.validUntil;
}

export async function decryptSessionKey(
  record: StoredSessionKeyRecord,
): Promise<DecryptedSessionKey> {
  const subtle = getSubtle();
  const aesKey = await deriveAesKey(record.ownerAddress, fromBase64Url(record.salt));
  const plainBuf = await subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(record.iv) as BufferSource },
    aesKey,
    fromBase64Url(record.ciphertext) as BufferSource,
  );
  const hex = new TextDecoder().decode(plainBuf);
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("session-key-storage: decrypted blob is not a 32-byte hex key");
  }
  return { record, sessionKeyPrivateKey: hex as Hex };
}

export function revokeSessionKey(ownerAddress: Address, chainId: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKeyFor(ownerAddress, chainId));
}

function storageKeyFor(ownerAddress: Address, chainId: number): string {
  return `${STORAGE_KEY}.${chainId}.${ownerAddress.toLowerCase()}`;
}

/**
 * For tests + UI status panel — list every session-key blob persisted in
 * this browser, regardless of owner/chain. Does not decrypt.
 */
export function listAllPersistedSessionKeys(): StoredSessionKeyRecord[] {
  if (typeof window === "undefined") return [];
  const out: StoredSessionKeyRecord[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(`${STORAGE_KEY}.`)) continue;
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw) as StoredSessionKeyRecord);
    } catch {
      // ignore malformed blobs
    }
  }
  return out;
}
