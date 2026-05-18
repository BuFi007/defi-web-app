/**
 * Smoke test for the FX Telaraña lending flow end-to-end.
 *
 * Walks the lend → borrow → repay → withdraw lifecycle against the real
 * @bufi/fx-telarana SDK + Hono routes mounted under /fx-telarana. The
 * keeper is not assumed to be running; intents are stored and signed
 * server-side but the Morpho-Blue settlement layer is not exercised.
 *
 * Per-step responsibility:
 *   1. GET  /fx-telarana/markets                                — assert ≥1 Fuji + ≥1 Arc market.
 *   2. POST /fx-telarana/supply/quote                           — log supplyShares (the "receipt amount").
 *   3. POST /fx-telarana/supply/intents                         — create supply intent (server-side build).
 *   4. POST /fx-telarana/supply/intents/:id/signature           — attach EIP-712 signature, server verifies.
 *   5. GET  /fx-telarana/positions/:address                     — log positions count (indexer not guaranteed).
 *   6. POST /fx-telarana/borrow/quote                           — 25% LLTV draw; log health factor.
 *                                                                  Oracle is often stale on testnet → tolerated.
 *   7. POST /fx-telarana/borrow/intents + /:id/signature        — sign + verify (skipped if quote failed).
 *   8. POST /fx-telarana/repay/quote                            — log borrowSharesBurned.
 *   9. POST /fx-telarana/repay/intents + /:id/signature.
 *  10. POST /fx-telarana/withdraw/quote                         — log assetsOut.
 *  11. POST /fx-telarana/withdraw/intents + /:id/signature.
 *
 * Note: the API uses /supply/quote, /supply/intents, /supply/intents/:id/signature
 * (action prefix-first), NOT a unified /quote/supply or /intents endpoint. The
 * URL shapes in this script match what apps/api/src/routes/fx-telarana.ts mounts.
 *
 * Expected-fail-acceptable paths (logged as `[smoke-telarana] WARN …` rather
 * than throwing):
 *   - Borrow quote returns ORACLE_STALE or any reverting getMid (FxOracle has
 *     no published price on testnet). The smoke skips the borrow-intent submit
 *     in that case but still continues to repay/withdraw which don't need oracle.
 *   - Positions list is empty after submitting a supply intent — the SDK reads
 *     on-chain Morpho state directly, and the intent isn't broadcast on-chain
 *     by this smoke (that's the keeper's job). Empty positions ⇒ warn, don't fail.
 *
 * Env vars:
 *   SMOKE_API_URL              (default http://localhost:3002)
 *   SMOKE_CHAIN_ID             (default 43113 — Fuji, telarana's primary hub)
 *   SMOKE_PRIVATE_KEY          (default 0xdddd…dddd — distinct from perps/bento/bufx)
 *   SMOKE_TELARANA_MARKET_KEY  (default M1_EURC_USDC)
 *   SMOKE_SPOKE_CHAIN_ID       (default = SMOKE_CHAIN_ID — single-hub flow)
 *   SMOKE_SUPPLY_ASSETS        (default "1000000" — 1 USDC at 6dp)
 *   SMOKE_COLLATERAL_ASSETS    (default "10000000" — 10 USDC at 6dp)
 *
 * Run: `bun run scripts/smoke-telarana.ts`
 */

import { TELARANA_DEPLOYMENTS, type TelaranaHubChainId } from "@bufi/contracts/telarana";
import {
  buildBorrowIntent,
  buildRepayIntent,
  buildSupplyIntent,
  buildWithdrawIntent,
  type FxTelaranaIntentTypedData,
} from "@bufi/fx-telarana";
import { type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const apiUrl = (process.env.SMOKE_API_URL ?? "http://localhost:3002").replace(/\/$/, "");
const chainId = Number(process.env.SMOKE_CHAIN_ID ?? 43113) as TelaranaHubChainId;
const spokeChainId = Number(process.env.SMOKE_SPOKE_CHAIN_ID ?? chainId);
const privateKey =
  (process.env.SMOKE_PRIVATE_KEY ??
    "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd") as Hex;
const marketKey =
  (process.env.SMOKE_TELARANA_MARKET_KEY ?? "M1_EURC_USDC") as "M1_EURC_USDC" | "M2_USDC_EURC";
const supplyAssetsStr = process.env.SMOKE_SUPPLY_ASSETS ?? "1000000";
const collateralAssetsStr = process.env.SMOKE_COLLATERAL_ASSETS ?? "10000000";

if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
  console.error("[smoke-telarana] SMOKE_PRIVATE_KEY must be a 32-byte hex private key");
  process.exit(2);
}

