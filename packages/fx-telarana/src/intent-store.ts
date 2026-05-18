import { randomUUID } from "node:crypto";

import type { Address, Hex } from "viem";

import { FxTelaranaError } from "./errors";
import {
  nonceScope,
  verifyIntentSignature,
} from "./intent-verification";
import type { FxTelaranaAction, FxTelaranaIntentTypedData } from "./intents";

export type StoredIntentStatus = "unsigned" | "verified";

export interface StoredIntent {
  id: string;
  kind: FxTelaranaAction;
  createdAt: string;
  updatedAt: string;
  typedData: FxTelaranaIntentTypedData;
  status: StoredIntentStatus;
  signer?: Address;
  signature?: Hex;
  verifiedAt?: string;
}

/**
 * In-memory intent store. The fx-telarana intents are short-lived
 * authentication digests, not custodial state, so in-memory is fine for the
 * scoped frontend integration. The keeper / settlement service owns durable
 * persistence on the protocol side.
 */
export class MemoryIntentStore {
  readonly #intents = new Map<string, StoredIntent>();
  readonly #nonceByScope = new Map<string, bigint>();

  create(kind: FxTelaranaAction, typedData: FxTelaranaIntentTypedData): StoredIntent {
    const now = new Date().toISOString();
    const intent: StoredIntent = {
      id: randomUUID(),
      kind,
      createdAt: now,
      updatedAt: now,
      typedData,
      status: "unsigned",
    };
    this.#intents.set(intent.id, intent);
    return intent;
  }

  get(id: string): StoredIntent | null {
    return this.#intents.get(id) ?? null;
  }

  nextNonce(args: {
    chainId: number | bigint;
    action: FxTelaranaAction;
    account: Address;
  }): bigint {
    return this.#nonceByScope.get(nonceScope(args)) ?? 0n;
  }

  async verify(id: string, args: { signer: Address; signature: Hex }): Promise<StoredIntent> {
    const intent = this.#intents.get(id);
    if (!intent) {
      throw new FxTelaranaError("Intent not found", "INTENT_NOT_FOUND", 404);
    }
    if (intent.status === "verified") {
      if (
        intent.signer?.toLowerCase() === args.signer.toLowerCase() &&
        intent.signature === args.signature
      ) {
        return intent;
      }
      throw new FxTelaranaError(
        "Intent has already been verified",
        "INTENT_ALREADY_VERIFIED",
        409,
      );
    }

    const valid = await verifyIntentSignature({
      typedData: intent.typedData,
      signer: args.signer,
      signature: args.signature,
    });
    if (!valid) {
      throw new FxTelaranaError("Intent signature is invalid", "INTENT_SIGNATURE_INVALID", 401);
    }
    if (args.signer.toLowerCase() !== intent.typedData.message.onBehalf.toLowerCase()) {
      throw new FxTelaranaError("Intent signer must match onBehalf", "INTENT_SIGNER_MISMATCH", 403);
    }

    const scope = nonceScope({
      chainId: intent.typedData.message.chainId,
      action: intent.kind,
      account: intent.typedData.message.onBehalf,
    });
    const expectedNonce = this.#nonceByScope.get(scope) ?? 0n;
    const nonce = intent.typedData.message.nonce;
    if (nonce !== expectedNonce) {
      throw new FxTelaranaError(
        `Invalid nonce ${nonce}; expected ${expectedNonce}`,
        "INTENT_NONCE_MISMATCH",
        409,
      );
    }

    const now = new Date().toISOString();
    const verified: StoredIntent = {
      ...intent,
      status: "verified",
      signer: args.signer,
      signature: args.signature,
      verifiedAt: now,
      updatedAt: now,
    };
    this.#nonceByScope.set(scope, expectedNonce + 1n);
    this.#intents.set(id, verified);
    return verified;
  }

  reset(): void {
    this.#intents.clear();
    this.#nonceByScope.clear();
  }
}

export const intentStore = new MemoryIntentStore();

export function storeIntent(
  kind: FxTelaranaAction,
  typedData: FxTelaranaIntentTypedData,
): StoredIntent {
  return intentStore.create(kind, typedData);
}

export function getIntent(id: string): StoredIntent | null {
  return intentStore.get(id);
}

export function verifyStoredIntent(
  id: string,
  args: { signer: Address; signature: Hex },
): Promise<StoredIntent> {
  return intentStore.verify(id, args);
}

export function getNextIntentNonce(args: {
  chainId: number | bigint;
  action: FxTelaranaAction;
  account: Address;
}): bigint {
  return intentStore.nextNonce(args);
}
