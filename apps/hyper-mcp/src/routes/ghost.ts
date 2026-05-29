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
  offChain:
    "even when the on-chain commitment/nullifier link is hidden, a SINGLE MCP operator that serves both /ghost/deposit (sees depositor + amount) and /ghost/relay (sees recipient + amount) can correlate the two legs OFF-CHAIN by timing + amount, regardless of the ZK proof. The MCP cannot break this for you. Integrators wanting depositor↔recipient unlinkability MUST split operators (use one operator for deposit-advice and a different, independent one for relay submission) or run their own MCP + relayer.",
  trackedFix:
    "fixed denominations + anonymity-set gating — deposits/withdrawals are constrained to shared amount buckets so more than one deposit matches each withdrawal, lifting the anonymity set above 1",
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

// ── Response schemas (G1) ───────────────────────────────────────────────────
// Declared via .output() so /openapi.json carries the real 200 body shape — a
// cold-start agent learns the contract (incl. relayerSubmission + privacyNotice)
// without blind-calling. Doc-only: keep these matching the handler returns.
const zPrivacyNotice = z.object({
  level: z.string(),
  hides: z.string(),
  leaks: z.string(),
  crossCurrencyLeak: z.string(),
  doNotRelyFor: z.string(),
  offChain: z.string(),
  trackedFix: z.string(),
});

// relayerSubmission is a discriminated shape: { available:false, note } when no
// relayer is configured, else { available:true, endpoint, method, ... }. Modeled
// with all non-`available` fields optional so both variants validate.
const zRelayerSubmission = z.object({
  available: z.boolean(),
  note: z.string().optional(),
  endpoint: z.string().optional(),
  method: z.string().optional(),
  why: z.string().optional(),
  onchainStatus: z.string().optional(),
  requestShape: z.record(z.any()).optional(),
});

const zPoolsOutput = z.object({
  chainId: z.number(),
  entrypoint: z.string(),
  latestRoot: z.string().nullable(),
  pools: z.array(
    z.object({
      symbol: z.string(),
      token: z.string(),
      pool: z.string(),
      minimumDeposit: z.string(),
      maxRelayFeeBPS: z.string(),
      status: z.string(),
    }),
  ),
  crossCurrencyRoutes: z.array(z.object({ from: z.string(), to: z.string(), rate: z.string() })),
  proofSystem: z.string(),
  note: z.string(),
  privacyNotice: zPrivacyNotice,
});

const zDepositOutput = z.object({
  action: z.literal("ghost_deposit"),
  symbol: z.string(),
  amountAtomic: z.string(),
  contract: z.object({
    address: z.string(),
    function: z.string(),
    args: z.object({ _asset: z.string(), _value: z.string(), _precommitment: z.string() }),
  }),
  pool: z.string(),
  chainId: z.number(),
  note: z.string(),
  privacyNotice: zPrivacyNotice,
});

const zRelayOutput = z.object({
  action: z.literal("ghost_relay"),
  symbol: z.string(),
  contract: z.object({
    address: z.string(),
    function: z.string(),
    proofInputs: z.object({
      root: z.string().nullable(),
      nullifier: z.string(),
      recipient: z.string(),
      relayer: z.string(),
      fee: z.string(),
    }),
    proofCircuit: z.string(),
  }),
  pool: z.string(),
  chainId: z.number(),
  maxRelayFeeBPS: z.string(),
  relayerSubmission: zRelayerSubmission,
  privacyNotice: zPrivacyNotice,
});

const zSwapOutput = z.object({
  action: z.literal("ghost_cross_currency_swap"),
  from: z.string(),
  to: z.string(),
  estimatedOut: z.string(),
  rate: z.string(),
  recipient: z.string(),
  contract: z.object({ address: z.string(), function: z.string(), note: z.string() }),
  chainId: z.number(),
  relayerSubmission: zRelayerSubmission,
  privacyNotice: zPrivacyNotice,
});

const zPnlOutput = z.object({
  action: z.literal("ghost_pnl_attestation"),
  trader: z.string(),
  threshold: z.string(),
  proofType: z.string(),
  how: z.object({
    step1: z.string(),
    step2: z.string(),
    step3: z.string(),
    step4: z.string(),
    step5: z.string(),
  }),
  leaderboardIntegration: z.object({
    verifier: z.string(),
    ranking: z.string(),
    privacy: z.string(),
    reputation: z.string(),
  }),
  chainId: z.number(),
  note: z.string(),
  privacyNotice: zPrivacyNotice,
});

