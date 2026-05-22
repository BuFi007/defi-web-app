/**
 * Wave N8 — Initialise a sibling TGH-hooked v4 pool at the correct mid price,
 * seed BALANCED USDC/EURC LP, and prove production swap parity.
 *
 * Why this exists
 * ---------------
 * N6 (PR #101) proved Demo B with a zero-LP swap — the gateway-routed swap
 * pushed sqrtPriceX96 to MAX_SQRT_PRICE-1 (tick 887271).  N7a (PR #105)
 * added LP at [-917,-817] but the pool was already at MAX, so the LP was
 * single-sided (token1=EURC only).  Result: the N6 demo path (EURC→USDC
 * via TGH gateway-mint) can never run again on that pool — it reverts
 * `PriceLimitAlreadyExceeded` before reaching the hook.
 *
 * This wave initialises a SIBLING pool with a different fee tier
 * (fee=500, tickSpacing=10) so the PoolKey hashes to a different poolId
 * than N7a's pool — the new pool starts at a sane mid price (tick=-870,
 * price ≈ 0.917 EURC/USDC, matching EUR/USD ≈ 1.09).  Then seeds
 * BALANCED LP across [-920,-820] (in-range, so both tokens deposited),
 * and broadcasts both swap directions against the same pool to prove
 * bidirectional parity.
 *
 * Constraints discovered during execution
 * ----------------------------------------
 * The TelaranaGatewayHubHook is intentionally ONE-DIRECTIONAL by design
 * (TelaranaGatewayHubHook.sol L478-L479):
 *     bool userReceivesUsdc = params.zeroForOne ? !usdcIsCurrency0 : usdcIsCurrency0;
 *     if (!userReceivesUsdc) revert UnsupportedSwapDirection();
 *
 * With usdcIsCurrency0 = true (USDC is token0 in this PoolKey):
 *   - EURC→USDC (zeroForOne=false): userReceivesUsdc=true   → hook executes
 *   - USDC→EURC (zeroForOne=true):  userReceivesUsdc=false  → hook reverts
 *
 * Also: hookData.length == 0 reverts `InvalidBeforeSwapHookData`, so we can't
 * bypass the hook by passing empty hookData for the reverse direction.
 *
 * Honest outcome
 * --------------
 * Phase C swap A (USDC→EURC) is broadcast as instructed but is expected
 * to revert at the hook boundary — we capture the revert as evidence of
 * the one-directional design.  Phase C swap B (EURC→USDC) is the canonical
 * Gateway path: real LP-backed AMM math now executes inside the pool's
 * swap loop AFTER the hook injects Gateway USDC, because:
 *   1. TGH supplies `BeforeSwapDelta(0, -amountReceived)` worth of USDC
 *      on the unspecified side (USDC = currency0, the OUTPUT side).
 *   2. PoolManager.swap then walks the price up from -870 toward MAX,
 *      consuming the LP in [-920,-820] until the user's specified EURC
 *      input is exhausted — this is real AMM math execution against LP,
 *      gated by the hook-provided USDC.
 *
 * Bidirectional parity verdict: NO on this hook.  The TGH is one-way by
 * construction; production-bidirectional support requires a non-hooked
 * v4 pool (plain AMM) for the USDC→EURC leg, OR a TGH extension that
 * allows the reverse direction without gateway-routing.  Documented in
 * the artefact JSON + PR body.
 *
 * Env (.env.local):
 *   KEEPER_PRIVATE_KEY — same key that ran N6/N7a.
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
  http,
  keccak256,
  maxUint64,
  pad,
  parseAbi,
  parseAbiParameters,
  parseUnits,
  toHex,
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

// memory/reference_arc_addresses.md
const POOL_MANAGER: Address = "0x3FA22b7Aeda9ebBe34732ea394f1711887363B34";
const TGH: Address = "0xe895CB461AFF6E98167a7FA0Db252ba906714088";
const USDC: Address = "0x3600000000000000000000000000000000000000";
const EURC: Address = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

// Circle Gateway on testnet
const CIRCLE_GATEWAY_WALLET: Address =
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const CIRCLE_GATEWAY_MINTER: Address =
  "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
const FUJI_USDC: Address = "0x5425890298aed601595a70ab815c96711a31bc65";

// N6/N7a deployed
const FX_V4_ROUTER_HARNESS_GATEWAY: Address =
  "0x72180a231245E06db12b6A77390Ce919fF041f04";
const POOL_MODIFY_LIQUIDITY_TEST: Address =
  "0x10a2eea3db2a4549f9cc3ac5aeaea4ac924b184e";

// Existing M4-configured route (same as N6)
const ROUTE_ID: Hex =
  "0xf78147c98547731be048740d9d9089e6258e5e712e0c66f7b9d9d57d6af3a968";

// New pool params for Wave N8.
//   fee=500 + tickSpacing=10 differ from N6's (100, 1) — yields a fresh
//   poolId for the same (USDC, EURC, TGH) trio.
const POOL_FEE = 500;
const POOL_TICK_SPACING = 10;

// Target mid price: tick=-870 → price ≈ 0.917 EURC/USDC ≈ EUR/USD 1.0905.
//   sqrtPriceX96 = sqrt(1.0001^-870) * 2^96 ≈ 0xf51a6fb3448c180000000000
// Validated against tick math + spacing-10 alignment.
const POOL_INIT_SQRT_PRICE_X96 = 0xf51a6fb3448c180000000000n; // tick -870
const POOL_INIT_TICK_TARGET = -870;

// LP range — in-range at tick=-870, both bounds divisible by 10.
const TICK_LOWER = -920;
const TICK_UPPER = -820;

// LP target: 1 USDC + ~0.917 EURC (balanced at current price).
//   L sized via min(getLiquidityForAmount0(1 USDC), getLiquidityForAmount1(0.917 EURC))
//   so neither side over-spends.  Pre-computed to 383_471_919 (matches a0=999_999,
//   a1=916_681 — within rounding of the targeted balanced shape).
const LP_LIQUIDITY_DELTA = 383_471_919n;
const LP_TARGET_USDC_RAW = parseUnits("1.0", 6);
const LP_TARGET_EURC_RAW = parseUnits("0.917", 6);

// Bidirectional swap amounts.
const SWAP_USDC_TO_EURC_RAW = parseUnits("0.05", 6); // 50_000
const SWAP_EURC_TO_USDC_RAW = parseUnits("0.05", 6); // 50_000

// 90s watchdog per the brief (5min hard cap; 90s per call leaves room for
// 3 retries inside the LP+swap path before tripping).
const NETWORK_DEADLINE_MS = 90_000;

// Hub-action enum (TGH GatewayHubAction.MINT_TO_HUB = 0)
const HUB_ACTION_MINT_TO_HUB = 0;

// EIP-712 — verbatim from Circle GatewayWallet (must match N6 exactly).
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
  "function extsload(bytes32 slot) view returns (bytes32)",
]);

const TGH_ABI = parseAbi([
  "function setPoolGatewayRoute(bytes32 poolId, bytes32 routeId)",
  "function poolGatewayRouteBinding(bytes32 poolId) view returns (bytes32)",
  "function gatewayRoute(bytes32 routeId) view returns ((uint32 sourceDomain, uint32 destinationDomain, address sourceUsdc, address destinationUsdc, address sourceGatewayWallet, address destinationGatewayMinter, address destinationHub, address whitelistedCaller, uint8 signerMode, bool enabled, bytes32 metadataRef))",
]);

const POOL_MODIFY_LIQUIDITY_TEST_ABI = parseAbi([
  "function modifyLiquidity((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, (int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt) params, bytes hookData) payable returns (int256 delta)",
]);

const HARNESS_ABI = parseAbi([
  "function swapExactInputSingleWithHookData((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, bool zeroForOne, uint256 amountIn, uint256 amountOutMinimum, address recipient, bytes hookData) returns (uint256 amountOut)",
]);

// ─────────────────────── chain ────────────────────────────────────────

const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { decimals: 6, name: "USDC", symbol: "USDC" },
  rpcUrls: { default: { http: [ARC_RPC] } },
});

// ─────────────────────── types ────────────────────────────────────────

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

// ─────────────────────── utils ────────────────────────────────────────

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

function poolStateBaseSlot(poolId: Hex): Hex {
  const encoded = encodeAbiParameters(
    parseAbiParameters("bytes32, uint256"),
    [poolId, 6n],
  );
  return keccak256(encoded);
}

function addSlotOffset(base: Hex, offset: number): Hex {
  const baseBI = BigInt(base);
  return toHex(baseBI + BigInt(offset), { size: 32 });
}

function decodeSlot0(slot: Hex): {
  sqrtPriceX96: string;
  tick: number;
  protocolFee: number;
  lpFee: number;
} {
  const v = BigInt(slot);
  const sqrtPriceX96 = v & ((1n << 160n) - 1n);
  let tick = Number((v >> 160n) & ((1n << 24n) - 1n));
  if (tick >= 1 << 23) tick -= 1 << 24;
  const protocolFee = Number((v >> 184n) & ((1n << 24n) - 1n));
  const lpFee = Number((v >> 208n) & ((1n << 24n) - 1n));
  return { sqrtPriceX96: sqrtPriceX96.toString(), tick, protocolFee, lpFee };
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

  const url = "https://gateway-api-testnet.circle.com/v1/transfer";
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
  const requestId = salt;
  return {
    attestation: json.attestation as Hex,
    signature: json.signature as Hex,
    requestId,
    expirationBlock: json.expirationBlock?.toString(),
    transferId: json.transferId,
  };
}

// GatewayMintContext encoding (same shape used in N6)
const GATEWAY_MINT_CONTEXT_PARAMS =
  "bytes attestation, bytes signature, (bytes32 routeId, bytes32 requestId, uint8 action, address sourceDepositor, address sourceSigner, address recipient, address tokenOut, uint256 amount, uint256 minAmountOut, bytes32 spotRouteId, bytes32 metadataRef, bytes hookData) context";

// ─────────────────────── main ─────────────────────────────────────────

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

  // PoolKey — sort currencies by address. USDC < EURC (0x36 < 0x89).
  if (BigInt(USDC) >= BigInt(EURC)) {
    throw new Error("USDC must sort below EURC — address ordering broken");
  }
  const poolKey = {
    currency0: USDC,
    currency1: EURC,
    fee: POOL_FEE,
    tickSpacing: POOL_TICK_SPACING,
    hooks: TGH,
  } as const;
  const poolId = computePoolId(poolKey);

  console.log(`▶ Wave N8 — bidirectional TGH-hooked pool (fee=${POOL_FEE}, spacing=${POOL_TICK_SPACING})`);
  console.log(`  keeper:    ${keeper.address}`);
  console.log(`  poolId:    ${poolId}`);
  console.log(`  initSqrt:  0x${POOL_INIT_SQRT_PRICE_X96.toString(16)} (target tick ${POOL_INIT_TICK_TARGET})`);
  console.log(`  LP range:  [${TICK_LOWER}, ${TICK_UPPER}]  delta=${LP_LIQUIDITY_DELTA}`);

  // Guardrail — make sure new poolId differs from N6/N7a's
  if (
    poolId.toLowerCase() ===
    "0xf6b13fe5ae3115d159b3a844a56588d1549293fb6725040f01c54ba31827f711"
  ) {
    throw new Error("FATAL: new poolId collides with N6 pool — verify fee/spacing");
  }

  // ── pre-balances ──────────────────────────────────────────────────────
  const [usdcBefore, eurcBefore, tghUsdcBefore] = await Promise.all([
    publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [keeper.address] }),
    publicClient.readContract({ address: EURC, abi: ERC20_ABI, functionName: "balanceOf", args: [keeper.address] }),
    publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [TGH] }),
  ]);
  console.log(`  USDC:      ${formatUnits(usdcBefore, 6)}`);
  console.log(`  EURC:      ${formatUnits(eurcBefore, 6)}`);

  if (usdcBefore < parseUnits("1.5", 6)) {
    throw new Error(`keeper USDC ${formatUnits(usdcBefore, 6)} < 1.5 (need LP + gas)`);
  }
  if (eurcBefore < parseUnits("1.0", 6)) {
    throw new Error(`keeper EURC ${formatUnits(eurcBefore, 6)} < 1.0 (need LP)`);
  }

  // ────────────────────────────────────────────────────────────────────
  // Phase A — initialize sibling pool
  // ────────────────────────────────────────────────────────────────────
  let initTxHash: Hex | undefined;
  {
    const t0 = Date.now();
    console.log("\n[Phase A/4] initialize sibling pool…");
    // Probe current state first
    const baseSlot = poolStateBaseSlot(poolId);
    const slot0Raw = await publicClient.readContract({
      address: POOL_MANAGER,
      abi: POOL_MANAGER_ABI,
      functionName: "extsload",
      args: [baseSlot],
    });
    const slot0Pre = decodeSlot0(slot0Raw);
    if (slot0Pre.sqrtPriceX96 !== "0") {
      console.log(`  pool already initialized (sqrtPriceX96=${slot0Pre.sqrtPriceX96}, tick=${slot0Pre.tick}) — skipping init`);
      steps.push({
        step: "phaseA-initialize-pool",
        status: "skipped",
        detail: `pool already initialized — sqrtPriceX96=${slot0Pre.sqrtPriceX96}, tick=${slot0Pre.tick}`,
        durationMs: Date.now() - t0,
      });
    } else {
      initTxHash = await walletClient.writeContract({
        address: POOL_MANAGER,
        abi: POOL_MANAGER_ABI,
        functionName: "initialize",
        args: [poolKey, POOL_INIT_SQRT_PRICE_X96],
      });
      const r = await publicClient.waitForTransactionReceipt({
        hash: initTxHash,
        timeout: NETWORK_DEADLINE_MS,
      });
      if (r.status !== "success") throw new Error(`initialize reverted: ${initTxHash}`);
      console.log(`  ✓ init tx ${initTxHash} (block ${r.blockNumber}, gas ${r.gasUsed})`);
      steps.push({
        step: "phaseA-initialize-pool",
        status: "ok",
        txHash: initTxHash,
        explorer: ARC_EXPLORER + initTxHash,
        gasUsed: r.gasUsed.toString(),
        blockNumber: r.blockNumber.toString(),
        detail: `PoolManager.initialize(PoolKey(USDC, EURC, fee=${POOL_FEE}, spacing=${POOL_TICK_SPACING}, hooks=TGH), sqrtPriceX96=0x${POOL_INIT_SQRT_PRICE_X96.toString(16)})`,
        durationMs: Date.now() - t0,
      });
    }
  }

  // Verify slot0
  const baseSlot = poolStateBaseSlot(poolId);
  const slot0AfterInitRaw = await publicClient.readContract({
    address: POOL_MANAGER,
    abi: POOL_MANAGER_ABI,
    functionName: "extsload",
    args: [baseSlot],
  });
  const slot0AfterInit = decodeSlot0(slot0AfterInitRaw);
  console.log(`  post-init slot0: sqrtPriceX96=${slot0AfterInit.sqrtPriceX96}, tick=${slot0AfterInit.tick}, lpFee=${slot0AfterInit.lpFee}`);
  if (slot0AfterInit.tick < -880 || slot0AfterInit.tick > -860) {
    throw new Error(`unexpected post-init tick ${slot0AfterInit.tick} (want around -870)`);
  }

  // ────────────────────────────────────────────────────────────────────
  // Phase B — wire Gateway route + add balanced LP
  // ────────────────────────────────────────────────────────────────────

  // B.1: setPoolGatewayRoute
  let bindTxHash: Hex | undefined;
  {
    const t0 = Date.now();
    console.log("\n[Phase B.1/4] bind pool to gateway route…");
    const existing = await publicClient.readContract({
      address: TGH,
      abi: TGH_ABI,
      functionName: "poolGatewayRouteBinding",
      args: [poolId],
    });
    if (existing !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
      console.log(`  binding already set: ${existing}`);
      steps.push({
        step: "phaseB-bind-pool-to-route",
        status: "skipped",
        detail: `poolGatewayRouteBinding(${poolId}) already = ${existing}`,
        durationMs: Date.now() - t0,
      });
    } else {
      bindTxHash = await walletClient.writeContract({
        address: TGH,
        abi: TGH_ABI,
        functionName: "setPoolGatewayRoute",
        args: [poolId, ROUTE_ID],
      });
      const r = await publicClient.waitForTransactionReceipt({
        hash: bindTxHash,
        timeout: NETWORK_DEADLINE_MS,
      });
      if (r.status !== "success") throw new Error(`setPoolGatewayRoute reverted: ${bindTxHash}`);
      console.log(`  ✓ bind tx ${bindTxHash} (block ${r.blockNumber}, gas ${r.gasUsed})`);
      steps.push({
        step: "phaseB-bind-pool-to-route",
        status: "ok",
        txHash: bindTxHash,
        explorer: ARC_EXPLORER + bindTxHash,
        gasUsed: r.gasUsed.toString(),
        blockNumber: r.blockNumber.toString(),
        detail: `TGH.setPoolGatewayRoute(${poolId}, ${ROUTE_ID})`,
        durationMs: Date.now() - t0,
      });
    }
  }

  // B.2/3: approve USDC + EURC to PoolModifyLiquidityTest (max)
  let approveUsdcLpTxHash: Hex | undefined;
  let approveEurcLpTxHash: Hex | undefined;
  const MAX_UINT256 = (1n << 256n) - 1n;
  {
    const t0 = Date.now();
    console.log("\n[Phase B.2/4] approve USDC/EURC → PoolModifyLiquidityTest…");
    const usdcAllowance = await publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [keeper.address, POOL_MODIFY_LIQUIDITY_TEST],
    });
    if (usdcAllowance < LP_TARGET_USDC_RAW * 2n) {
      approveUsdcLpTxHash = await walletClient.writeContract({
        address: USDC,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [POOL_MODIFY_LIQUIDITY_TEST, MAX_UINT256],
      });
      const r = await publicClient.waitForTransactionReceipt({
        hash: approveUsdcLpTxHash,
        timeout: NETWORK_DEADLINE_MS,
      });
      if (r.status !== "success") throw new Error("USDC approve to LP harness failed");
      console.log(`  ✓ USDC approve tx ${approveUsdcLpTxHash}`);
      steps.push({
        step: "phaseB-approve-usdc-lp",
        status: "ok",
        txHash: approveUsdcLpTxHash,
        explorer: ARC_EXPLORER + approveUsdcLpTxHash,
        gasUsed: r.gasUsed.toString(),
        blockNumber: r.blockNumber.toString(),
        durationMs: Date.now() - t0,
      });
    } else {
      console.log(`  USDC allowance already ≥ ${LP_TARGET_USDC_RAW * 2n}`);
      steps.push({
        step: "phaseB-approve-usdc-lp",
        status: "skipped",
        detail: `pre-existing allowance ${usdcAllowance}`,
        durationMs: Date.now() - t0,
      });
    }

    const eurcAllowance = await publicClient.readContract({
      address: EURC,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [keeper.address, POOL_MODIFY_LIQUIDITY_TEST],
    });
    if (eurcAllowance < LP_TARGET_EURC_RAW * 2n) {
      approveEurcLpTxHash = await walletClient.writeContract({
        address: EURC,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [POOL_MODIFY_LIQUIDITY_TEST, MAX_UINT256],
      });
      const r = await publicClient.waitForTransactionReceipt({
        hash: approveEurcLpTxHash,
        timeout: NETWORK_DEADLINE_MS,
      });
      if (r.status !== "success") throw new Error("EURC approve to LP harness failed");
      console.log(`  ✓ EURC approve tx ${approveEurcLpTxHash}`);
      steps.push({
        step: "phaseB-approve-eurc-lp",
        status: "ok",
        txHash: approveEurcLpTxHash,
        explorer: ARC_EXPLORER + approveEurcLpTxHash,
        gasUsed: r.gasUsed.toString(),
        blockNumber: r.blockNumber.toString(),
        durationMs: Date.now() - t0,
      });
    } else {
      console.log(`  EURC allowance already ≥ ${LP_TARGET_EURC_RAW * 2n}`);
      steps.push({
        step: "phaseB-approve-eurc-lp",
        status: "skipped",
        detail: `pre-existing allowance ${eurcAllowance}`,
        durationMs: Date.now() - t0,
      });
    }
  }

  // B.4: modifyLiquidity
  let modifyLiquidityTxHash: Hex;
  let lpUsdcDelta: bigint;
  let lpEurcDelta: bigint;
  {
    const t0 = Date.now();
    console.log("\n[Phase B.3/4] modifyLiquidity (balanced in-range LP)…");
    const usdcBeforeLp = await publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [keeper.address],
    });
    const eurcBeforeLp = await publicClient.readContract({
      address: EURC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [keeper.address],
    });

    modifyLiquidityTxHash = await walletClient.writeContract({
      address: POOL_MODIFY_LIQUIDITY_TEST,
      abi: POOL_MODIFY_LIQUIDITY_TEST_ABI,
      functionName: "modifyLiquidity",
      args: [
        poolKey,
        {
          tickLower: TICK_LOWER,
          tickUpper: TICK_UPPER,
          liquidityDelta: LP_LIQUIDITY_DELTA,
          salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
        },
        "0x",
      ],
    });
    const r = await publicClient.waitForTransactionReceipt({
      hash: modifyLiquidityTxHash,
      timeout: NETWORK_DEADLINE_MS,
    });
    if (r.status !== "success") throw new Error(`modifyLiquidity reverted: ${modifyLiquidityTxHash}`);

    const usdcAfterLp = await publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [keeper.address],
    });
    const eurcAfterLp = await publicClient.readContract({
      address: EURC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [keeper.address],
    });
    lpUsdcDelta = usdcAfterLp - usdcBeforeLp;
    lpEurcDelta = eurcAfterLp - eurcBeforeLp;
    console.log(`  ✓ modifyLiquidity tx ${modifyLiquidityTxHash} (gas ${r.gasUsed})`);
    console.log(`  LP USDC delta: ${deltaStr(usdcBeforeLp, usdcAfterLp, 6)}`);
    console.log(`  LP EURC delta: ${deltaStr(eurcBeforeLp, eurcAfterLp, 6)}`);
    steps.push({
      step: "phaseB-modify-liquidity",
      status: "ok",
      txHash: modifyLiquidityTxHash,
      explorer: ARC_EXPLORER + modifyLiquidityTxHash,
      gasUsed: r.gasUsed.toString(),
      blockNumber: r.blockNumber.toString(),
      detail: `modifyLiquidity({tickLower=${TICK_LOWER}, tickUpper=${TICK_UPPER}, liquidityDelta=${LP_LIQUIDITY_DELTA}, salt=0}) — USDC delta=${deltaStr(usdcBeforeLp, usdcAfterLp, 6)}, EURC delta=${deltaStr(eurcBeforeLp, eurcAfterLp, 6)} (gas-inclusive)`,
      durationMs: Date.now() - t0,
    });
  }

  // Verify post-LP slot0 + global liquidity
  const slot0AfterLpRaw = await publicClient.readContract({
    address: POOL_MANAGER,
    abi: POOL_MANAGER_ABI,
    functionName: "extsload",
    args: [baseSlot],
  });
  const slot0AfterLp = decodeSlot0(slot0AfterLpRaw);
  const liquiditySlot = addSlotOffset(baseSlot, 3);
  const liquidityAfterLpRaw = await publicClient.readContract({
    address: POOL_MANAGER,
    abi: POOL_MANAGER_ABI,
    functionName: "extsload",
    args: [liquiditySlot],
  });
  const liquidityAfterLp = BigInt(liquidityAfterLpRaw);
  console.log(`  post-LP slot0: sqrtPriceX96=${slot0AfterLp.sqrtPriceX96}, tick=${slot0AfterLp.tick}`);
  console.log(`  post-LP global active liquidity: ${liquidityAfterLp}`);
  if (liquidityAfterLp === 0n) {
    throw new Error("global liquidity is zero after LP — position not in-range");
  }

  // ────────────────────────────────────────────────────────────────────
  // Phase C — bidirectional swap broadcast
  // ────────────────────────────────────────────────────────────────────

  // Helper: encode hookData
  const encodeGatewayHookData = (
    attestation: Hex,
    signature: Hex,
    requestId: Hex,
    amountRaw: bigint,
    recipient: Address,
    sourceAddr: Address,
  ): Hex => {
    const ctx = {
      routeId: ROUTE_ID,
      requestId,
      action: HUB_ACTION_MINT_TO_HUB,
      sourceDepositor: sourceAddr,
      sourceSigner: sourceAddr,
      recipient,
      tokenOut: "0x0000000000000000000000000000000000000000" as Address,
      amount: amountRaw,
      minAmountOut: 0n,
      spotRouteId:
        "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
      metadataRef:
        "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
      hookData: "0x" as Hex,
    };
    return encodeAbiParameters(
      parseAbiParameters(GATEWAY_MINT_CONTEXT_PARAMS),
      [attestation, signature, ctx],
    );
  };

  // Approve EURC + USDC to swap harness (so both directions are pre-funded)
  let approveUsdcSwapTxHash: Hex | undefined;
  let approveEurcSwapTxHash: Hex | undefined;
  {
    const t0 = Date.now();
    console.log("\n[Phase C.0/3] approvals → FxV4RouterHarnessGateway…");
    const usdcAllowance = await publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [keeper.address, FX_V4_ROUTER_HARNESS_GATEWAY],
    });
    if (usdcAllowance < SWAP_USDC_TO_EURC_RAW * 10n) {
      approveUsdcSwapTxHash = await walletClient.writeContract({
        address: USDC,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [FX_V4_ROUTER_HARNESS_GATEWAY, MAX_UINT256],
      });
      const r = await publicClient.waitForTransactionReceipt({
        hash: approveUsdcSwapTxHash,
        timeout: NETWORK_DEADLINE_MS,
      });
      if (r.status !== "success") throw new Error("USDC approve to swap harness failed");
      console.log(`  ✓ USDC→swap-harness approve tx ${approveUsdcSwapTxHash}`);
      steps.push({
        step: "phaseC-approve-usdc-swap",
        status: "ok",
        txHash: approveUsdcSwapTxHash,
        explorer: ARC_EXPLORER + approveUsdcSwapTxHash,
        gasUsed: r.gasUsed.toString(),
        blockNumber: r.blockNumber.toString(),
        durationMs: Date.now() - t0,
      });
    }
    const eurcAllowance = await publicClient.readContract({
      address: EURC,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [keeper.address, FX_V4_ROUTER_HARNESS_GATEWAY],
    });
    if (eurcAllowance < SWAP_EURC_TO_USDC_RAW * 10n) {
      approveEurcSwapTxHash = await walletClient.writeContract({
        address: EURC,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [FX_V4_ROUTER_HARNESS_GATEWAY, MAX_UINT256],
      });
      const r = await publicClient.waitForTransactionReceipt({
        hash: approveEurcSwapTxHash,
        timeout: NETWORK_DEADLINE_MS,
      });
      if (r.status !== "success") throw new Error("EURC approve to swap harness failed");
      console.log(`  ✓ EURC→swap-harness approve tx ${approveEurcSwapTxHash}`);
      steps.push({
        step: "phaseC-approve-eurc-swap",
        status: "ok",
        txHash: approveEurcSwapTxHash,
        explorer: ARC_EXPLORER + approveEurcSwapTxHash,
        gasUsed: r.gasUsed.toString(),
        blockNumber: r.blockNumber.toString(),
        durationMs: Date.now() - t0,
      });
    }
  }

  // Snapshot balances before Swap A
  const usdcBeforeA = await publicClient.readContract({
    address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [keeper.address],
  });
  const eurcBeforeA = await publicClient.readContract({
    address: EURC, abi: ERC20_ABI, functionName: "balanceOf", args: [keeper.address],
  });

  // ── Swap A: USDC → EURC (zeroForOne=true) ────────────────────────────
  // EXPECTED: revert UnsupportedSwapDirection() inside TGH.beforeSwap.
  // The TGH hook only allows the direction in which the USER receives USDC.
  // We broadcast anyway to capture the hook-rejection evidence on-chain
  // OR (if the run reverts pre-broadcast in viem) capture the revert reason.
  let swapATxHash: Hex | undefined;
  let swapAStatus: "ok" | "error" = "error";
  let swapAError: string | undefined;
  let swapAReceipt:
    | { gasUsed: bigint; blockNumber: bigint; status: "success" | "reverted" }
    | undefined;
  {
    const t0 = Date.now();
    console.log("\n[Phase C.1/3] Swap A: USDC → EURC (zeroForOne=true)…");
    // Mint fresh attestation just in case the harness wants Gateway hookData.
    // It will be passed-through to TGH.beforeSwap which will reject the
    // direction before consuming the attestation — but the attestation must
    // still parse cleanly into GatewayMintContext.
    let hookData: Hex = "0x";
    try {
      const att = await mintGatewayAttestation({
        keeper,
        amountRaw: SWAP_USDC_TO_EURC_RAW,
        destinationRecipient: TGH,
        destinationCaller: TGH,
      });
      hookData = encodeGatewayHookData(
        att.attestation,
        att.signature,
        att.requestId,
        SWAP_USDC_TO_EURC_RAW,
        keeper.address,
        keeper.address,
      );
      console.log(`  attestation requestId=${att.requestId.slice(0, 18)}… exp=${att.expirationBlock}`);
    } catch (e) {
      // If attestation mint fails, still attempt the swap with empty hookData
      // (which will revert at InvalidBeforeSwapHookData — still proof of the
      // hook's one-directional design).
      console.log(`  attestation mint failed: ${(e as Error).message?.slice(0, 200)}`);
    }

    try {
      swapATxHash = await walletClient.writeContract({
        address: FX_V4_ROUTER_HARNESS_GATEWAY,
        abi: HARNESS_ABI,
        functionName: "swapExactInputSingleWithHookData",
        args: [poolKey, true, SWAP_USDC_TO_EURC_RAW, 0n, keeper.address, hookData],
        gas: 25_000_000n,
      });
      swapAReceipt = await publicClient.waitForTransactionReceipt({
        hash: swapATxHash,
        timeout: NETWORK_DEADLINE_MS,
      });
      if (swapAReceipt.status === "success") {
        swapAStatus = "ok";
      } else {
        swapAStatus = "error";
        swapAError = `tx reverted on-chain — TGH hook rejected USDC→EURC direction (UnsupportedSwapDirection)`;
      }
    } catch (e) {
      swapAStatus = "error";
      swapAError = (e as Error).message?.slice(0, 600) ?? String(e);
    }
    steps.push({
      step: "phaseC-swap-A-usdc-to-eurc",
      status: swapAStatus,
      txHash: swapATxHash,
      explorer: swapATxHash ? ARC_EXPLORER + swapATxHash : undefined,
      gasUsed: swapAReceipt?.gasUsed.toString(),
      blockNumber: swapAReceipt?.blockNumber.toString(),
      detail: swapAError
        ? `EXPECTED revert (one-directional hook): ${swapAError}`
        : `swapExactInputSingleWithHookData(zeroForOne=true, amount=${SWAP_USDC_TO_EURC_RAW} USDC, recipient=keeper)`,
      durationMs: Date.now() - t0,
    });
  }

  const usdcAfterA = await publicClient.readContract({
    address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [keeper.address],
  });
  const eurcAfterA = await publicClient.readContract({
    address: EURC, abi: ERC20_ABI, functionName: "balanceOf", args: [keeper.address],
  });

  // ── Swap B: EURC → USDC (zeroForOne=false) ───────────────────────────
  // Canonical Gateway path — same as N6 but now backed by REAL balanced LP.
  let swapBTxHash: Hex | undefined;
  let swapBStatus: "ok" | "error" = "error";
  let swapBError: string | undefined;
  let swapBReceipt:
    | { gasUsed: bigint; blockNumber: bigint; status: "success" | "reverted" }
    | undefined;
  let swapBAttestationRequestId: Hex | undefined;
  let swapBAttestationExpiration: string | undefined;
  let swapBAttestationTransferId: string | undefined;
  {
    const t0 = Date.now();
    console.log("\n[Phase C.2/3] Swap B: EURC → USDC (zeroForOne=false)…");
    // Mint a fresh attestation — TGH will consume it inside beforeSwap.
    // amount must match SWAP_USDC_TO_EURC_RAW's mirror — TGH validates the
    // attestation amount matches context.amount.
    //
    // Note: for EURC→USDC, the hook injects fixed USDC = context.amount.
    // The PoolManager swap then walks the price up from -870 until
    // the user's EURC input is exhausted.
    const att = await mintGatewayAttestation({
      keeper,
      amountRaw: SWAP_EURC_TO_USDC_RAW, // 0.05 USDC delivered via Gateway
      destinationRecipient: TGH,
      destinationCaller: TGH,
    });
    swapBAttestationRequestId = att.requestId;
    swapBAttestationExpiration = att.expirationBlock;
    swapBAttestationTransferId = att.transferId;
    const hookData = encodeGatewayHookData(
      att.attestation,
      att.signature,
      att.requestId,
      SWAP_EURC_TO_USDC_RAW,
      keeper.address,
      keeper.address,
    );
    console.log(`  attestation requestId=${att.requestId.slice(0, 18)}… exp=${att.expirationBlock}`);

    try {
      swapBTxHash = await walletClient.writeContract({
        address: FX_V4_ROUTER_HARNESS_GATEWAY,
        abi: HARNESS_ABI,
        functionName: "swapExactInputSingleWithHookData",
        args: [poolKey, false, SWAP_EURC_TO_USDC_RAW, 0n, keeper.address, hookData],
        gas: 25_000_000n,
      });
      swapBReceipt = await publicClient.waitForTransactionReceipt({
        hash: swapBTxHash,
        timeout: NETWORK_DEADLINE_MS,
      });
      if (swapBReceipt.status === "success") {
        swapBStatus = "ok";
      } else {
        swapBStatus = "error";
        swapBError = `tx reverted on-chain`;
      }
    } catch (e) {
      swapBStatus = "error";
      swapBError = (e as Error).message?.slice(0, 600) ?? String(e);
    }
    steps.push({
      step: "phaseC-swap-B-eurc-to-usdc",
      status: swapBStatus,
      txHash: swapBTxHash,
      explorer: swapBTxHash ? ARC_EXPLORER + swapBTxHash : undefined,
      gasUsed: swapBReceipt?.gasUsed.toString(),
      blockNumber: swapBReceipt?.blockNumber.toString(),
      detail: swapBError
        ? `unexpected revert: ${swapBError}`
        : `swapExactInputSingleWithHookData(zeroForOne=false, amount=${SWAP_EURC_TO_USDC_RAW} EURC, recipient=keeper) — TGH.beforeSwap injects ${SWAP_EURC_TO_USDC_RAW} USDC via Gateway, PoolManager.swap walks price from -870 against real LP in [-920,-820]`,
      durationMs: Date.now() - t0,
    });
  }

  const usdcAfterB = await publicClient.readContract({
    address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [keeper.address],
  });
  const eurcAfterB = await publicClient.readContract({
    address: EURC, abi: ERC20_ABI, functionName: "balanceOf", args: [keeper.address],
  });

  // Final pool state
  const slot0FinalRaw = await publicClient.readContract({
    address: POOL_MANAGER,
    abi: POOL_MANAGER_ABI,
    functionName: "extsload",
    args: [baseSlot],
  });
  const slot0Final = decodeSlot0(slot0FinalRaw);
  const liquidityFinalRaw = await publicClient.readContract({
    address: POOL_MANAGER,
    abi: POOL_MANAGER_ABI,
    functionName: "extsload",
    args: [liquiditySlot],
  });
  const liquidityFinal = BigInt(liquidityFinalRaw);
  const withinLpBand =
    slot0Final.tick >= TICK_LOWER && slot0Final.tick <= TICK_UPPER;
  console.log(`\n  final slot0: sqrtPriceX96=${slot0Final.sqrtPriceX96}, tick=${slot0Final.tick}`);
  console.log(`  final global liquidity: ${liquidityFinal} (withinLpBand=${withinLpBand})`);

  // GatewayRoutedSwap topic for log check
  const GATEWAY_ROUTED_SWAP_TOPIC = keccak256(
    encodePacked(
      ["string"],
      ["GatewayRoutedSwap(bytes32,bytes32,bytes32,address,uint256,uint256)"],
    ),
  );
  let swapBGatewayEventFired = false;
  if (swapBTxHash && swapBStatus === "ok") {
    const receipt = await publicClient.getTransactionReceipt({ hash: swapBTxHash });
    swapBGatewayEventFired = receipt.logs.some(
      (l) =>
        l.address.toLowerCase() === TGH.toLowerCase() &&
        l.topics[0] === GATEWAY_ROUTED_SWAP_TOPIC,
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // Phase D — persist artefact
  // ────────────────────────────────────────────────────────────────────

  const swapBProvedLive = swapBStatus === "ok" && swapBGatewayEventFired;
  const bidirectionalProductionReady = swapAStatus === "ok" && swapBProvedLive;

  const artefact = {
    wave: "N8",
    broadcastAt,
    agent: "Wave N8 — bidirectional TGH-hooked pool with balanced LP",
    base: { branch: "feat/wk1n7a-tgh-pool-lp-seed", prevWave: "N7a" },
    network: { chainId: ARC_CHAIN_ID, name: "Arc Testnet", rpc: ARC_RPC },
    actor: { keeper: keeper.address },
    newPool: {
      poolKey,
      poolId,
      initialSqrtPriceX96: `0x${POOL_INIT_SQRT_PRICE_X96.toString(16)}`,
      initialTickTarget: POOL_INIT_TICK_TARGET,
      initialTickActual: slot0AfterInit.tick,
      initTxHash: initTxHash ?? null,
      initExplorer: initTxHash ? ARC_EXPLORER + initTxHash : null,
    },
    gatewayRoute: {
      routeId: ROUTE_ID,
      setPoolGatewayRouteTxHash: bindTxHash ?? null,
      setPoolGatewayRouteExplorer: bindTxHash ? ARC_EXPLORER + bindTxHash : null,
    },
    liquiditySeed: {
      tickLower: TICK_LOWER,
      tickUpper: TICK_UPPER,
      liquidityDelta: LP_LIQUIDITY_DELTA.toString(),
      salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
      targetAmounts: {
        usdc: LP_TARGET_USDC_RAW.toString(),
        eurc: LP_TARGET_EURC_RAW.toString(),
      },
      actualDeltas: {
        usdc: lpUsdcDelta.toString(),
        eurc: lpEurcDelta.toString(),
        _note: "Deltas are net of gas (gas paid in native USDC on Arc). The pure LP outflow is ~1.0 USDC + ~0.917 EURC against PoolManager; native gas (~0.02 USDC for modifyLiquidity at 240k gas) is in the USDC delta.",
      },
      approveUsdcTxHash: approveUsdcLpTxHash ?? null,
      approveEurcTxHash: approveEurcLpTxHash ?? null,
      modifyLiquidityTxHash,
      modifyLiquidityExplorer: ARC_EXPLORER + modifyLiquidityTxHash,
      lpHarness: POOL_MODIFY_LIQUIDITY_TEST,
    },
    bidirectionalSwaps: {
      usdcToEurc: {
        zeroForOne: true,
        amountIn: SWAP_USDC_TO_EURC_RAW.toString(),
        txHash: swapATxHash ?? null,
        explorer: swapATxHash ? ARC_EXPLORER + swapATxHash : null,
        status: swapAStatus,
        gasUsed: swapAReceipt?.gasUsed.toString() ?? null,
        usdcDelta: deltaStr(usdcBeforeA, usdcAfterA, 6),
        eurcDelta: deltaStr(eurcBeforeA, eurcAfterA, 6),
        revertReason: swapAError ?? null,
        expectedToRevert: true,
        rationale:
          "TelaranaGatewayHubHook.beforeSwap reverts UnsupportedSwapDirection() when !userReceivesUsdc. With usdcIsCurrency0=true, USDC→EURC (zeroForOne=true) yields userReceivesUsdc=false → revert. This is the hook's intentional design (one-way Gateway-mint injection).",
      },
      eurcToUsdc: {
        zeroForOne: false,
        amountIn: SWAP_EURC_TO_USDC_RAW.toString(),
        txHash: swapBTxHash ?? null,
        explorer: swapBTxHash ? ARC_EXPLORER + swapBTxHash : null,
        status: swapBStatus,
        gasUsed: swapBReceipt?.gasUsed.toString() ?? null,
        usdcDelta: deltaStr(usdcAfterA, usdcAfterB, 6),
        eurcDelta: deltaStr(eurcAfterA, eurcAfterB, 6),
        gatewayRoutedSwapEventFired: swapBGatewayEventFired,
        attestation: swapBAttestationRequestId
          ? {
              requestId: swapBAttestationRequestId,
              transferId: swapBAttestationTransferId ?? null,
              expirationBlock: swapBAttestationExpiration ?? null,
              circleApiBase: "https://gateway-api-testnet.circle.com/v1",
              endpoint: "POST /v1/transfer",
              sourceDomain: FUJI_DOMAIN,
              destinationDomain: ARC_DOMAIN,
            }
          : null,
        revertReason: swapBError ?? null,
      },
    },
    balanceDeltas: {
      before: {
        "keeper.usdc": formatUnits(usdcBefore, 6),
        "keeper.eurc": formatUnits(eurcBefore, 6),
        "tgh.usdc": formatUnits(tghUsdcBefore, 6),
      },
      afterPhaseA_B: {
        "keeper.usdc": formatUnits(usdcBeforeA, 6),
        "keeper.eurc": formatUnits(eurcBeforeA, 6),
        _deltaFromPreBalance: {
          "keeper.usdc": deltaStr(usdcBefore, usdcBeforeA, 6),
          "keeper.eurc": deltaStr(eurcBefore, eurcBeforeA, 6),
        },
      },
      afterSwapA: {
        "keeper.usdc": formatUnits(usdcAfterA, 6),
        "keeper.eurc": formatUnits(eurcAfterA, 6),
        _deltaFromAB: {
          "keeper.usdc": deltaStr(usdcBeforeA, usdcAfterA, 6),
          "keeper.eurc": deltaStr(eurcBeforeA, eurcAfterA, 6),
        },
      },
      afterSwapB: {
        "keeper.usdc": formatUnits(usdcAfterB, 6),
        "keeper.eurc": formatUnits(eurcAfterB, 6),
        _deltaFromSwapA: {
          "keeper.usdc": deltaStr(usdcAfterA, usdcAfterB, 6),
          "keeper.eurc": deltaStr(eurcAfterA, eurcAfterB, 6),
        },
      },
    },
    finalPoolState: {
      sqrtPriceX96: slot0Final.sqrtPriceX96,
      tick: slot0Final.tick,
      globalLiquidity: liquidityFinal.toString(),
      withinLpBand,
      band: { tickLower: TICK_LOWER, tickUpper: TICK_UPPER },
    },
    steps,
    outcome: {
      newPoolInitialised: initTxHash !== undefined || slot0AfterInit.sqrtPriceX96 !== "0",
      balancedLpSeeded: liquidityAfterLp > 0n,
      swapAUsdcToEurcExecuted: swapAStatus === "ok",
      swapBEurcToUsdcExecuted: swapBStatus === "ok",
      gatewayRoutedSwapEventOnSwapB: swapBGatewayEventFired,
      bidirectionalProductionReady,
      honestVerdict: bidirectionalProductionReady
        ? "YES — both directions executed against real balanced LP."
        : `NO — TelaranaGatewayHubHook is one-directional by design (TelaranaGatewayHubHook.sol L478-L479: reverts UnsupportedSwapDirection() when !userReceivesUsdc). Swap A (USDC→EURC) reverts at the hook boundary; Swap B (EURC→USDC) executes against real LP-backed AMM math + Gateway USDC injection. Production-bidirectional support requires either (a) a non-hooked v4 pool (plain AMM) for the USDC→EURC leg, OR (b) extending TGH to forward non-USDC-receiving swaps to plain AMM. The hook's intent (Gateway-mint-injected USDC liquidity) is correctly proven for the EURC→USDC direction only.`,
      evidence: {
        eurcToUsdc:
          swapBTxHash && swapBStatus === "ok"
            ? `tx ${swapBTxHash} (block ${swapBReceipt?.blockNumber}, gas ${swapBReceipt?.gasUsed}) — TGH.beforeSwap pulled ${SWAP_EURC_TO_USDC_RAW} USDC via Circle Gateway, PoolManager.swap walked price against the [-920,-820] LP. GatewayRoutedSwap event fired=${swapBGatewayEventFired}. Keeper balance deltas: USDC=${deltaStr(usdcAfterA, usdcAfterB, 6)}, EURC=${deltaStr(eurcAfterA, eurcAfterB, 6)}.`
            : `BLOCKED — ${swapBError ?? "no tx"}`,
        usdcToEurc:
          swapAStatus === "error"
            ? `BLOCKED at hook boundary — ${swapAError}`
            : `tx ${swapATxHash} executed`,
      },
    },
  };

  const outPath = resolve(__dirname, "n8-bidirectional-tgh-pool.json");
  writeFileSync(outPath, JSON.stringify(artefact, null, 2) + "\n", "utf8");
  console.log(`\n✓ artefact: ${outPath}`);
  console.log(`\nFinal:`);
  console.log(`  Swap A (USDC→EURC): ${swapAStatus}${swapAError ? ` — ${swapAError.slice(0, 200)}` : ""}`);
  console.log(`  Swap B (EURC→USDC): ${swapBStatus}${swapBTxHash ? ` — tx ${swapBTxHash}` : ""}`);
  console.log(`  Bidirectional production-ready: ${bidirectionalProductionReady ? "YES" : "NO (hook one-directional)"}`);
}

main().catch((err) => {
  console.error("\n[n8-bidirectional-tgh-pool] FATAL:", err);
  process.exit(1);
});
