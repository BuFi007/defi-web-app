/**
 * HinkalProvider — ShieldedExecutionProvider backed by Hinkal (impl #1).
 *
 * SKELETON. Each method maps 1:1 onto desk-v1's `@bu/private-transfer-core`
 * (which wraps `@hinkal/common@0.2.29`). It is intentionally NOT wired yet:
 *   - the desk-v1 client package isn't a dependency of defi-web-app, and
 *   - Phase 0 (ensureAccess(5042002) + a USDC shield round-trip) must confirm
 *     Hinkal's relayer + access path are actually live on Arc before we depend
 *     on it.
 *
 * To go live: add the client dep, replace each `notWired()` with the mapped
 * call below, then flip `createGhostRegistry("live")` to route Arc here.
 *
 * Hinkal is CLOSED-source (contracts/circuits/relayer private), so this adapter
 * is the entire lock-in surface — keep it thin and behind the interface so a
 * future own-stack provider can replace it without touching call sites.
 */

import type {
  AccessStatus,
  Atomic,
  ChainId,
  HexAddress,
  HexData,
  OwnedExecution,
  PreparedOp,
  ProviderCapabilities,
  RecipientInfo,
  ShieldedAction,
  ShieldedBalance,
  ShieldedExecutionProvider,
  ShieldedSigner,
  ShieldedToken,
} from "./shielded-execution-provider";

const ARC: ChainId = 5042002;
const HINKAL_CHAINS = new Set<ChainId>([1, 10, 137, 8453, 42161, 43114, ARC]);

/** Hinkal Arc deployment (verified live: contracts present, USDC/EURC registered). */
export const HINKAL_ARC = {
  contract: "0x92c4Dce78EC1833b2966daF9be175EF50e95BA01" as HexAddress,
} as const;

function notWired(method: string): never {
  throw new Error(
    `HinkalProvider.${method} not wired — add @bu/private-transfer-core dep + run Phase 0 (GHOST_PRIVATE_WALLET_GOAL.md). Use MockProvider until then.`,
  );
}

export interface HinkalProviderConfig {
  /** desk-v1 prepared client (prepareWagmiPrivateTransferClient output). */
  client?: unknown;
  accessKey?: string;
}

export class HinkalProvider implements ShieldedExecutionProvider {
  constructor(private readonly cfg: HinkalProviderConfig = {}) {}

  readonly capabilities: ProviderCapabilities = {
    id: "hinkal",
    supportsChain: (c) => HINKAL_CHAINS.has(c),
    // → client.isChainSupported + the @hinkal/common arc token registry
    //   (USDC/EURC live; MXNB/QCAD/AUDF/cirBTC not registered yet).
    shieldableTokens: async (_c): Promise<ShieldedToken[]> => notWired("shieldableTokens"),
    hasRelayer: (c) => HINKAL_CHAINS.has(c), // GHOST_RELAYER live on Arc (verify in Phase 0)
    supportsExecution: (c) => HINKAL_CHAINS.has(c), // externalAction / ActionData
  };

  // → preparedClient.ensurePrivateAccess(chainId, accessKeyOverride)
  async ensureAccess(_signer: ShieldedSigner, _accessKeyOverride?: string): Promise<AccessStatus> {
    return notWired("ensureAccess");
  }

  // → getHinkalPrivateBalances / normalizeHinkalPrivateBalances(client, { chainId })
  async getBalances(_signer: ShieldedSigner, _chainId: ChainId): Promise<ShieldedBalance[]> {
    return notWired("getBalances");
  }

  // → HinkalMethodWrapper.getRecipientInfo()
  async getRecipientInfo(_signer: ShieldedSigner, _chainId: ChainId): Promise<RecipientInfo> {
    return notWired("getRecipientInfo");
  }

  // → ShieldToPrivateBalance({ tokens, amountChanges })
  async prepareShield(
    _signer: ShieldedSigner,
    _input: { chainId: ChainId; funding: Array<{ token: HexAddress; amount: Atomic }> },
  ): Promise<PreparedOp> {
    return notWired("prepareShield");
  }

  // → UnshieldToPublicRecipient({ tokens, deltaAmounts, recipientAddress })
  async prepareUnshield(
    _signer: ShieldedSigner,
    _input: { chainId: ChainId; withdrawals: Array<{ token: HexAddress; amount: Atomic }>; recipient: HexAddress },
  ): Promise<PreparedOp> {
    return notWired("prepareUnshield");
  }

  // → SendPrivateToPrivateRecipient({ tokens, amountChanges, recipientInfo })
  async preparePrivateTransfer(
    _signer: ShieldedSigner,
    _input: { chainId: ChainId; transfers: Array<{ token: HexAddress; amount: Atomic }>; recipientInfo: RecipientInfo },
  ): Promise<PreparedOp> {
    return notWired("preparePrivateTransfer");
  }

  // → externalAction / ActionData (+ callDataString) funded from the shielded balance
  async prepareExecute(_signer: ShieldedSigner, _action: ShieldedAction): Promise<PreparedOp> {
    return notWired("prepareExecute");
  }

  // → relayer submission (returnTxData=false → relayer is msg.sender)
  async submit(_prepared: PreparedOp, _signature: HexData): Promise<{ txHash: HexData | null; ref: string }> {
    return notWired("submit");
  }

  // → viewing-key scan of executions Hinkal fronted for this owner
  async resolveOwnedExecutions(_signer: ShieldedSigner, _chainId: ChainId): Promise<OwnedExecution[]> {
    return notWired("resolveOwnedExecutions");
  }
}
