import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { cache } from "@hyper/cache";
import { createPublicClient, http, fallback, type Address, formatUnits } from "viem";
import { fxPrivacyEntrypointAbi } from "@bufi/contracts";

const ARC_RPC = process.env.ARC_TESTNET_RPC ?? "https://rpc.drpc.testnet.arc.network";
const ARC_RPC_FALLBACK = process.env.ARC_TESTNET_RPC_FALLBACK ?? "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = 5042002;

const arcClient = createPublicClient({
  transport: fallback([http(ARC_RPC), http(ARC_RPC_FALLBACK)]),
});

const PRIVACY_ENTRYPOINT = "0xd1bEB7Ba76D234c65e26F9F53e7efD1b1f36f985" as Address;

interface PoolInfo {
  symbol: string;
  token: Address;
  pool: Address;
  decimals: number;
  minimumDeposit: string;
  maxRelayFeeBPS: string;
}

const POOLS: PoolInfo[] = [
  { symbol: "USDC", token: "0x3600000000000000000000000000000000000000", pool: "0xc11c216c9c7a36848b1d4276d223160c8b51988f", decimals: 6, minimumDeposit: "1", maxRelayFeeBPS: "500" },
  { symbol: "EURC", token: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", pool: "0x7B4582CDE65c8cC00fE24B16dBA60472242d234c", decimals: 6, minimumDeposit: "1", maxRelayFeeBPS: "500" },
  { symbol: "MXNB", token: "0x836F73Fbc370A9329Ba4957E47912DfDBA6BA461", pool: "0x441723FD6212EF7C95D0e04F59b2Eeb59838d4E7", decimals: 6, minimumDeposit: "1", maxRelayFeeBPS: "500" },
  { symbol: "QCAD", token: "0x23d7CFFd0876f3ABb6B074287ba2aeefBc83825d", pool: "0xF3bd84bDdaD66a3b1F94dF7de0aD34AB158f2De4", decimals: 6, minimumDeposit: "1", maxRelayFeeBPS: "500" },
  { symbol: "cirBTC", token: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", pool: "0x2465806A9293A588867DD94b9A6aB5d47531E928", decimals: 18, minimumDeposit: "0.001", maxRelayFeeBPS: "500" },
  { symbol: "AUDF", token: "0xd2a530170D71a9Cfe1651Fb468E2B98F7Ed7456b", pool: "0x5BC0e0795D5ea842601220bd1f855e60Fad7E3D1", decimals: 6, minimumDeposit: "1", maxRelayFeeBPS: "500" },
];

const CROSS_CURRENCY_ROUTES = [
  { from: "USDC", to: "EURC", rate: "0.92" },
  { from: "EURC", to: "USDC", rate: "1.08" },
];

// HONEST PRIVACY DISCLOSURE (see PRIVACY_DOGFOOD_REPORT.md).
// The Groth16 proof hides which deposit a withdrawal spends (commitment↔nullifier
// link). It does NOT hide amounts: Deposited and Relayed both emit `amount` in
// cleartext, and amounts are arbitrary/user-chosen — so a withdrawal is linkable
// to its deposit by amount-matching, collapsing the anonymity set toward 1.
// Do NOT rely on this for unlinkability until fixed denominations ship.
const PRIVACY_NOTICE = {
  level: "weak",
  hides: "which deposit a withdrawal spends (ZK commitment/nullifier link)",
  leaks:
    "deposit & withdrawal amounts are public and arbitrary — linkable by amount-matching; anonymity set ≈ 1 at current volume",
  crossCurrencyLeak:
    "cross-currency emits both amountIn and amountOut at a fixed rate, so the source amount is recoverable across assets",
  doNotRelyFor: "unlinkability of depositor↔recipient",
  trackedFix: "fixed denominations + anonymity-set gating (see DOGFOOD_PLAN.md Phase 3)",
} as const;

// Relayer submission (fx-telarana packages/relayer-privacy). Submitting the
// signed proof through the relayer makes the RELAYER the on-chain msg.sender,
// so the user's EOA never appears — the meta-tx privacy fix. When unset, agents
// fall back to self-submitting (which reveals their address as the gas-payer).
// NOTE: cross-currency is gated on-chain — relayCrossCurrency reverts
// `SwapAdapterNotSet` until an IFxRouterSwapAdapter ships (FxSwapHook Phase 2.5).
const GHOST_RELAYER_URL = process.env.GHOST_RELAYER_URL ?? "";

function crossCurrencyRelayerSubmission() {
  if (!GHOST_RELAYER_URL) {
    return {
      available: false,
      note: "No relayer configured (GHOST_RELAYER_URL unset). You would self-submit relayCrossCurrency, which makes YOUR address the on-chain msg.sender — a deanonymization leak. Prefer a relayer.",
    };
  }
  return {
    available: true,
    endpoint: `${GHOST_RELAYER_URL}/v1/relayCrossCurrency`,
    method: "POST",
    why: "the relayer broadcasts the tx, so the relayer (not your wallet) is msg.sender — your address never touches the chain",
    onchainStatus: "cross-currency reverts SwapAdapterNotSet until the swap adapter ships (FxSwapHook Phase 2.5)",
    requestShape: {
      scope: "<decimal string>",
      data: { recipient: "0x…", feeRecipient: "0x…", relayFeeBPS: "<string>", buyToken: "0x…", minBuyAmount: "<string>" },
      proof: { pA: ["<s>", "<s>"], pB: [["<s>", "<s>"], ["<s>", "<s>"]], pC: ["<s>", "<s>"], pubSignals: ["<s8>"] },
    },
  };
}

// Same-asset relay (USDC→USDC to a fresh recipient). Unlike cross-currency this
// is UNBLOCKED on-chain today — base relay() needs no swap adapter — so once a
// relayer is deployed this path is fully live. Points at relayer-privacy's
// /v1/relay (the same-asset endpoint).
function sameAssetRelayerSubmission() {
  if (!GHOST_RELAYER_URL) {
    return {
      available: false,
      note: "No relayer configured (GHOST_RELAYER_URL unset). You would self-submit relay(), making YOUR address the on-chain msg.sender — a deanonymization leak. Prefer a relayer.",
    };
  }
  return {
    available: true,
    endpoint: `${GHOST_RELAYER_URL}/v1/relay`,
    method: "POST",
    why: "the relayer broadcasts the tx, so the relayer (not your wallet) is msg.sender — your address never touches the chain",
    onchainStatus: "same-asset relay is unblocked on-chain (no swap adapter needed); live once a relayer is deployed",
    requestShape: {
      scope: "<decimal string>",
      data: { recipient: "0x…", feeRecipient: "0x…", relayFeeBPS: "<string>" },
      proof: { pA: ["<s>", "<s>"], pB: [["<s>", "<s>"], ["<s>", "<s>"]], pC: ["<s>", "<s>"], pubSignals: ["<s8>"] },
    },
  };
}

const ghostPools = route
  .get("/ghost/pools")
  .use(cache({ maxAge: 60, staleWhileRevalidate: 120 }))
  .meta({
    mcp: {
      title: "Ghost Mode — Privacy Pools",
      description:
        "List all 6 shielded pools on Arc (USDC, EURC, MXNB, QCAD, cirBTC, AUDF). The Groth16 layer hides WHICH deposit a withdrawal spends, but amounts are public and arbitrary, so deposits and withdrawals are currently LINKABLE by amount-matching — treat this as weak/experimental privacy, not unlinkability. Returns TVL, merkle root, cross-currency routes, and a privacyNotice describing the current limits.",
    },
  })
  .handle(async () => {
    let latestRoot: string | null = null;
    try {
      const root = await arcClient.readContract({
        address: PRIVACY_ENTRYPOINT,
        abi: fxPrivacyEntrypointAbi,
        functionName: "latestRoot",
      });
      latestRoot = String(root);
    } catch {}

    return ok({
      chainId: ARC_CHAIN_ID,
      entrypoint: PRIVACY_ENTRYPOINT,
      latestRoot,
      pools: POOLS.map((p) => ({
        symbol: p.symbol,
        token: p.token,
        pool: p.pool,
        minimumDeposit: `${p.minimumDeposit} ${p.symbol}`,
        maxRelayFeeBPS: p.maxRelayFeeBPS,
        status: "live",
      })),
      crossCurrencyRoutes: CROSS_CURRENCY_ROUTES,
      proofSystem: "Groth16 (snarkjs)",
      note: "Deposits are public (on-chain event reveals depositor + amount). The ZK proof hides which deposit a later withdrawal spends, but withdrawal amounts are public — so deposits and withdrawals are linkable by amount-matching at current volume. See privacyNotice.",
      privacyNotice: PRIVACY_NOTICE,
    });
  });

const ghostDeposit = route
  .post("/ghost/deposit")
  .body(
    z.object({
      symbol: z.enum(["USDC", "EURC", "MXNB", "QCAD", "cirBTC", "AUDF"]),
      amount: z.string().regex(/^\d+(\.\d+)?$/),
      depositor: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
      trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    }).refine(
      (d) => d.depositor || d.trader,
      { message: "depositor or trader address is required" },
    ).transform((d) => ({ ...d, depositor: d.depositor ?? d.trader! })),
  )
  .meta({
    mcp: {
      title: "Ghost Mode — Shield Tokens",
      description:
        "Deposit tokens into a shielded pool. The deposit event is PUBLIC (reveals depositor + amount). Withdrawal requires a Groth16 proof that hides which deposit it spends — but because withdrawal amounts are also public and arbitrary, a withdrawal is linkable back to this deposit by amount-matching. Use only for experimental/weak privacy; see privacyNotice. Returns the contract call parameters for the deposit transaction.",
    },
  })
  .handle(async ({ body }) => {
    const pool = POOLS.find((p) => p.symbol === body.symbol);
    if (!pool) return ok({ error: `Unknown pool: ${body.symbol}` });

    const amountAtomic = BigInt(Math.floor(parseFloat(body.amount) * 10 ** pool.decimals));

    return ok({
      action: "ghost_deposit",
      symbol: body.symbol,
      amount: body.amount,
      amountAtomic: amountAtomic.toString(),
      depositor: body.depositor,
      contract: {
        address: PRIVACY_ENTRYPOINT,
        function: "deposit(address _asset, uint256 _value, uint256 _precommitment)",
        args: {
          _asset: pool.token,
          _value: amountAtomic.toString(),
          _precommitment: "generate client-side with snarkjs — hash(secret, nullifier)",
        },
      },
      pool: pool.pool,
      chainId: ARC_CHAIN_ID,
      note: "The precommitment must be generated client-side using snarkjs. The commitment = hash(precommitment, amount, asset). Store the secret and nullifier — they are needed for withdrawal.",
    });
  });

const ghostRelay = route
  .post("/ghost/relay")
  .body(
    z.object({
      symbol: z.enum(["USDC", "EURC", "MXNB", "QCAD", "cirBTC", "AUDF"]),
      recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
      trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
      amount: z.string().regex(/^\d+(\.\d+)?$/),
    }).refine(
      (d) => d.recipient || d.trader,
      { message: "recipient or trader address is required" },
    ).transform((d) => ({ ...d, recipient: d.recipient ?? d.trader! })),
  )
  .meta({
    mcp: {
      title: "Ghost Mode — Private Withdrawal",
      description:
        "Withdraw tokens from a shielded pool via a client-side Groth16 proof (verifies merkle inclusion + nullifier uniqueness + recipient). The proof hides WHICH deposit is being spent — but it does NOT hide the amount: the Relayed event emits the recipient and amount in cleartext, so the withdrawal is linkable to a same-amount deposit. This does NOT currently give depositor↔recipient unlinkability. See privacyNotice. Returns the contract parameters and proof requirements.",
    },
  })
  .handle(async ({ body }) => {
    const pool = POOLS.find((p) => p.symbol === body.symbol);
    if (!pool) return ok({ error: `Unknown pool: ${body.symbol}` });

    let latestRoot: string | null = null;
    try {
      const root = await arcClient.readContract({
        address: PRIVACY_ENTRYPOINT,
        abi: fxPrivacyEntrypointAbi,
        functionName: "latestRoot",
      });
      latestRoot = String(root);
    } catch {}

    return ok({
      action: "ghost_relay",
      symbol: body.symbol,
      recipient: body.recipient,
      amount: body.amount,
      contract: {
        address: PRIVACY_ENTRYPOINT,
        function: "relay(tuple _w, tuple _p, uint256 _scope)",
        proofInputs: {
          root: latestRoot,
          nullifier: "derive from secret used in deposit",
          recipient: body.recipient,
          relayer: "submit via the relayer (see relayerSubmission) so the relayer is msg.sender, not you",
          fee: "0",
        },
        proofCircuit: "Groth16 via snarkjs — circuit verifies merkle inclusion + nullifier uniqueness",
      },
      pool: pool.pool,
      chainId: ARC_CHAIN_ID,
      maxRelayFeeBPS: pool.maxRelayFeeBPS,
      relayerSubmission: sameAssetRelayerSubmission(),
      privacyNotice: PRIVACY_NOTICE,
    });
  });

const ghostSwap = route
  .post("/ghost/swap")
  .body(
    z.object({
      from: z.enum(["USDC", "EURC"]),
      to: z.enum(["USDC", "EURC"]),
      amount: z.string().regex(/^\d+(\.\d+)?$/),
      recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
      trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    }).refine(
      (d) => d.recipient || d.trader,
      { message: "recipient or trader address is required" },
    ).transform((d) => ({ ...d, recipient: d.recipient ?? d.trader! })),
  )
  .meta({
    mcp: {
      title: "Ghost Mode — Private Cross-Currency Swap",
      description:
        "Swap between USDC and EURC inside the shielded pool via relayCrossCurrency. WARNING: this leaks MORE than a same-asset withdrawal — the CrossCurrencyRelayed event emits both amountIn and amountOut at a fixed published rate (1 USDC → 0.92 EURC), so the source amount is recoverable and the swap is linkable across assets. Does not hide the trader in practice. See privacyNotice.",
    },
  })
  .handle(async ({ body }) => {
    if (body.from === body.to) return ok({ error: "from and to must differ" });

    const route = CROSS_CURRENCY_ROUTES.find((r) => r.from === body.from && r.to === body.to);
    if (!route) return ok({ error: `No cross-currency route: ${body.from} → ${body.to}` });

    const estimatedOut = (parseFloat(body.amount) * parseFloat(route.rate)).toFixed(6);

    return ok({
      action: "ghost_cross_currency_swap",
      from: body.from,
      to: body.to,
      amountIn: body.amount,
      estimatedOut,
      rate: route.rate,
      recipient: body.recipient,
      contract: {
        address: PRIVACY_ENTRYPOINT,
        function: "relayCrossCurrency(tuple _w, tuple _p, uint256 _scope)",
        note: "Same Groth16 proof as relay, but the swap adapter handles the cross-currency conversion atomically.",
      },
      chainId: ARC_CHAIN_ID,
      relayerSubmission: crossCurrencyRelayerSubmission(),
      privacyNotice: PRIVACY_NOTICE,
    });
  });

const ghostPnl = route
  .post("/ghost/pnl")
  .body(
    z.object({
      trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      threshold: z.string().regex(/^-?\d+(\.\d+)?$/).optional(),
    }),
  )
  .meta({
    mcp: {
      title: "Ghost Mode — ZK PnL Attestation",
      description:
        "Attest that a trader's PnL exceeds a threshold via a commitment-based net-flow proof (deposits − withdrawals). CAVEAT: net flow is only as private as the underlying deposits/withdrawals, and those are currently public + amount-linkable (see privacyNotice). At present this attestation hides little that a chain analyst couldn't already derive by amount-matching; its privacy improves only once denominations/confidential amounts ship. Useful as a leaderboard primitive, not as a confidentiality guarantee today.",
    },
  })
  .handle(async ({ body }) => {
    return ok({
      action: "ghost_pnl_attestation",
      trader: body.trader,
      threshold: body.threshold ?? "0",
      proofType: "commitment-based net flow",
      how: {
        step1: "Collect all deposit commitments for this trader (public Deposited events)",
        step2: "Collect all relay nullifiers spent by this trader (private — trader provides)",
        step3: "Compute net flow: total deposited - total withdrawn = PnL proxy",
        step4: "Generate Groth16 proof: 'my net flow > threshold' without revealing amounts",
        step5: "Submit proof to leaderboard contract for verification",
      },
      leaderboardIntegration: {
        verifier: "On-chain Groth16 verifier checks the proof",
        ranking: "Trader's rank updates based on verified PnL range",
        privacy: "Leaderboard shows 'PnL > 5%' or 'PnL > 10%' — never exact numbers",
        reputation: "ERC-8004 score factors in verified PnL proofs",
      },
      chainId: ARC_CHAIN_ID,
      note: "Leaderboard shows verified performance bands rather than exact numbers — but the underlying deposits/withdrawals are currently public + amount-linkable, so this is not yet a strong confidentiality guarantee. See privacyNotice.",
      privacyNotice: PRIVACY_NOTICE,
    });
  });

export default new Hyper({ prefix: "/api" }).use([
  ghostPools,
  ghostDeposit,
  ghostRelay,
  ghostSwap,
  ghostPnl,
]);
