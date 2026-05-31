/**
 * HinkalProvider — ShieldedExecutionProvider backed by Hinkal (impl #1).
 *
 * VALIDATED against Arc Testnet (Phase 0 spike, 2026-05-31): supported chains,
 * token-registry sync, shielded balance reads, and a 1 USDC shield round-trip
 * all succeed live (Hinkal contract 0x92c4Dce78EC1833b2966daF9be175EF50e95BA01;
 * deposit tx 0x7035cc16…). Hinkal is CLOSED-source, so this adapter is the whole
 * lock-in surface — keep it thin behind the interface.
 *
 * Integration constraints learned in Phase 0:
 *  - MUST use Hinkal's bundled **ethers v6** signer. A v5 signer fails the SDK's
 *    `instanceof Signer` check with "expected signer". We accept an ethers-v6
 *    signer via the constructor (a wagmi→ethers-v6 adapter supplies it in the
 *    app; a Wallet supplies it headless).
 *  - `checkAccessToken(chainId)` returns `undefined` on Arc testnet = no
 *    access-token gating (open). Treat anything !== false as access-ready.
 *  - reads: `getTotalBalance(chainId, undefined, undefined, true, true)`.
 *  - shield: ERC20 approve → `deposit([token],[amount], preEstimate, false)`.
 *
 * The SDK self-submits through the ethers signer, so our prepare→submit split
 * collapses: prepare* records the intent; submit() runs the SDK call (the
 * `signature` arg is unused — Hinkal signs via the injected signer).
 *
 * `@hinkal/common` is imported DYNAMICALLY so defi-web-app builds without the
 * dep. To run live: `bun add @hinkal/common` in apps/web and pass an ethers-v6
 * signer + provider through the config.
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
const HINKAL_CHAINS = new Set<ChainId>([1, 10, 137, 8453, 42161, 5042002]); // from getSupportedChains() on Arc
export const HINKAL_ARC_CONTRACT = "0x92c4Dce78EC1833b2966daF9be175EF50e95BA01" as HexAddress;

// USDC/EURC are the registered Arc tokens (Phase 0). decimals from the registry.
const ARC_REGISTRY: Record<string, ShieldedToken> = {
  USDC: { chainId: ARC, address: "0x3600000000000000000000000000000000000000", symbol: "USDC", decimals: 6 },
  EURC: { chainId: ARC, address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", symbol: "EURC", decimals: 6 },
};
const tokenByAddress = (addr: HexAddress): ShieldedToken | undefined =>
  Object.values(ARC_REGISTRY).find((t) => t.address.toLowerCase() === addr.toLowerCase());

/** Minimal ethers-v6 signer shape we need (avoids a static ethers import). */
export interface EthersV6Signer {
  getAddress(): Promise<string>;
  sendTransaction(tx: { to: string; data: string; value?: bigint }): Promise<{ wait(): Promise<{ hash: string }> }>;
}

export interface HinkalProviderConfig {
  /** An ethers-v6 signer (Wallet headless, or a wagmi→ethers-v6 adapter in-app). */
  signer: EthersV6Signer;
  /** Optional preconstructed Hinkal instance (else built lazily via prepareEthersHinkal). */
  hinkal?: unknown;
}

interface ShieldTicket {
  op: "shield" | "unshield" | "execute" | "transfer";
  chainId: ChainId;
  tokens: HexAddress[];
  amounts: string[]; // bigint serialized
  recipient?: HexAddress;
  recipientInfo?: RecipientInfo;
  action?: { target: HexAddress; callData: HexData; label?: string };
}

export class HinkalProvider implements ShieldedExecutionProvider {
  private hinkal: any | null;
  constructor(private readonly cfg: HinkalProviderConfig) {
    this.hinkal = cfg.hinkal ?? null;
  }

  readonly capabilities: ProviderCapabilities = {
    id: "hinkal",
    supportsChain: (c) => HINKAL_CHAINS.has(c),
    shieldableTokens: async (c) => (c === ARC ? Object.values(ARC_REGISTRY) : []),
    hasRelayer: (c) => HINKAL_CHAINS.has(c),
    supportsExecution: (c) => HINKAL_CHAINS.has(c), // actionPrivateWallet / externalAction
  };

  /** Lazily build the Hinkal client from the ethers-v6 signer (cached). */
  private async client(): Promise<any> {
    if (this.hinkal) return this.hinkal;
    const { prepareEthersHinkal } = await import(
      /* @vite-ignore */ "@hinkal/common/providers/prepareEthersHinkal"
    );
    const h = await prepareEthersHinkal(this.cfg.signer as never);
    if (h.initUserKeys) await h.initUserKeys();
    this.hinkal = h;
    return h;
  }

  async ensureAccess(_signer: ShieldedSigner, accessKeyOverride?: string): Promise<AccessStatus> {
    const h = await this.client();
    const res = await h.checkAccessToken(ARC, accessKeyOverride);
    // undefined on Arc testnet = no gating (open); only an explicit false denies.
    return res === false ? { status: "no-access", reason: "Hinkal access token required" } : { status: "ready" };
  }

  async getBalances(_signer: ShieldedSigner, chainId: ChainId): Promise<ShieldedBalance[]> {
    const h = await this.client();
    const raw: any[] = await h.getTotalBalance(chainId, undefined, undefined, true, true);
    return (raw ?? [])
      .map((x) => {
        const addr = (x.erc20Token?.erc20TokenAddress ?? x.tokenAddress) as HexAddress | undefined;
        const token = addr ? tokenByAddress(addr) : undefined;
        if (!token) return null;
        const amount = BigInt(x.balance?.toString?.() ?? "0");
        const human = Number(amount) / 10 ** token.decimals;
        return { token, amount, usdEquivalent: human * (token.symbol === "EURC" ? 1.08 : 1) };
      })
      .filter((b): b is ShieldedBalance => b != null && b.amount > 0n);
  }

