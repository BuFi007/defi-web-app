/**
 * MockProvider — in-memory ShieldedExecutionProvider for development.
 *
 * Lets the Ghost-mode UI + MCP tooling light up end-to-end with zero on-chain
 * risk and no Hinkal dependency, so we can verify the wiring before swapping in
 * the real HinkalProvider behind the same interface. NOT a privacy guarantee —
 * "shielded" balances here are plain in-memory maps keyed by address.
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

// Tokens this mock can "shield" — mirror Hinkal's Arc registry (USDC/EURC).
const MOCK_TOKENS: Record<ChainId, ShieldedToken[]> = {
  [ARC]: [
    { chainId: ARC, address: "0x3600000000000000000000000000000000000000", symbol: "USDC", decimals: 6 },
    { chainId: ARC, address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", symbol: "EURC", decimals: 6 },
  ],
};

const USD_PRICE: Record<string, number> = { USDC: 1, EURC: 1.08 };

const balKey = (chainId: ChainId, owner: HexAddress, token: HexAddress) =>
  `${chainId}:${owner.toLowerCase()}:${token.toLowerCase()}`;

interface MockTicket {
  kind: PreparedOp["kind"];
  chainId: ChainId;
  owner: HexAddress;
  /** balance deltas to apply on submit, by token address. */
  deltas: Array<{ token: HexAddress; delta: string }>; // string = bigint serialized
  execution?: { target: HexAddress; label?: string };
}

export class MockProvider implements ShieldedExecutionProvider {
  private balances = new Map<string, Atomic>();
  private executions: OwnedExecution[] = [];
  private nonce = 0;

  /** Deterministic seed so a fresh wallet shows a non-zero Ghost balance in dev. */
  constructor(private readonly seed = true) {}

  readonly capabilities: ProviderCapabilities = {
    id: "mock",
    supportsChain: (c) => c === ARC,
    shieldableTokens: async (c) => MOCK_TOKENS[c] ?? [],
    hasRelayer: () => true,
    supportsExecution: () => true,
  };

  private ensureSeed(chainId: ChainId, owner: HexAddress) {
    if (!this.seed) return;
    const usdc = MOCK_TOKENS[chainId]?.find((t) => t.symbol === "USDC");
    if (!usdc) return;
    const k = balKey(chainId, owner, usdc.address);
    if (!this.balances.has(k)) this.balances.set(k, 1_250_000_000n); // 1,250 USDC
  }

  async ensureAccess(_signer: ShieldedSigner): Promise<AccessStatus> {
    return { status: "ready" };
  }

  async getBalances(signer: ShieldedSigner, chainId: ChainId): Promise<ShieldedBalance[]> {
    this.ensureSeed(chainId, signer.address);
    const tokens = MOCK_TOKENS[chainId] ?? [];
    return tokens.map((token) => {
      const amount = this.balances.get(balKey(chainId, signer.address, token.address)) ?? 0n;
      const human = Number(amount) / 10 ** token.decimals;
      return { token, amount, usdEquivalent: human * (USD_PRICE[token.symbol] ?? 1) };
    });
  }

  /** Address-only read for read-only UI surfaces (dev convenience, mock-only). */
  async getBalancesByAddress(chainId: ChainId, owner: HexAddress): Promise<ShieldedBalance[]> {
    return this.getBalances({ address: owner, chainId } as ShieldedSigner, chainId);
  }

  async getRecipientInfo(signer: ShieldedSigner, chainId: ChainId): Promise<RecipientInfo> {
    return `mock:recipient:${chainId}:${signer.address.toLowerCase()}`;
  }

  private prep(t: MockTicket, notes: string[], fee?: PreparedOp["fee"]): PreparedOp {
    return {
      kind: t.kind,
      chainId: t.chainId,
      authorization: { type: "message", payload: { mock: t.kind, ticket: t } },
      ticket: JSON.stringify(t),
      fee: fee ?? null,
      privacyNotes: notes,
    };
  }

  async prepareShield(
    signer: ShieldedSigner,
    input: { chainId: ChainId; funding: Array<{ token: HexAddress; amount: Atomic }> },
  ): Promise<PreparedOp> {
    return this.prep(
      {
        kind: "shield",
        chainId: input.chainId,
        owner: signer.address,
        deltas: input.funding.map((f) => ({ token: f.token, delta: f.amount.toString() })),
      },
      ["Deposit is public on-chain (depositor + amount visible); privacy starts once shielded."],
    );
  }

  async prepareUnshield(
    signer: ShieldedSigner,
    input: { chainId: ChainId; withdrawals: Array<{ token: HexAddress; amount: Atomic }>; recipient: HexAddress },
  ): Promise<PreparedOp> {
    return this.prep(
      {
        kind: "unshield",
        chainId: input.chainId,
        owner: signer.address,
        deltas: input.withdrawals.map((w) => ({ token: w.token, delta: (-w.amount).toString() })),
      },
      ["Withdraw to a FRESH address; amount is public on exit (use a denomination)."],
    );
  }

  async preparePrivateTransfer(
    signer: ShieldedSigner,
    input: { chainId: ChainId; transfers: Array<{ token: HexAddress; amount: Atomic }>; recipientInfo: RecipientInfo },
  ): Promise<PreparedOp> {
    return this.prep(
      {
        kind: "private-transfer",
        chainId: input.chainId,
        owner: signer.address,
        deltas: input.transfers.map((x) => ({ token: x.token, delta: (-x.amount).toString() })),
      },
      ["Shielded → shielded: hidden amount, recipient learns it via their RecipientInfo."],
    );
  }

  async prepareExecute(signer: ShieldedSigner, action: ShieldedAction): Promise<PreparedOp> {
    if (!this.capabilities.supportsExecution(action.chainId)) {
      throw new Error(`MockProvider: execution not supported on chain ${action.chainId}`);
    }
    return this.prep(
      {
        kind: "execute",
        chainId: action.chainId,
        owner: signer.address,
        deltas: action.funding.map((f) => ({ token: f.token, delta: (-f.amount).toString() })),
        execution: { target: action.target, label: action.label },
      },
      [
        "Executed from your shielded balance via a detached executor — your wallet is not msg.sender.",
        "The position itself is still public on the matcher; only WHO and HOW MUCH are hidden.",
      ],
    );
  }

  async submit(prepared: PreparedOp, _signature: HexData): Promise<{ txHash: HexData | null; ref: string }> {
    const t: MockTicket = JSON.parse(prepared.ticket);
    // Seed before applying deltas — ops can run before any getBalances read.
    this.ensureSeed(t.chainId, t.owner);
    for (const d of t.deltas) {
      const k = balKey(t.chainId, t.owner, d.token);
      const next = (this.balances.get(k) ?? 0n) + BigInt(d.delta);
      this.balances.set(k, next < 0n ? 0n : next);
    }
    this.nonce += 1;
    const ref = `mock-${t.kind}-${this.nonce}`;
    if (t.execution) {
      // Detached executor address derived deterministically (mock stealth addr).
      const executor = ("0x" + (BigInt(t.owner) ^ BigInt(this.nonce)).toString(16).padStart(40, "0").slice(-40)) as HexAddress;
      this.executions.push({
        ref,
        chainId: t.chainId,
        executor,
        target: t.execution.target,
        label: t.execution.label,
        createdAt: this.nonce,
      });
    }
    return { txHash: ("0x" + "ab".repeat(32)) as HexData, ref };
  }

  async resolveOwnedExecutions(signer: ShieldedSigner, chainId: ChainId): Promise<OwnedExecution[]> {
    void signer;
    return this.executions.filter((e) => e.chainId === chainId);
  }
}
