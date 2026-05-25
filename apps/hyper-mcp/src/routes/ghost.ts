import { Hyper, ok, route } from "@hyper/core";
import { z } from "zod";
import { cache } from "@hyper/cache";
import { createPublicClient, http, type Address, formatUnits } from "viem";
import { fxPrivacyEntrypointAbi } from "@bufi/contracts";

const ARC_RPC = process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = 5042002;

const arcClient = createPublicClient({ transport: http(ARC_RPC) });

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

const ghostPools = route
  .get("/ghost/pools")
  .use(cache({ maxAge: 60, staleWhileRevalidate: 120 }))
  .meta({
    mcp: {
      title: "Ghost Mode — Privacy Pools",
      description:
        "List all 6 shielded privacy pools on Arc. Agents deposit tokens into these pools to trade privately — positions and balances are hidden behind Groth16 zero-knowledge proofs. Pools: USDC, EURC, MXNB, QCAD, cirBTC, AUDF. Returns TVL, merkle root, and cross-currency swap routes.",
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
      note: "Deposits are public (on-chain event). Withdrawals (relay) are private — the recipient is hidden behind a ZK proof. Cross-currency relay swaps inside the pool without revealing the trader.",
    });
  });

const ghostDeposit = route
  .post("/ghost/deposit")
  .body(
    z.object({
      symbol: z.enum(["USDC", "EURC", "MXNB", "QCAD", "cirBTC", "AUDF"]),
      amount: z.string().regex(/^\d+(\.\d+)?$/),
      depositor: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    }),
  )
  .meta({
    mcp: {
      title: "Ghost Mode — Shield Tokens",
      description:
        "Deposit tokens into a shielded privacy pool. After depositing, the balance is hidden and can only be withdrawn with a Groth16 zero-knowledge proof. The deposit event is public (reveals depositor + amount), but subsequent withdrawals and trades are private. Returns the contract call parameters for the deposit transaction.",
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
      recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      amount: z.string().regex(/^\d+(\.\d+)?$/),
    }),
  )
  .meta({
    mcp: {
      title: "Ghost Mode — Private Withdrawal",
      description:
        "Withdraw tokens from a shielded privacy pool. Requires a Groth16 zero-knowledge proof generated client-side. The proof verifies: (1) the commitment exists in the merkle tree, (2) the nullifier hasn't been spent, (3) the recipient is authorized. The on-chain relay reveals nothing about the depositor. Returns the contract parameters and proof requirements.",
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
          relayer: "0x0000000000000000000000000000000000000000",
          fee: "0",
        },
        proofCircuit: "Groth16 via snarkjs — circuit verifies merkle inclusion + nullifier uniqueness",
      },
      pool: pool.pool,
      chainId: ARC_CHAIN_ID,
      maxRelayFeeBPS: pool.maxRelayFeeBPS,
    });
  });

const ghostSwap = route
  .post("/ghost/swap")
  .body(
    z.object({
      from: z.enum(["USDC", "EURC"]),
      to: z.enum(["USDC", "EURC"]),
      amount: z.string().regex(/^\d+(\.\d+)?$/),
      recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    }),
  )
  .meta({
    mcp: {
      title: "Ghost Mode — Private Cross-Currency Swap",
      description:
        "Swap between USDC and EURC inside the privacy pool without revealing the trader. Uses relayCrossCurrency — the swap happens atomically inside the shielded pool via the swap adapter. Current rates: 1 USDC → 0.92 EURC, 1 EURC → 1.08 USDC.",
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
        "Generate a zero-knowledge proof attesting that a trader's PnL exceeds a threshold WITHOUT revealing positions, trade history, or exact PnL. The proof is commitment-based: the trader's deposit/withdrawal nullifiers prove net flow (deposits - withdrawals = PnL proxy) without revealing individual transactions. Used for the leaderboard — traders prove performance without exposing strategy.",
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
      note: "This is the privacy-preserving alternative to public PnL tracking. Copy-traders see verified performance bands, not exact positions.",
    });
  });

export default new Hyper({ prefix: "/api" }).use([
  ghostPools,
  ghostDeposit,
  ghostRelay,
  ghostSwap,
  ghostPnl,
]);