const zPrivacyCheckOutput = z.object({
  action: z.literal("ghost_privacy_check"),
  input: z.object({
    amount: z.string(),
    recipientIsFresh: z.boolean(),
    willUseRelayer: z.boolean(),
    secondsSinceDeposit: z.number().nullable(),
  }),
  score: z.number().int().min(0).max(100),
  level: z.enum(["best-effort-clean", "weak", "poor", "deanonymizing"]),
  risks: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(["critical", "high", "medium", "low"]),
      detail: z.string(),
      fix: z.string(),
    }),
  ),
  summary: z.string(),
  bestEffortDisclaimer: z.string(),
  privacyNotice: zPrivacyNotice,
});

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
  .output(zPoolsOutput)
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
  .output(zDepositOutput)
  .handle(async ({ body }) => {
    const pool = POOLS.find((p) => p.symbol === body.symbol);
    if (!pool) return ok({ error: `Unknown pool: ${body.symbol}` });

    const amountAtomic = BigInt(Math.floor(parseFloat(body.amount) * 10 ** pool.decimals));

    return ok({
      action: "ghost_deposit",
      symbol: body.symbol,
      amountAtomic: amountAtomic.toString(),
      contract: {
        address: PRIVACY_ENTRYPOINT,
        function: "deposit(address _asset, uint256 _value, uint256 _precommitment)",
        args: {
          _asset: pool.token,
          _value: amountAtomic.toString(),
          _precommitment: "Poseidon([nullifier, secret]) — the precommitment hash, computed client-side with Poseidon (NOT snarkjs)",
        },
      },
      pool: pool.pool,
      chainId: ARC_CHAIN_ID,
      note: "precommitment = Poseidon([nullifier, secret]) (a Poseidon hash, NOT snarkjs). On deposit the pool derives the leaf commitment = Poseidon([value, label, precommitment]); snarkjs is only used later for the Groth16 WITHDRAWAL proof, never for the deposit. Generate your own nullifier + secret, store them offline — they are unrecoverable and required to withdraw. See the 'Constructing a ghost proof' section of llms.txt for the full flow.",
      privacyNotice: PRIVACY_NOTICE,
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
  .output(zRelayOutput)
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
  .output(zSwapOutput)
  .handle(async ({ body }) => {
    if (body.from === body.to) return ok({ error: "from and to must differ" });

    const route = CROSS_CURRENCY_ROUTES.find((r) => r.from === body.from && r.to === body.to);
    if (!route) return ok({ error: `No cross-currency route: ${body.from} → ${body.to}` });

    const estimatedOut = (parseFloat(body.amount) * parseFloat(route.rate)).toFixed(6);

    return ok({
      action: "ghost_cross_currency_swap",
      from: body.from,
      to: body.to,
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
  .output(zPnlOutput)
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

// ============================================================================
// ghost_privacy_check — PLAN-TIME PRIVACY LINTER (pure function, no chain calls)
// Scores a PLANNED ghost action for linkability BEFORE the user commits. Only
// checks the behavioral knobs that move the needle today (amount shape,
// recipient freshness, relayer-vs-self-submit, deposit→withdraw timing); it
// cannot raise the cryptographic floor (amounts public+arbitrary → set ≈ 1).
// ============================================================================

// No on-chain mixing window is enforced (registeredAt is stored but unused);
// this is a behavioral heuristic, not an enforced guarantee.
const GHOST_MIN_MIX_SECONDS = 3600; // 1h — adjacent-block deposit+withdraw is worst case

function amountLooksUnique(amount: string): boolean {
  const trimmed = amount.replace(/0+$/, "").replace(/\.$/, "");
  const sigDecimals = trimmed.indexOf(".") === -1 ? 0 : trimmed.length - trimmed.indexOf(".") - 1;
  return sigDecimals > 2;
}

type GhostRisk = {
  code: string;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
  fix: string;
};

const ghostPrivacyCheck = route
  .post("/ghost/privacy-check")
  .body(
    z.object({
      amount: z.string().regex(/^\d+(\.\d+)?$/),
      recipientIsFresh: z.boolean(),
      willUseRelayer: z.boolean(),
      secondsSinceDeposit: z.number().int().nonnegative().optional(),
    }),
  )
  .meta({
    mcp: {
      title: "Ghost Mode — Privacy Linter (plan check)",
      description:
        "Lint a PLANNED ghost withdrawal/swap for linkability BEFORE you commit it on-chain. Pure scoring, no chain calls. Pass the amount, whether the recipient address is brand-new (never used before), whether you'll submit through the relayer, and optionally how many seconds will have elapsed since the matching deposit. Returns a score 0-100 (higher = less linkable), a level, and concrete risks with fixes. IMPORTANT: only checks BEHAVIORAL knobs that work today; it cannot fix that amounts are public and arbitrary (anonymity set ≈ 1 by amount-matching), and cannot confirm a relayer is deployed (check relayerSubmission.available). A high score means 'you avoided the self-inflicted leaks you control', NOT 'unlinkable'. See privacyNotice.",
    },
  })
  .output(zPrivacyCheckOutput)
  .handle(async ({ body }) => {
    const risks: GhostRisk[] = [];
    let score = 100;

    if (amountLooksUnique(body.amount)) {
      score -= 35;
      risks.push({
        code: "AMOUNT_FINGERPRINT",
        severity: "high",
        detail:
          `Amount "${body.amount}" has high precision, making it ~unique on-chain. Deposit & withdrawal amounts are public, so a unique amount links this withdrawal to your deposit by exact amount-matching — anonymity set ≈ 1.`,
        fix: "Use a round, common amount (e.g. 100, not 100.4732) so you share a bucket with other deposits. Best effort only until fixed denominations ship.",
      });
    } else {
      risks.push({
        code: "AMOUNT_PUBLIC_BASELINE",
        severity: "medium",
        detail:
          "Even a round amount is emitted in cleartext and is arbitrary, so amount-matching still applies — and a round amount can still be unique by magnitude if no other deposit shares it.",
        fix: "No reliable client-side fix; the real fix is fixed denominations + anonymity-set gating (tracked). Prefer an amount you can confirm others have deposited.",
      });
    }

    if (!body.recipientIsFresh) {
      score -= 30;
      risks.push({
        code: "RECIPIENT_CLUSTERING",
        severity: "high",
        detail:
          "Recipient address is not fresh. Reusing an address clusters this withdrawal with your other activity, defeating the shielded hop.",
        fix: "Withdraw to a brand-new address you have never used and will not reuse for unrelated activity.",
      });
    }

    if (!body.willUseRelayer) {
      score -= 30;
      risks.push({
        code: "MSG_SENDER_LEAK",
        severity: "critical",
        detail:
          "Self-submitting relay()/relayCrossCurrency() makes YOUR EOA the on-chain msg.sender and gas-payer, directly tying the withdrawal to your wallet. This is the single largest leak you can avoid off-chain.",
        fix: "Submit through the relayer. FIRST verify it exists: ghost_relay/ghost_swap return relayerSubmission.available — if false (GHOST_RELAYER_URL unset), no relayer is deployed and you cannot avoid this leak today.",
      });
    } else {
      risks.push({
        code: "MSG_SENDER_RELAYER_UNVERIFIED",
        severity: "low",
        detail:
          "You plan to use the relayer, which (if deployed) makes the relayer msg.sender. This linter cannot confirm a relayer is actually running (GHOST_RELAYER_URL may be unset → relayerSubmission.available=false → you self-submit and incur the full leak).",
        fix: "Confirm relayerSubmission.available === true on the ghost_relay/ghost_swap response before relying on this.",
      });
    }

    if (body.secondsSinceDeposit !== undefined) {
      if (body.secondsSinceDeposit < GHOST_MIN_MIX_SECONDS) {
        score -= 20;
        risks.push({
          code: "TIMING_CORRELATION",
          severity: "high",
          detail:
            `Only ${body.secondsSinceDeposit}s will have elapsed since the deposit (< ${GHOST_MIN_MIX_SECONDS}s). Deposit and withdrawal in nearby blocks are correlatable by timing; no on-chain mixing window is enforced.`,
          fix: `Wait at least ${GHOST_MIN_MIX_SECONDS}s (and ideally until other deposits land) before withdrawing.`,
        });
      }
    } else {
      risks.push({
        code: "TIMING_UNKNOWN",
        severity: "low",
        detail:
          "secondsSinceDeposit not provided, so timing correlation could not be evaluated. Adjacent-block deposit+withdraw is the worst case and is not prevented on-chain.",
        fix: `Provide secondsSinceDeposit, and aim for ≥ ${GHOST_MIN_MIX_SECONDS}s between deposit and withdrawal.`,
      });
    }

    if (score < 0) score = 0;
    const level =
      score >= 80 ? "best-effort-clean" : score >= 50 ? "weak" : score >= 25 ? "poor" : "deanonymizing";

    return ok({
      action: "ghost_privacy_check",
      input: {
        amount: body.amount,
        recipientIsFresh: body.recipientIsFresh,
        willUseRelayer: body.willUseRelayer,
        secondsSinceDeposit: body.secondsSinceDeposit ?? null,
      },
      score,
      level,
      risks,
      summary:
        risks.length === 0
          ? "No behavioral leaks flagged."
          : `${risks.length} issue(s) found; fix the high/critical ones before committing.`,
      bestEffortDisclaimer:
        "This linter only checks behavioral knobs that work TODAY and only your STATED plan — no chain calls, and it cannot confirm a relayer is deployed (check relayerSubmission.available). It CANNOT raise the cryptographic floor: amounts are public and arbitrary, so the anonymity set is ≈ 1 by amount-matching regardless of score. A high score means 'you avoided self-inflicted leaks', not 'unlinkable'.",
      privacyNotice: PRIVACY_NOTICE,
    });
  });

export default new Hyper({ prefix: "/api" }).use([
  ghostPrivacyCheck,
  ghostPools,
  ghostDeposit,
  ghostRelay,
  ghostSwap,
  ghostPnl,
]);