if (chainId !== 43113 && chainId !== 5042002) {
  console.error(
    `[smoke-telarana] SMOKE_CHAIN_ID=${chainId} is not a telarana hub (43113 Fuji or 5042002 Arc)`,
  );
  process.exit(2);
}

const account = privateKeyToAccount(privateKey);

interface WalletHeaders {
  "X-Wallet-Address": string;
  "X-Wallet-ChainId": string;
  "X-Wallet-TypedData": string;
  "X-Wallet-Signature": string;
}

interface StoredIntentResponse {
  id: string;
  kind: string;
  status: "unsigned" | "verified";
  typedData: { message: Record<string, string> };
}

async function buildWalletSession(
  signer: ReturnType<typeof privateKeyToAccount>,
): Promise<WalletHeaders> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 86_400;
  const typedData = {
    domain: { name: "BUFX Wallet Session", version: "1", chainId },
    types: {
      WalletSession: [
        { name: "purpose", type: "string" },
        { name: "wallet", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "origin", type: "string" },
        { name: "iat", type: "uint256" },
        { name: "exp", type: "uint256" },
      ],
    },
    primaryType: "WalletSession" as const,
    message: {
      purpose: "bufx.smoke-telarana",
      wallet: signer.address,
      chainId: BigInt(chainId),
      origin: apiUrl,
      iat: BigInt(iat),
      exp: BigInt(exp),
    },
  };
  const signature = await signer.signTypedData(typedData);
  const wire = JSON.stringify({
    ...typedData,
    message: {
      ...typedData.message,
      chainId: String(chainId),
      iat: String(iat),
      exp: String(exp),
    },
  });
  return {
    "X-Wallet-Address": signer.address,
    "X-Wallet-ChainId": String(chainId),
    "X-Wallet-TypedData": wire,
    "X-Wallet-Signature": signature,
  };
}

