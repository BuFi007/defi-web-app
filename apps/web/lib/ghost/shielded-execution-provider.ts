/**
 * ShieldedExecutionProvider — the vendor-neutral contract for Ghost Mode.
 *
 * This is the seam that prevents lock-in. Hinkal is implementation #1; a future
 * own-stack (0xbow pools + our relayer-privacy + a joinsplit/execution circuit)
 * is implementation #2. The app and the MCP depend ONLY on this interface, so
 * swapping providers is a new adapter, not a rewrite.
 *
 * Design rules:
 *  - Framework-agnostic: NO wagmi / Hinkal / viem-client types leak in. Amounts
 *    are atomic `bigint`. Signing goes through `ShieldedSigner`. This file can be
 *    lifted into `packages/ghost-provider` verbatim for the MCP to import.
 *  - Prepare → authorize → submit. Privacy ops are relayer-submitted (the relayer
 *    is msg.sender, not the user). Splitting prepare/submit lets the MCP stay
 *    non-custodial: it returns the authorization payload for an agent to sign,
 *    and never holds keys.
 *  - Opaque handles (`RecipientInfo`, `AccessHandle`, `ticket`) are provider-
 *    defined blobs. Never parse them; pass them back to the same provider.
 *
 * See GHOST_PRIVATE_WALLET_GOAL.md. Honest scope: this hides WHO + HOW MUCH
 * (identity + amount), not the position on the public matcher.
 */

// ── Value types ─────────────────────────────────────────────────────────────

export type ChainId = number;
export type HexAddress = `0x${string}`;
export type HexData = `0x${string}`;
/** Atomic token amount (smallest unit). `bigint` everywhere — no float drift. */
export type Atomic = bigint;

export interface ShieldedToken {
  chainId: ChainId;
  address: HexAddress;
  symbol: string;
  decimals: number;
}

/** Opaque private-recipient handle (stealth note info / viewing-key blob).
 *  Treat as a black box; hand it back to the provider unchanged. */
export type RecipientInfo = string;

// ── Signer abstraction (keeps wagmi/node signers out of the interface) ───────

export interface ShieldedSigner {
  readonly address: HexAddress;
  readonly chainId: ChainId;
  signMessage(message: string): Promise<HexData>;
  signTypedData(typedData: unknown): Promise<HexData>;
  /** Self-submit fallback when no relayer exists on the chain (this REVEALS the
   *  user as msg.sender — providers should prefer the relayer path). */
  sendTransaction?(tx: { to: HexAddress; data: HexData; value?: Atomic }): Promise<HexData>;
}

// ── Capabilities (per-chain feature discovery) ───────────────────────────────

export interface ProviderCapabilities {
  /** Stable id, e.g. "hinkal" | "bufi-0xbow". */
  readonly id: string;
  /** Does this provider operate on the chain at all. */
  supportsChain(chainId: ChainId): boolean;
  /** Tokens this provider can shield on a chain (its registry). */
  shieldableTokens(chainId: ChainId): Promise<ShieldedToken[]>;
  /** Can withdrawals be relayer-submitted (msg.sender detached) on this chain. */
  hasRelayer(chainId: ChainId): boolean;
  /** Does this provider support composable execution (trade/lend FROM balance).
   *  Hinkal: true on supported chains. A transfer-only mixer: false. */
  supportsExecution(chainId: ChainId): boolean;
}

// ── Access / balances ────────────────────────────────────────────────────────

export type AccessStatus =
  | { status: "ready" }
  | { status: "no-access"; reason?: string };

export interface ShieldedBalance {
  token: ShieldedToken;
  /** Hidden amount — known only to the owner after `ensureAccess`. */
  amount: Atomic;
  /** Convenience USD-equivalent for UI; provider may return null. */
  usdEquivalent: number | null;
}

// ── Operations: prepare → authorize → submit ─────────────────────────────────

export type OpKind = "shield" | "unshield" | "private-transfer" | "execute";

export interface AuthorizationRequest {
  type: "eip712" | "message" | "userop" | "approval+sign";
  /** ERC20 approvals the provider needs BEFORE the op (e.g. shield deposit). */
  approvals?: Array<{ token: HexAddress; spender: HexAddress; amount: Atomic }>;
  /** The payload to sign; concrete shape depends on `type`. */
  payload: unknown;
}

export interface PreparedOp {
  readonly kind: OpKind;
  readonly chainId: ChainId;
  /** What the user/agent must sign to authorize the op. */
  readonly authorization: AuthorizationRequest;
  /** Opaque continuation the provider needs at `submit` time. */
  readonly ticket: string;
  /** Best-effort fee estimate for display. */
  readonly fee?: { token: ShieldedToken; amount: Atomic } | null;
  /** Per-op privacy advice (mirror of ghost_privacy_check), for UI + MCP. */
  readonly privacyNotes?: string[];
}

export interface ShieldedOpResult {
  /** Relayer's on-chain tx hash (NOT the user's). null while pending. */
  txHash: HexData | null;
  /** Provider ref for tracking + ownership resolution. */
  ref: string;
}

// ── Execution (the headline: trade/lend/borrow FROM the shielded balance) ────

/**
 * An arbitrary contract call run FUNDED FROM the shielded balance. The executor
 * (msg.sender, and the order's `trader` field) is a provider-controlled detached
 * address — NOT the user's EOA — but it RESOLVES back to the user privately via
 * `resolveOwnedExecutions`. This is the "the address won't show, but it resolves
 * to it" guarantee, and how a Ghost-mode perp open / Morpho supply executes.
 */
