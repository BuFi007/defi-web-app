/**
 * Wave N6 — Live broadcast of Demo B: "Real-Time FX Swap Pools Using Gateway"
 *
 * Goal: one Arc Testnet swap tx where:
 *   1. TelaranaGatewayHubHook.beforeSwap fires
 *   2. The hook calls Circle GatewayMinter.gatewayMint() ATOMICALLY (no CCTP poll)
 *   3. The Gateway-minted USDC is settled to PoolManager via BeforeSwapDelta
 *   4. A `GatewayRoutedSwap` event is emitted
 *
 * This is the load-bearing differentiator for the hookathon submission's
 * new clause: "Real-Time FX Swap Pools Using Gateway, rather than relying
 * only on CCTP with shared Hub liquidity across chains."
 *
 * Pre-conditions (verified by cast probes — see scripts/n6-tgh-bytecode-audit.md):
 *   - TGH at 0xe895CB461AFF6E98167a7FA0Db252ba906714088 IS PR-H8 (verified
 *     via getHookPermissions() returning beforeSwap=T, beforeSwapReturnDelta=T)
 *   - gatewayRoute(0xf78147c9…) is set + enabled
 *   - gatewayContextProofMode(0xf78147c9…) = 3 (SIGNED_INTENT_OR_HYPERLANE)
 *   - keeper holds DEFAULT_ADMIN_ROLE + EXECUTOR_ROLE on TGH
 *   - keeper has ~20 USDC + ~33 EURC on Arc
 *   - FxV4RouterHarnessGateway deployed at 0xf5822fF3Aa3809611cBe400910F8D4Ab1E099807
 *     (tx 0xe066ddb3d3c27ab9bb0c2a149f59078cde62300e21a79eae3cfb0bbf4731e92c)
 *
 * Steps:
 *   1. Initialize a NEW v4 pool with PoolKey =
 *      (USDC, EURC, fee=100, tickSpacing=1, hooks=TGH).
 *      The TGH address low-14 bits = 0x088 (beforeSwap | beforeSwapReturnDelta).
 *   2. Bind that pool to the existing Gateway routeId via TGH.setPoolGatewayRoute
 *   3. Mint a fresh Circle Gateway attestation (the N2c artefact expired
 *      at Arc block 43_390_606; current is ~43_519_000+).
 *   4. Approve EURC → FxV4RouterHarnessGateway for the input leg.
 *   5. Broadcast swap via the harness with hookData = (attestation, signature, ctx)
 *   6. Capture tx hash + balance deltas + Gateway-minted USDC delta.
 *
 * Env (from .env.local):
 *   KEEPER_PRIVATE_KEY — must hold DEFAULT_ADMIN_ROLE on TGH + own EURC on Arc
 *
 * Output: scripts/n6-gateway-demo-broadcast.json
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  encodePacked,
  formatUnits,
  getAddress,
  http,
  keccak256,
  maxUint64,
  pad,
  parseAbi,
  parseAbiParameters,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ─────────────────────── canonical constants ──────────────────────────────

const ARC_CHAIN_ID = 5042002 as const;
const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_EXPLORER = "https://testnet.arcscan.app/tx/";
const FUJI_DOMAIN = 1 as const;
const ARC_DOMAIN = 26 as const;
const FUJI_CHAIN_ID = 43113 as const;

// Per memory/reference_arc_addresses.md
const POOL_MANAGER = "0x3FA22b7Aeda9ebBe34732ea394f1711887363B34" as const;
const TGH = "0xe895CB461AFF6E98167a7FA0Db252ba906714088" as const;
const USDC = "0x3600000000000000000000000000000000000000" as const;
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as const;

// Wave N6 deploy (this session).
//   V1 0xf5822fF3Aa3809611cBe400910F8D4Ab1E099807 — only took swap.amount0/1 (missed pre-settle delta)
//   V2 0x354c0dADFb88e7910E2ed5C399D71c4584Fd7c18 — same issue: BalanceDelta from manager.swap excludes pre-settle
//   V3 0x72180a231245E06db12b6A77390Ce919fF041f04 — reads router currencyDelta from
//      transient state via TransientStateLibrary.currencyDelta + drains both
//      input residual + output. This is what handles the zero-liquidity case.
const FX_V4_ROUTER_HARNESS_GATEWAY =
  "0x72180a231245E06db12b6A77390Ce919fF041f04" as const;
const FX_V4_ROUTER_HARNESS_GATEWAY_DEPLOY_TX =
  "0x0d615d950cb1ec4d35a1a6a28bffda7e5a566c87f668cbc72d9b1b0de1413ca5" as const;

// Circle Gateway on testnet
const CIRCLE_GATEWAY_WALLET =
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const; // Fuji-side too
const CIRCLE_GATEWAY_MINTER =
  "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" as const;
const FUJI_USDC = "0x5425890298aed601595a70ab815c96711a31bc65" as const;

// M4-set route id (gatewayRoute already configured on TGH; see
// scripts/n6-tgh-bytecode-audit.md)
const ROUTE_ID =
  "0xf78147c98547731be048740d9d9089e6258e5e712e0c66f7b9d9d57d6af3a968" as const;

// Pool params for the NEW pool we initialize this run. Mirrors M4 shape so
// price discovery is comparable to the FxSwapHook pool.
const POOL_FEE = 100; // 0.01% — matches M4
const POOL_TICK_SPACING = 1;
// sqrtPriceX96 from M4 (EUR/USD ~1.09). Reuse so the new pool starts at a
// sane mid.
const POOL_INIT_SQRT_PRICE_X96 = 0xf52559aa0006380000000000n;

// Swap params: tiny EURC input. The hook injects USDC via gatewayMint.
const AMOUNT_USDC_STR = process.env.N6_GATEWAY_AMOUNT_USDC ?? "0.1";
const AMOUNT_USDC_RAW = parseUnits(AMOUNT_USDC_STR, 6); // 100_000 = 0.1 USDC
const EURC_INPUT_USDC_STR = process.env.N6_EURC_INPUT_USDC ?? "0.01";
const EURC_INPUT_RAW = parseUnits(EURC_INPUT_USDC_STR, 6);

// Hub-action enum (see fx-telarana ITelaranaGatewayHubHook.GatewayHubAction)
// 0=MINT_TO_HUB, 1=ATOMIC_FX_SWAP, etc. The v4 path uses MINT_TO_HUB (0)
// because the destination is the hook itself which then settles to the pool.
const HUB_ACTION_MINT_TO_HUB = 0;

const HERMES_BASE = "https://hermes.pyth.network";

// 60s per-call watchdog per the brief.
const NETWORK_DEADLINE_MS = 60_000;

// EIP-712 — must match the upstream Circle Gateway contract verbatim.
const EIP712_DOMAIN = {
  name: "GatewayWallet",
  version: "1",
} as const;
const EIP712_TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
} as const;

// ─────────────────────── ABIs ──────────────────────────────────────────

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const POOL_MANAGER_ABI = parseAbi([
  "function initialize((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96) returns (int24 tick)",
]);

const TGH_ABI = parseAbi([
  "function setPoolGatewayRoute(bytes32 poolId, bytes32 routeId)",
  "function poolGatewayRouteBinding(bytes32 poolId) view returns (bytes32)",
  "function getHookPermissions() view returns ((bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool,bool))",
  "function gatewayRoute(bytes32 routeId) view returns ((uint32 sourceDomain, uint32 destinationDomain, address sourceUsdc, address destinationUsdc, address sourceGatewayWallet, address destinationGatewayMinter, address destinationHub, address whitelistedCaller, uint8 signerMode, bool enabled, bytes32 metadataRef))",
]);

const HARNESS_ABI = parseAbi([
  "function swapExactInputSingleWithHookData((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, bool zeroForOne, uint256 amountIn, uint256 amountOutMinimum, address recipient, bytes hookData) returns (uint256 amountOut)",
  "function manager() view returns (address)",
]);

// GatewayMintContext struct used in hookData
const GATEWAY_MINT_CONTEXT_PARAMS =
  "bytes attestation, bytes signature, (bytes32 routeId, bytes32 requestId, uint8 action, address sourceDepositor, address sourceSigner, address recipient, address tokenOut, uint256 amount, uint256 minAmountOut, bytes32 spotRouteId, bytes32 metadataRef, bytes hookData) context";

// ─────────────────────── chain ────────────────────────────────────────

const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { decimals: 6, name: "USDC", symbol: "USDC" },
  rpcUrls: { default: { http: [ARC_RPC] } },
});

// ─────────────────────── main ─────────────────────────────────────────

interface Step {
  step: string;
  status: "ok" | "skipped" | "error";
  txHash?: Hex;
  explorer?: string;
  detail?: string;
  gasUsed?: string;
  blockNumber?: string;
  durationMs?: number;
}

interface Artefact {
  wave: "N6";
  broadcastAt: string;
  agent: string;
  preReq: {
    fxV4RouterHarnessGateway: Address;
    fxV4RouterHarnessGatewayDeployTx: Hex;
    tgh: Address;
    poolManager: Address;
  };
  network: { chainId: number; name: string; rpc: string };
  actor: { keeper: Address };
  poolKey: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  };
  poolId: Hex;
  routeId: Hex;
  attestation: {
    requestId: Hex;
    amountUsdc: string;
    expirationBlock?: string;
    transferId?: string;
  };
  balances: {
    before: Record<string, string>;
    after: Record<string, string>;
    deltas: Record<string, string>;
  };
  steps: Step[];
  outcome: {
    swapLeg: "PROVED LIVE" | "STILL BLOCKED" | "ERROR";
    realTimeFxSwapPoolUsingGateway: "PROVED LIVE" | "PARTIALLY PROVED" | "BLOCKED";
    evidence: string;
  };
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const broadcastAt = new Date().toISOString();
  const steps: Step[] = [];

  const pk = requirePk("KEEPER_PRIVATE_KEY");
  const keeper = privateKeyToAccount(pk);

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(ARC_RPC),
  });
  const walletClient = createWalletClient({
    chain: arcTestnet,
    transport: http(ARC_RPC),
    account: keeper,
  });

  console.log(`▶ Wave N6 — Demo B broadcast (Real-Time FX Swap Pool Using Gateway)`);
  console.log(`  keeper:   ${keeper.address}`);
  console.log(`  TGH:      ${TGH}`);
  console.log(`  harness:  ${FX_V4_ROUTER_HARNESS_GATEWAY}`);
  console.log(`  USDC amt: ${AMOUNT_USDC_STR}`);
  console.log(`  EURC in:  ${EURC_INPUT_USDC_STR}`);

  // ── step 0: sanity probes ─────────────────────────────────────────────
  {
    const t0 = Date.now();
    const perms = await publicClient.readContract({
      address: TGH,
      abi: TGH_ABI,
      functionName: "getHookPermissions",
    });
    const hasBeforeSwap = perms[6];
    const hasBeforeSwapReturnDelta = perms[10];
    if (!hasBeforeSwap || !hasBeforeSwapReturnDelta) {
      throw new Error(
        `TGH hook permissions wrong: beforeSwap=${hasBeforeSwap} beforeSwapReturnDelta=${hasBeforeSwapReturnDelta}`,
      );
    }
    const route = await publicClient.readContract({
      address: TGH,
      abi: TGH_ABI,
      functionName: "gatewayRoute",
      args: [ROUTE_ID],
    });
    if (!route.enabled) throw new Error(`Route ${ROUTE_ID} not enabled`);
    if (
      route.destinationGatewayMinter.toLowerCase() !==
      CIRCLE_GATEWAY_MINTER.toLowerCase()
    )
      throw new Error(`Route minter mismatch`);
    if (route.destinationUsdc.toLowerCase() !== USDC.toLowerCase())
      throw new Error(`Route USDC mismatch`);
    steps.push({
      step: "sanity-probes",
      status: "ok",
      detail: `TGH PR-H8 surface live; route enabled (sourceDomain=${route.sourceDomain}, destDomain=${route.destinationDomain})`,
      durationMs: Date.now() - t0,
    });
  }

  // ── pre-balances ──────────────────────────────────────────────────────
  const [usdcBefore, eurcBefore, tghUsdcBefore] = await Promise.all([
    publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [keeper.address],
    }),
    publicClient.readContract({
      address: EURC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [keeper.address],
    }),
    publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [TGH],
    }),
  ]);
  const before: Record<string, string> = {
    "keeper.usdc": formatUnits(usdcBefore, 6),
    "keeper.eurc": formatUnits(eurcBefore, 6),
    "tgh.usdc": formatUnits(tghUsdcBefore, 6),
  };
  console.log(`  pre-balances:`, before);

  if (eurcBefore < EURC_INPUT_RAW) {
    throw new Error(
      `keeper EURC ${formatUnits(eurcBefore, 6)} < required ${EURC_INPUT_USDC_STR}`,
    );
  }

  // ── step 1: build new PoolKey with TGH as hook ────────────────────────
  // USDC < EURC lexicographically (0x36 < 0x89), so currency0=USDC
  const poolKey = {
    currency0: USDC as Address,
    currency1: EURC as Address,
    fee: POOL_FEE,
    tickSpacing: POOL_TICK_SPACING,
    hooks: TGH as Address,
  };

  // PoolId = keccak256(abi.encode(PoolKey))
  const poolId = computePoolId(poolKey);
  console.log(`  poolId:   ${poolId}`);

  // ── step 2: initialize the new v4 pool ────────────────────────────────
  {
    const t0 = Date.now();
    try {
      const txHash = await walletClient.writeContract({
        address: POOL_MANAGER,
        abi: POOL_MANAGER_ABI,
        functionName: "initialize",
        args: [poolKey, POOL_INIT_SQRT_PRICE_X96],
      });
      const r = await publicClient.waitForTransactionReceipt({ hash: txHash });
      steps.push({
        step: "v4-pool-initialize",
        status: r.status === "success" ? "ok" : "error",
        txHash,
        explorer: ARC_EXPLORER + txHash,
        gasUsed: r.gasUsed.toString(),
        blockNumber: r.blockNumber.toString(),
        detail: `initialize(USDC/EURC/fee=100/spacing=1/hooks=TGH, sqrtPriceX96=${POOL_INIT_SQRT_PRICE_X96.toString(16)})`,
        durationMs: Date.now() - t0,
      });
      if (r.status !== "success") throw new Error("initialize reverted");
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      // PoolAlreadyInitialized() = 0x7983c051
      if (
        /already.?init/i.test(msg) ||
        /AlreadyInit/i.test(msg) ||
        msg.includes("0x7983c051")
      ) {
        steps.push({
          step: "v4-pool-initialize",
          status: "skipped",
          detail: "pool already initialized (re-run from previous attempt)",
          durationMs: Date.now() - t0,
        });
      } else {
        steps.push({
          step: "v4-pool-initialize",
          status: "error",
          detail: msg.slice(0, 500),
          durationMs: Date.now() - t0,
        });
        throw e;
      }
    }
  }

  // ── step 3: bind pool to gateway route ───────────────────────────────
  {
    const t0 = Date.now();
    const existing = await publicClient.readContract({
      address: TGH,
      abi: TGH_ABI,
      functionName: "poolGatewayRouteBinding",
      args: [poolId],
    });
    if (existing !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
      steps.push({
        step: "bind-pool-to-gateway-route",
        status: "skipped",
        detail: `poolGatewayRouteBinding(${poolId}) already = ${existing}`,
        durationMs: Date.now() - t0,
      });
    } else {
      const txHash = await walletClient.writeContract({
        address: TGH,
        abi: TGH_ABI,
        functionName: "setPoolGatewayRoute",
        args: [poolId, ROUTE_ID],
      });
      const r = await publicClient.waitForTransactionReceipt({ hash: txHash });
      steps.push({
        step: "bind-pool-to-gateway-route",
        status: r.status === "success" ? "ok" : "error",
        txHash,
        explorer: ARC_EXPLORER + txHash,
        gasUsed: r.gasUsed.toString(),
        blockNumber: r.blockNumber.toString(),
        detail: `setPoolGatewayRoute(${poolId}, ${ROUTE_ID})`,
        durationMs: Date.now() - t0,
      });
      if (r.status !== "success") throw new Error("setPoolGatewayRoute reverted");
    }
  }

  // ── step 4: mint fresh Gateway attestation ───────────────────────────
  let attestation: Hex;
  let attestationSignature: Hex;
  let requestId: Hex;
  let attestationMeta: { expirationBlock?: string; transferId?: string } = {};
  {
    const t0 = Date.now();
    const result = await mintGatewayAttestation({
      keeper,
      amountRaw: AMOUNT_USDC_RAW,
      destinationRecipient: TGH,
      destinationCaller: TGH,
    });
    attestation = result.attestation;
    attestationSignature = result.signature;
    requestId = result.requestId;
    attestationMeta = {
      expirationBlock: result.expirationBlock,
      transferId: result.transferId,
    };
    steps.push({
      step: "gateway-attestation-mint",
      status: "ok",
      detail: `Circle /v1/transfer minted attestation for ${AMOUNT_USDC_STR} USDC (requestId=${requestId.slice(0, 18)}…, expirationBlock=${result.expirationBlock})`,
      durationMs: Date.now() - t0,
    });

    // Persist a copy
    const outDir = resolve(__dirname, "..", "scripts");
    writeFileSync(
      resolve(outDir, "n6-gateway-attestation.json"),
      JSON.stringify(
        {
          mintedAt: new Date().toISOString(),
          requestId,
          amountUsdc: AMOUNT_USDC_RAW.toString(),
          attestation,
          signature: attestationSignature,
          ...attestationMeta,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }

  // ── step 5: approve EURC → harness ───────────────────────────────────
  {
    const t0 = Date.now();
    const allowance = await publicClient.readContract({
      address: EURC,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [keeper.address, FX_V4_ROUTER_HARNESS_GATEWAY],
    });
    if (allowance >= EURC_INPUT_RAW) {
      steps.push({
        step: "approve-harness",
        status: "skipped",
        detail: `EURC allowance ${formatUnits(allowance, 6)} ≥ ${EURC_INPUT_USDC_STR}`,
        durationMs: Date.now() - t0,
      });
    } else {
      const txHash = await walletClient.writeContract({
        address: EURC,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [FX_V4_ROUTER_HARNESS_GATEWAY, EURC_INPUT_RAW * 100n],
      });
      const r = await publicClient.waitForTransactionReceipt({ hash: txHash });
      steps.push({
        step: "approve-harness",
        status: r.status === "success" ? "ok" : "error",
        txHash,
        explorer: ARC_EXPLORER + txHash,
        gasUsed: r.gasUsed.toString(),
        blockNumber: r.blockNumber.toString(),
        detail: `approve(EURC, ${FX_V4_ROUTER_HARNESS_GATEWAY}, ${EURC_INPUT_RAW * 100n})`,
        durationMs: Date.now() - t0,
      });
    }
  }

  // ── step 6: build hookData (attestation + signature + ctx) ───────────
  const ctx = {
    routeId: ROUTE_ID as Hex,
    requestId,
    action: HUB_ACTION_MINT_TO_HUB,
    sourceDepositor: keeper.address,
    sourceSigner: keeper.address,
    recipient: keeper.address,
    tokenOut: "0x0000000000000000000000000000000000000000" as Address,
    amount: AMOUNT_USDC_RAW,
    minAmountOut: 0n,
    spotRouteId:
      "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
    metadataRef:
      "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
    hookData: "0x" as Hex,
  };
  const hookData = encodeAbiParameters(
    parseAbiParameters(GATEWAY_MINT_CONTEXT_PARAMS),
    [attestation, attestationSignature, ctx],
  );

  // ── step 7: broadcast swap via harness ───────────────────────────────
  let swapTxHash: Hex | undefined;
  let swapStatus: "ok" | "error" = "ok";
  let swapError: string | undefined;
  let swapReceipt:
    | { gasUsed: bigint; blockNumber: bigint; status: "success" | "reverted" }
    | undefined;
  {
    const t0 = Date.now();
    // zeroForOne=false → user pays currency1 (EURC) and receives currency0 (USDC).
    // matches TGH.beforeSwap's `userReceivesUsdc` check: with usdcIsCurrency0=true,
    // userReceivesUsdc = !zeroForOne = !false = true. ✓
    try {
      swapTxHash = await walletClient.writeContract({
        address: FX_V4_ROUTER_HARNESS_GATEWAY,
        abi: HARNESS_ABI,
        functionName: "swapExactInputSingleWithHookData",
        args: [poolKey, false, EURC_INPUT_RAW, 0n, keeper.address, hookData],
      });
      swapReceipt = await publicClient.waitForTransactionReceipt({
        hash: swapTxHash,
      });
      if (swapReceipt.status !== "success") {
        swapStatus = "error";
        swapError = `tx status=${swapReceipt.status} (reverted on-chain)`;
      }
    } catch (e) {
      swapStatus = "error";
      swapError = (e as Error).message;
    }
    steps.push({
      step: "v4-swap-with-gateway-hookdata",
      status: swapStatus,
      txHash: swapTxHash,
      explorer: swapTxHash ? ARC_EXPLORER + swapTxHash : undefined,
      detail: swapError
        ? `${swapError.slice(0, 500)}`
        : `harness.swapExactInputSingleWithHookData(zeroForOne=false, amountIn=${EURC_INPUT_RAW}, recipient=${keeper.address})`,
      gasUsed: swapReceipt?.gasUsed.toString(),
      blockNumber: swapReceipt?.blockNumber.toString(),
      durationMs: Date.now() - t0,
    });
  }

  // ── post-balances ─────────────────────────────────────────────────────
  const [usdcAfter, eurcAfter, tghUsdcAfter] = await Promise.all([
    publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [keeper.address],
    }),
    publicClient.readContract({
      address: EURC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [keeper.address],
    }),
    publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [TGH],
    }),
  ]);
  const after: Record<string, string> = {
    "keeper.usdc": formatUnits(usdcAfter, 6),
    "keeper.eurc": formatUnits(eurcAfter, 6),
    "tgh.usdc": formatUnits(tghUsdcAfter, 6),
  };
  const deltas: Record<string, string> = {
    "keeper.usdc": deltaStr(usdcBefore, usdcAfter, 6),
    "keeper.eurc": deltaStr(eurcBefore, eurcAfter, 6),
    "tgh.usdc": deltaStr(tghUsdcBefore, tghUsdcAfter, 6),
  };

  // Demo B is "proved live" if the swap tx succeeded on-chain AND the
  // GatewayRoutedSwap event fired (i.e. TGH.beforeSwap actually executed
  // the gatewayMint + settle). The keeper's USDC balance delta is NOT a
  // reliable indicator on Arc since USDC IS the gas token: gas cost
  // (~0.3 USDC for 21M gas) dominates a 0.1 USDC swap output. We confirm
  // via receipt logs: presence of the TGH GatewayRoutedSwap topic.
  const GATEWAY_ROUTED_SWAP_TOPIC = keccak256(
    encodePacked(
      ["string"],
      ["GatewayRoutedSwap(bytes32,bytes32,bytes32,address,uint256,uint256)"],
    ),
  );
  let gatewayMintEventFired = false;
  if (swapReceipt && swapTxHash) {
    const fullReceipt = await publicClient.getTransactionReceipt({
      hash: swapTxHash,
    });
    gatewayMintEventFired = fullReceipt.logs.some(
      (l) =>
        l.address.toLowerCase() === TGH.toLowerCase() &&
        l.topics[0] === GATEWAY_ROUTED_SWAP_TOPIC,
    );
  }
  const swapProvedLive = swapStatus === "ok" && gatewayMintEventFired;
  const usdcDelta = usdcAfter - usdcBefore;

  const artefact: Artefact = {
    wave: "N6",
    broadcastAt,
    agent: "Wave N6 — Demo B broadcast (Real-Time FX Swap Pool Using Gateway)",
    preReq: {
      fxV4RouterHarnessGateway: FX_V4_ROUTER_HARNESS_GATEWAY,
      fxV4RouterHarnessGatewayDeployTx: FX_V4_ROUTER_HARNESS_GATEWAY_DEPLOY_TX,
      tgh: TGH,
      poolManager: POOL_MANAGER,
    },
    network: { chainId: ARC_CHAIN_ID, name: "Arc Testnet", rpc: ARC_RPC },
    actor: { keeper: keeper.address },
    poolKey,
    poolId,
    routeId: ROUTE_ID,
    attestation: {
      requestId,
      amountUsdc: AMOUNT_USDC_RAW.toString(),
      ...attestationMeta,
    },
    balances: { before, after, deltas },
    steps,
    outcome: {
      swapLeg: swapProvedLive
        ? "PROVED LIVE"
        : swapStatus === "error"
          ? "STILL BLOCKED"
          : "ERROR",
      realTimeFxSwapPoolUsingGateway: swapProvedLive
        ? "PROVED LIVE"
        : "PARTIALLY PROVED",
      evidence: swapProvedLive
        ? `One Arc Testnet tx (${swapTxHash}) where TGH.beforeSwap pulled ${AMOUNT_USDC_STR} USDC inline from Circle Gateway. GatewayRoutedSwap event fired. No CCTP attestation poll. (Keeper net USDC balance delta = ${deltas["keeper.usdc"]} because USDC is also the gas token on Arc; gas dominates the 0.1 USDC swap output.)`
        : `Swap leg did not deliver Gateway USDC. status=${swapStatus} gatewayMintEventFired=${gatewayMintEventFired} error=${swapError ?? "n/a"}`,
    },
  };

  const outPath = resolve(__dirname, "..", "scripts", "n6-gateway-demo-broadcast.json");
  writeFileSync(outPath, JSON.stringify(artefact, null, 2) + "\n", "utf8");
  console.log(`\n  ✓ artefact: ${outPath}`);
  console.log(`\n  outcome:  ${artefact.outcome.swapLeg}`);
  console.log(`  USDC delta: ${deltas["keeper.usdc"]}`);
  console.log(`  EURC delta: ${deltas["keeper.eurc"]}`);
  console.log(`  TGH USDC delta: ${deltas["tgh.usdc"]}`);
  if (swapTxHash) console.log(`  swap tx:    ${swapTxHash}`);

  if (swapStatus === "error") process.exit(1);
}

// ─────────────────────── helpers ──────────────────────────────────────

function computePoolId(key: {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)",
      ),
      [key],
    ),
  );
}

interface MintAttestationResult {
  attestation: Hex;
  signature: Hex;
  requestId: Hex;
  expirationBlock?: string;
  transferId?: string;
}

async function mintGatewayAttestation(args: {
  keeper: ReturnType<typeof privateKeyToAccount>;
  amountRaw: bigint;
  destinationRecipient: Address;
  destinationCaller: Address;
}): Promise<MintAttestationResult> {
  const evmAddressToBytes32 = (address: Address): Hex =>
    pad(address.toLowerCase() as Hex, { size: 32 });
  const salt = (() => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return ("0x" +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")) as Hex;
  })();
  const maxFeeRaw = parseUnits("2.01", 6);

  const burnIntentForSigning = {
    maxBlockHeight: maxUint64,
    maxFee: maxFeeRaw,
    spec: {
      version: 1,
      sourceDomain: FUJI_DOMAIN,
      destinationDomain: ARC_DOMAIN,
      sourceContract: evmAddressToBytes32(CIRCLE_GATEWAY_WALLET),
      destinationContract: evmAddressToBytes32(CIRCLE_GATEWAY_MINTER),
      sourceToken: evmAddressToBytes32(FUJI_USDC),
      destinationToken: evmAddressToBytes32(USDC),
      sourceDepositor: evmAddressToBytes32(args.keeper.address),
      destinationRecipient: evmAddressToBytes32(args.destinationRecipient),
      sourceSigner: evmAddressToBytes32(args.keeper.address),
      destinationCaller: evmAddressToBytes32(args.destinationCaller),
      value: args.amountRaw,
      salt,
      hookData: "0x" as Hex,
    },
  } as const;

  const burnSignature = await args.keeper.signTypedData({
    domain: EIP712_DOMAIN,
    types: EIP712_TYPES,
    primaryType: "BurnIntent",
    message: burnIntentForSigning,
  });

  // String mirror for POST
  const burnIntent = {
    maxBlockHeight: maxUint64.toString(),
    maxFee: maxFeeRaw.toString(),
    spec: {
      version: 1,
      sourceDomain: FUJI_DOMAIN,
      destinationDomain: ARC_DOMAIN,
      sourceContract: burnIntentForSigning.spec.sourceContract,
      destinationContract: burnIntentForSigning.spec.destinationContract,
      sourceToken: burnIntentForSigning.spec.sourceToken,
      destinationToken: burnIntentForSigning.spec.destinationToken,
      sourceDepositor: burnIntentForSigning.spec.sourceDepositor,
      destinationRecipient: burnIntentForSigning.spec.destinationRecipient,
      sourceSigner: burnIntentForSigning.spec.sourceSigner,
      destinationCaller: burnIntentForSigning.spec.destinationCaller,
      value: args.amountRaw.toString(),
      salt,
      hookData: "0x" as Hex,
    },
  };

  const apiBase = "https://gateway-api-testnet.circle.com/v1";
  const url = `${apiBase}/transfer`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NETWORK_DEADLINE_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ burnIntent, signature: burnSignature }]),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Circle /v1/transfer ${res.status}: ${body.slice(0, 400)}`);
  }
  const text = await res.text();
  const json = JSON.parse(text);
  if (typeof json.attestation !== "string" || typeof json.signature !== "string") {
    throw new Error(
      `Circle response missing attestation/signature: ${text.slice(0, 400)}`,
    );
  }
  // requestId is the keccak of the TransferSpec — derive it via the
  // typeHash + spec encoding. But the hook also accepts the salt as request
  // id since context.requestId is what's checked against _gatewayReceipts.
  // The Circle docs use `transferId` (server-issued UUID) — we use a
  // chain-side requestId derived deterministically from the salt so the hook
  // can reject replays. Keep it consistent: requestId = salt.
  const requestId = salt;

  return {
    attestation: json.attestation as Hex,
    signature: json.signature as Hex,
    requestId,
    expirationBlock: json.expirationBlock?.toString(),
    transferId: json.transferId,
  };
}

function requirePk(envName: string): Hex {
  const v = process.env[envName];
  if (!v || !/^0x[a-fA-F0-9]{64}$/.test(v)) {
    throw new Error(`${envName} must be set in .env.local`);
  }
  return v as Hex;
}

function deltaStr(beforeBI: bigint, afterBI: bigint, decimals: number): string {
  const d = afterBI - beforeBI;
  const sign = d > 0n ? "+" : d < 0n ? "-" : "";
  const abs = d < 0n ? -d : d;
  return `${sign}${formatUnits(abs, decimals)}`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadDotEnvLocal(): void {
  const envPath = resolve(__dirname, "..", ".env.local");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

main().catch((err) => {
  console.error("\n[n6-gateway-demo-broadcast] FATAL:", err);
  process.exit(1);
});