  async getRecipientInfo(_signer: ShieldedSigner, _chainId: ChainId): Promise<RecipientInfo> {
    const h = await this.client();
    return (h.getRecipientInfo?.() ?? h.getShieldedAddress?.() ?? "") as RecipientInfo;
  }

  private prep(t: ShieldTicket, notes: string[]): PreparedOp {
    return {
      kind: t.op === "transfer" ? "private-transfer" : t.op,
      chainId: t.chainId,
      // Hinkal signs via the injected ethers signer at submit time, so there is
      // no separate user signature for the app to collect here.
      authorization: { type: "message", payload: { hinkal: t.op } },
      ticket: JSON.stringify(t),
      privacyNotes: notes,
    };
  }

  async prepareShield(
    _signer: ShieldedSigner,
    input: { chainId: ChainId; funding: Array<{ token: HexAddress; amount: Atomic }> },
  ): Promise<PreparedOp> {
    return this.prep(
      { op: "shield", chainId: input.chainId, tokens: input.funding.map((f) => f.token), amounts: input.funding.map((f) => f.amount.toString()) },
      ["Deposit tx is public (you send tokens to the Hinkal pool); balance + trades after are hidden."],
    );
  }

  async prepareUnshield(
    _signer: ShieldedSigner,
    input: { chainId: ChainId; withdrawals: Array<{ token: HexAddress; amount: Atomic }>; recipient: HexAddress },
  ): Promise<PreparedOp> {
    return this.prep(
      { op: "unshield", chainId: input.chainId, tokens: input.withdrawals.map((w) => w.token), amounts: input.withdrawals.map((w) => (-w.amount).toString()), recipient: input.recipient },
      ["Withdraw to a fresh address via the relayer; amount is public on exit."],
    );
  }

  async preparePrivateTransfer(
    _signer: ShieldedSigner,
    input: { chainId: ChainId; transfers: Array<{ token: HexAddress; amount: Atomic }>; recipientInfo: RecipientInfo },
  ): Promise<PreparedOp> {
    return this.prep(
      { op: "transfer", chainId: input.chainId, tokens: input.transfers.map((x) => x.token), amounts: input.transfers.map((x) => (-x.amount).toString()), recipientInfo: input.recipientInfo },
      ["Shielded → shielded: hidden amount."],
    );
  }

  async prepareExecute(_signer: ShieldedSigner, action: ShieldedAction): Promise<PreparedOp> {
    if (!this.capabilities.supportsExecution(action.chainId)) throw new Error(`Hinkal: no execution on chain ${action.chainId}`);
    return this.prep(
      {
        op: "execute",
        chainId: action.chainId,
        tokens: action.funding.map((f) => f.token),
        amounts: action.funding.map((f) => (-f.amount).toString()),
        action: { target: action.target, callData: action.callData, label: action.label },
      },
      [
        "Executed from your shielded balance via actionPrivateWallet — your wallet is not msg.sender.",
        "The position itself is still public on the matcher; only WHO and HOW MUCH are hidden.",
      ],
    );
  }

  async submit(prepared: PreparedOp, _signature: HexData): Promise<{ txHash: HexData | null; ref: string }> {
    const h = await this.client();
    const t: ShieldTicket = JSON.parse(prepared.ticket);
    const tokens = t.tokens.map((addr) => ({ ...(tokenByAddress(addr) ?? {}), erc20TokenAddress: addr, chainId: t.chainId }));
    const deltas = t.amounts.map((a) => BigInt(a));

    if (t.op === "shield") {
      // approve each token to the Hinkal contract, then deposit.
      for (let i = 0; i < t.tokens.length; i++) {
        const approveData = ("0x095ea7b3" +
          t.tokens[i].toLowerCase().replace("0x", "").padStart(64, "0") +
          deltas[i].toString(16).padStart(64, "0")) as HexData;
        await (await this.cfg.signer.sendTransaction({ to: HINKAL_ARC_CONTRACT, data: approveData })).wait();
      }
      const res = await h.deposit(tokens, deltas, true, false);
      return { txHash: (res?.hash ?? null) as HexData | null, ref: `hinkal-shield-${res?.hash ?? "pending"}` };
    }

    // unshield / transfer / execute → actionPrivateWallet(chainId, tokens, deltaAmounts, onChainCreation, ops, ...)
    // Phase 1: build `ops` (the externalAction calldata for execute) + recipient
    // for unshield. Validated end-to-end in Phase 1 (Morpho supply spike).
    const onChainCreation = tokens.map(() => false);
    const ops = t.action ? [t.action.callData] : [];
    const res = await h.actionPrivateWallet(
      t.chainId, tokens, deltas, onChainCreation, ops, [],
      undefined, undefined, undefined, undefined, false, undefined,
      undefined, t.recipientInfo,
    );
    return { txHash: (res?.hash ?? null) as HexData | null, ref: `hinkal-${t.op}-${res?.hash ?? "pending"}` };
  }

  // → viewing-key scan of executions Hinkal fronted (Phase 3 resolution layer).
  async resolveOwnedExecutions(_signer: ShieldedSigner, _chainId: ChainId): Promise<OwnedExecution[]> {
    return [];
  }
}