export interface ShieldedAction {
  chainId: ChainId;
  /** Target contract: TelaranaFxOrderSettlement / Morpho / spot router. */
  target: HexAddress;
  /** ABI-encoded calldata for the call. */
  callData: HexData;
  /** Tokens + amounts pulled from the shielded balance to fund the call
   *  (e.g. USDC margin). Moved into the execution context atomically. */
  funding: Array<{ token: HexAddress; amount: Atomic }>;
  /** Token the call settles back into the shielded balance, if any (PnL/output). */
  settleBackToken?: HexAddress;
  /** Human label for ownership resolution + UI ("EURC/USDC long 5x"). */
  label?: string;
}

/** A past shielded execution, resolved back to its owner (private, key-scoped). */
export interface OwnedExecution {
  ref: string;
  chainId: ChainId;
  /** The detached on-chain executor address that fronted this action. */
  executor: HexAddress;
  target: HexAddress;
  label?: string;
  createdAt: number;
}

// ── The provider ─────────────────────────────────────────────────────────────

export interface ShieldedExecutionProvider {
  readonly capabilities: ProviderCapabilities;

  /** Ensure shielded access on a chain (derive/verify viewing+spending key,
   *  mint/refresh any access token). Idempotent. */
  ensureAccess(signer: ShieldedSigner, accessKeyOverride?: string): Promise<AccessStatus>;

  /** Read the user's shielded balances on a chain (requires access). */
  getBalances(signer: ShieldedSigner, chainId: ChainId): Promise<ShieldedBalance[]>;

  /** The user's own recipient handle, to receive private deposits/transfers. */
  getRecipientInfo(signer: ShieldedSigner, chainId: ChainId): Promise<RecipientInfo>;

  /** DEPOSIT public tokens → shielded balance ("add to your Ghost balance"). */
  prepareShield(
    signer: ShieldedSigner,
    input: { chainId: ChainId; funding: Array<{ token: HexAddress; amount: Atomic }> },
  ): Promise<PreparedOp>;

  /** WITHDRAW shielded → a public (fresh) recipient. Relayer-submitted.
   *  Provider MAY route this through a denominated exit (0xbow) under the hood. */
  prepareUnshield(
    signer: ShieldedSigner,
    input: {
      chainId: ChainId;
      withdrawals: Array<{ token: HexAddress; amount: Atomic }>;
      recipient: HexAddress;
    },
  ): Promise<PreparedOp>;

  /** Shielded → shielded transfer to another user's RecipientInfo. */
  preparePrivateTransfer(
    signer: ShieldedSigner,
    input: {
      chainId: ChainId;
      transfers: Array<{ token: HexAddress; amount: Atomic }>;
      recipientInfo: RecipientInfo;
    },
  ): Promise<PreparedOp>;

  /** EXECUTE a contract call funded from the shielded balance (trade/lend/borrow
   *  privately). MUST throw if `!capabilities.supportsExecution(action.chainId)`. */
  prepareExecute(signer: ShieldedSigner, action: ShieldedAction): Promise<PreparedOp>;

  /** Submit a prepared op after its authorization was signed. The provider
   *  relays it (relayer is msg.sender). The split keeps the MCP non-custodial. */
  submit(prepared: PreparedOp, signature: HexData): Promise<ShieldedOpResult>;

  /** Map detached executions back to the user — private, viewing-key scoped.
   *  Backs Ghost-mode "my positions" without exposing the link publicly. */
  resolveOwnedExecutions(signer: ShieldedSigner, chainId: ChainId): Promise<OwnedExecution[]>;
}

// ── Provider registry (pick the provider per chain) ──────────────────────────

/**
 * Per-chain provider selection. Today: Hinkal on every supported chain. Later:
 * route specific chains to the own-stack adapter without touching call sites.
 * Keep this the ONLY place that names a concrete provider.
 */
export interface GhostProviderRegistry {
  forChain(chainId: ChainId): ShieldedExecutionProvider | null;
  all(): ShieldedExecutionProvider[];
}

/*
 * ── Adapter mapping notes ────────────────────────────────────────────────────
 *
 * HinkalProvider (impl #1) maps onto desk-v1's @bu/private-transfer-core:
 *   ensureAccess          → preparedClient.ensurePrivateAccess(chainId)
 *   getBalances           → getHinkalPrivateBalances / normalizeHinkalPrivateBalances
 *   getRecipientInfo      → HinkalMethodWrapper.getRecipientInfo()
 *   prepareShield         → ShieldToPrivateBalance({ tokens, amountChanges })
 *   prepareUnshield       → UnshieldToPublicRecipient({ tokens, deltaAmounts, recipientAddress })
 *   preparePrivateTransfer→ SendPrivateToPrivateRecipient({ tokens, amountChanges, recipientInfo })
 *   prepareExecute        → externalAction / ActionData (+ callDataString) funded from balance
 *   submit                → relayer submission (returnTxData=false path)
 *   resolveOwnedExecutions→ viewing-key scan of executions Hinkal fronted
 *
 * BufiOwnStackProvider (impl #2, future) maps onto:
 *   contracts  → FxPrivacyEntrypoint / FxPrivacyPool (0xbow fork, ours, Apache-2.0)
 *   relayer    → relayer-privacy (fx-telarana) — ours, no vendor relayer
 *   registry   → our own token registry
 *   execution  → NEW joinsplit + execution circuit + trusted setup (the real build)
 *   cross-chain→ NET-NEW coordination (the hardest piece; Hinkal already has it)
 *
 * MCP usage (non-custodial): the MCP calls prepare* and returns
 * { authorization, ticket } to the agent; the agent signs; the MCP (or agent)
 * calls submit(). The MCP never holds a key — same prepare-only contract as the
 * existing ghost/lending routes.
 */