interface ApiError extends Error {
  status: number;
  bodyText: string;
  code?: string;
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extraHeaders,
  };
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let code: string | undefined;
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.code === "string") code = parsed.code;
    } catch {
      // not JSON; fall through
    }
    const err = new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 240)}`) as ApiError;
    err.status = res.status;
    err.bodyText = text;
    if (code) err.code = code;
    throw err;
  }
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

function isOracleStaleError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const text = `${(err as ApiError).bodyText ?? ""} ${err.message}`;
  if ((err as ApiError).code === "ORACLE_STALE") return true;
  return /ORACLE_STALE|stale|getMid|CalldataMustHaveValidPayload|oracle/i.test(text);
}

function pickMarket() {
  const deployment = TELARANA_DEPLOYMENTS[chainId];
  if (!deployment) throw new Error(`no TELARANA_DEPLOYMENTS entry for chainId=${chainId}`);
  const market = deployment.markets.find((m) => m.key === marketKey);
  if (!market) {
    throw new Error(
      `market key ${marketKey} not in deployment ${chainId}; available: ${deployment.markets
        .map((m) => m.key)
        .join(", ")}`,
    );
  }
  return market;
}

interface NonceResponse {
  hubChainId: number;
  action: string;
  account: string;
  nextNonce: string;
}

async function nextNonce(action: string, addr: Address): Promise<bigint> {
  const res = await api<NonceResponse>(
    "GET",
    `/fx-telarana/intents/nonce/${chainId}/${action}/${addr}`,
  );
  return BigInt(res.nextNonce);
}

function sessionAsHeaders(session: WalletHeaders): Record<string, string> {
  return { ...session } as unknown as Record<string, string>;
}

async function createIntent(
  pathPrefix: string,
  body: Record<string, unknown>,
  session: WalletHeaders,
): Promise<StoredIntentResponse> {
  return api<StoredIntentResponse>(
    "POST",
    `/fx-telarana/${pathPrefix}/intents`,
    body,
    sessionAsHeaders(session),
  );
}

async function signAndAttach(
  pathPrefix: string,
  intent: StoredIntentResponse,
  typedData: FxTelaranaIntentTypedData,
  session: WalletHeaders,
): Promise<StoredIntentResponse> {
  // viem's signTypedData expects bigint fields in the message — the typedData
  // returned by buildSupplyIntent / etc already has them as bigints. The
  // readonly `types` shape from the SDK is widened here to match viem's
  // mutable typed-data parameter shape (5-way union → `as never` is the
  // narrowest escape hatch the compiler will accept).
  const signature = await account.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  } as never);
  return api<StoredIntentResponse>(
    "POST",
    `/fx-telarana/${pathPrefix}/intents/${intent.id}/signature`,
    { signer: account.address, signature },
    sessionAsHeaders(session),
  );
}

interface MarketListResponse {
  markets: Array<{
    id: Hex;
    hubChainId: number;
    hubName: string;
    isLive: boolean;
    loanToken: Address;
    collateralToken: Address;
    lltv: string;
  }>;
}

interface SupplyQuoteResponse {
  marketId: Hex;
  assets: string;
  supplyShares: string;
}

interface BorrowQuoteResponse {
  collateral: string;
  borrowAmount: string;
  borrowAssetsAfter: string;
  healthFactorE18: string;
  liquidatable: boolean;
  maxBorrowAssets: string;
}

interface RepayQuoteResponse {
  marketId: Hex;
  assets: string;
  borrowSharesBurned: string;
}

interface WithdrawQuoteResponse {
  marketId: Hex;
  shares: string;
  assetsOut: string;
}

interface PositionsResponse {
  address: string;
  positions: Array<{
    marketId: Hex;
    hubChainId: number;
    supplyShares: string;
    borrowShares: string;
    collateral: string;
  }>;
}

async function main() {
  console.log(
    `[smoke-telarana] wallet=${account.address} chain=${chainId} marketKey=${marketKey}`,
  );

  const session = await buildWalletSession(account);

  // 1. markets — assert ≥1 Fuji + ≥1 Arc
  const { markets } = await api<MarketListResponse>("GET", "/fx-telarana/markets");
  const fujiCount = markets.filter((m) => m.hubChainId === 43113).length;
  const arcCount = markets.filter((m) => m.hubChainId === 5042002).length;
  console.log(
    `[smoke-telarana] markets total=${markets.length} fuji=${fujiCount} arc=${arcCount}`,
  );
  if (fujiCount < 1 || arcCount < 1) {
    throw new Error(
      `expected ≥1 Fuji + ≥1 Arc market, got fuji=${fujiCount} arc=${arcCount}`,
    );
  }

  const market = pickMarket();
  const supplyAssets = BigInt(supplyAssetsStr);
  const collateralAssets = BigInt(collateralAssetsStr);

  // 2. supply quote
  const supplyQuote = await api<SupplyQuoteResponse>(
    "POST",
    "/fx-telarana/supply/quote",
    {
      hubChainId: chainId,
      loanToken: market.loanToken,
      collateralToken: market.collateralToken,
      assets: supplyAssets.toString(),
    },
  );
  console.log(
    `[smoke-telarana] supply quote assets=${supplyQuote.assets} supplyShares=${supplyQuote.supplyShares} (the receipt-token amount; APR not exposed by this route)`,
  );

  // 3 + 4. supply intent — create, sign, verify
  const supplyDeadline = Math.floor(Date.now() / 1000) + 3_600;
  const supplyNonce = await nextNonce("Supply", account.address);
  const supplyTyped = buildSupplyIntent({
    chainId,
    spokeChainId,
    loanToken: market.loanToken,
    collateralToken: market.collateralToken,
    onBehalf: account.address,
    assets: supplyAssets,
    nonce: supplyNonce,
    deadline: supplyDeadline,
  });
  const supplyIntent = await createIntent(
    "supply",
    {
      hubChainId: chainId,
      spokeChainId,
      loanToken: market.loanToken,
      collateralToken: market.collateralToken,
      onBehalf: account.address,
      assets: supplyAssets.toString(),
      nonce: supplyNonce.toString(),
      deadline: supplyDeadline,
    },
    session,
  );
  console.log(`[smoke-telarana] supply intent created id=${supplyIntent.id} status=${supplyIntent.status}`);
  const supplyVerified = await signAndAttach("supply", supplyIntent, supplyTyped, session);
  console.log(`[smoke-telarana] supply intent verified status=${supplyVerified.status}`);

  // 5. positions — Ponder indexer / keeper is not exercised; this reads on-chain
  //    Morpho state directly. Empty list is acceptable for the smoke (we did
  //    NOT broadcast the supply on-chain) — log it and continue.
  const positions = await api<PositionsResponse>(
    "GET",
    `/fx-telarana/positions/${account.address}`,
  );
  if (positions.positions.length === 0) {
    console.warn(
      `[smoke-telarana] WARN positions empty — keeper has not broadcast the supply on-chain (this smoke does not run the keeper). Bucket #10's indexer covers the broadcast→index path.`,
    );
  } else {
    console.log(
      `[smoke-telarana] positions count=${positions.positions.length} sample=${JSON.stringify(positions.positions[0])}`,
    );
  }

  // 6 + 7. borrow — 25% LLTV draw against the collateral; oracle is often stale.
  //   Tolerate ORACLE_STALE / getMid reverts — they're the protocol's normal
  //   "no fresh price published" surface on testnet.
  const lltvBps = BigInt(market.collateralSymbol === market.loanSymbol ? 0 : 8_600);
  // 25% of LLTV (≈ 21.5% LTV); the on-chain quote returns the actual healthFactor.
  const borrowAmount = (collateralAssets * 25n * lltvBps) / (100n * 10_000n) || 1n;
  let borrowQuote: BorrowQuoteResponse | null = null;
  try {
    borrowQuote = await api<BorrowQuoteResponse>("POST", "/fx-telarana/borrow/quote", {
      hubChainId: chainId,
      loanToken: market.loanToken,
      collateralToken: market.collateralToken,
      collateral: collateralAssets.toString(),
      borrowAmount: borrowAmount.toString(),
    });
    console.log(
      `[smoke-telarana] borrow quote borrowAfter=${borrowQuote.borrowAssetsAfter} healthFactorE18=${borrowQuote.healthFactorE18} liquidatable=${borrowQuote.liquidatable}`,
    );
  } catch (err) {
    if (isOracleStaleError(err)) {
      console.warn(
        `[smoke-telarana] WARN borrow quote tolerated ORACLE_STALE/getMid revert — testnet FxOracle is unpriced. Skipping borrow intent submit.`,
      );
    } else {
      throw err;
    }
  }

  if (borrowQuote) {
    const borrowDeadline = Math.floor(Date.now() / 1000) + 3_600;
    const borrowNonce = await nextNonce("Borrow", account.address);
    const borrowTyped = buildBorrowIntent({
      chainId,
      spokeChainId,
      loanToken: market.loanToken,
      collateralToken: market.collateralToken,
      onBehalf: account.address,
      borrowAssets: borrowAmount,
      receiver: account.address,
      nonce: borrowNonce,
      deadline: borrowDeadline,
    });
    const borrowIntent = await createIntent(
      "borrow",
      {
        hubChainId: chainId,
        spokeChainId,
        loanToken: market.loanToken,
        collateralToken: market.collateralToken,
        onBehalf: account.address,
        borrowAssets: borrowAmount.toString(),
        receiver: account.address,
        nonce: borrowNonce.toString(),
        deadline: borrowDeadline,
      },
      session,
    );
    const borrowVerified = await signAndAttach("borrow", borrowIntent, borrowTyped, session);
    console.log(
      `[smoke-telarana] borrow intent verified id=${borrowVerified.id} status=${borrowVerified.status}`,
    );
  }

  // 8 + 9. repay (no oracle needed). Submit a symmetric closing intent.
  const repayAssets = borrowQuote ? borrowAmount : supplyAssets; // any positive amount works for the quote/sig path
  const repayQuote = await api<RepayQuoteResponse>("POST", "/fx-telarana/repay/quote", {
    hubChainId: chainId,
    loanToken: market.loanToken,
    collateralToken: market.collateralToken,
    assets: repayAssets.toString(),
  });
  console.log(
    `[smoke-telarana] repay quote assets=${repayQuote.assets} borrowSharesBurned=${repayQuote.borrowSharesBurned}`,
  );

  const repayDeadline = Math.floor(Date.now() / 1000) + 3_600;
  const repayNonce = await nextNonce("Repay", account.address);
  const repayTyped = buildRepayIntent({
    chainId,
    spokeChainId,
    loanToken: market.loanToken,
    collateralToken: market.collateralToken,
    onBehalf: account.address,
    assets: repayAssets,
    nonce: repayNonce,
    deadline: repayDeadline,
  });
  const repayIntent = await createIntent(
    "repay",
    {
      hubChainId: chainId,
      spokeChainId,
      loanToken: market.loanToken,
      collateralToken: market.collateralToken,
      onBehalf: account.address,
      assets: repayAssets.toString(),
      nonce: repayNonce.toString(),
      deadline: repayDeadline,
    },
    session,
  );
  const repayVerified = await signAndAttach("repay", repayIntent, repayTyped, session);
  console.log(
    `[smoke-telarana] repay intent verified id=${repayVerified.id} status=${repayVerified.status}`,
  );

  // 10 + 11. withdraw — symmetric to supply, in shares.
  const withdrawShares = BigInt(supplyQuote.supplyShares);
  const withdrawQuote = await api<WithdrawQuoteResponse>(
    "POST",
    "/fx-telarana/withdraw/quote",
    {
      hubChainId: chainId,
      loanToken: market.loanToken,
      collateralToken: market.collateralToken,
      shares: withdrawShares.toString(),
    },
  );
  console.log(
    `[smoke-telarana] withdraw quote shares=${withdrawQuote.shares} assetsOut=${withdrawQuote.assetsOut}`,
  );

  const withdrawDeadline = Math.floor(Date.now() / 1000) + 3_600;
  const withdrawNonce = await nextNonce("Withdraw", account.address);
  const withdrawTyped = buildWithdrawIntent({
    chainId,
    spokeChainId,
    loanToken: market.loanToken,
    collateralToken: market.collateralToken,
    onBehalf: account.address,
    shares: withdrawShares,
    receiver: account.address,
    nonce: withdrawNonce,
    deadline: withdrawDeadline,
  });
  const withdrawIntent = await createIntent(
    "withdraw",
    {
      hubChainId: chainId,
      spokeChainId,
      loanToken: market.loanToken,
      collateralToken: market.collateralToken,
      onBehalf: account.address,
      shares: withdrawShares.toString(),
      receiver: account.address,
      nonce: withdrawNonce.toString(),
      deadline: withdrawDeadline,
    },
    session,
  );
  const withdrawVerified = await signAndAttach(
    "withdraw",
    withdrawIntent,
    withdrawTyped,
    session,
  );
  console.log(
    `[smoke-telarana] withdraw intent verified id=${withdrawVerified.id} status=${withdrawVerified.status}`,
  );

  console.log("[smoke-telarana] OK");
}

main().catch((err) => {
  console.error("[smoke-telarana] FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
});
