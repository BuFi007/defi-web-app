/**
 * @bufi/keeper-telarana-liquidator — Telaraña money-market liquidation keeper.
 *
 * Each tick:
 *   1. Pull liquidation candidates from the API (`GET /telarana/liquidations/candidates`).
 *   2. Re-check each candidate's health factor on-chain via the SDK (race protection
 *      — a fresh oracle tick can flip a borderline position back to healthy).
 *   3. Call `FxLiquidator.liquidate(...)` for every position whose HF is still < 1.0.
 *
 * Safety:
 *   - On any unrecognized error we log + continue (the loop never crashes).
 *   - RPC failures trigger exponential backoff up to 5 minutes.
 *   - `LIQUIDATOR_DRY_RUN=true` short-circuits before submitting any tx.
 *   - Re-checked HF must be < WAD or the candidate is skipped.
 *
 * Mirrors the file shape of @bufi/keeper-perps-liquidator.
 */
import {
  FxLiquidatorAbi,
  loadContracts,
} from "@bufi/contracts";
import {
  WAD,
  getAccountPosition,
  getMarketById,
  rankLiquidationCandidates,
  type AccountPosition,
  type LiquidationCandidate,
} from "@bufi/fx-telarana";
import {
  createKeeperWalletClient,
  requireKeeperSigner,
  runKeeper,
  sleep,
} from "@bufi/keeper-runtime";
import { withSpan } from "@bufi/observability";
import type { Address, Hex } from "viem";

const FUJI_CHAIN_ID = 43113;

const TELARANA_API_URL = process.env.TELARANA_API_URL ?? "http://localhost:3001";
const TELARANA_CHAIN_ID = Number(process.env.TELARANA_CHAIN_ID ?? FUJI_CHAIN_ID);
const LIQUIDATOR_INTERVAL_MS = Number(process.env.LIQUIDATOR_INTERVAL_MS ?? 30_000);
const LIQUIDATOR_DRY_RUN =
  (process.env.LIQUIDATOR_DRY_RUN ?? "false").toLowerCase() === "true";

const MAX_BACKOFF_MS = 5 * 60_000;
let rpcBackoffMs = 0;
// Emit "not_configured" once at first hit so operators see the
// missing-FxLiquidator banner, then short-circuit subsequent ticks
// silently. The wrapDedupe upstream already collapses within an hour,
// but the boot-log behavior is more honest: this keeper is idle by
// design until the contract is deployed; don't even warn-log past that.
let configuredWarned = false;

await runKeeper({
  name: "@bufi/keeper-telarana-liquidator",
  async tick(ctx) {
    requireKeeperSigner(ctx);

    const chainContracts = loadContracts()[TELARANA_CHAIN_ID as 43113 | 5042002];
    const liquidator = chainContracts?.telarana.fxLiquidator;
    if (!liquidator) {
      if (!configuredWarned) {
        ctx.log.warn("telarana_liquidator.not_configured", {
          chainId: TELARANA_CHAIN_ID,
          missing: "telarana.fxLiquidator",
          note: "keeper will stay idle until fxLiquidator is deployed; no further warns will fire",
        });
        configuredWarned = true;
      }
      return;
    }

    // Throttle on RPC failure — applied at the top of the tick so a flaky
    // backend can't busy-loop the keeper.
    if (rpcBackoffMs > 0) {
      ctx.log.warn("telarana_liquidator.backoff", { backoffMs: rpcBackoffMs });
      await sleep(rpcBackoffMs);
    }

    let candidates: LiquidationCandidate[];
    try {
      candidates = await withSpan(
        "telarana.liquidator.candidate-scan",
        () => fetchCandidates(),
        { "liquidator.chain_id": TELARANA_CHAIN_ID },
        "keeper.telarana-liquidator",
      );
      rpcBackoffMs = 0;
    } catch (err) {
      rpcBackoffMs = nextBackoff(rpcBackoffMs);
      ctx.log.error("telarana_liquidator.fetch_failed", {
        error: (err as Error).message,
        nextBackoffMs: rpcBackoffMs,
      });
      return;
    }

    if (candidates.length === 0) {
      // No candidates -- no log. The wrapDedupe upstream already
      // collapses identical lines, but a "0 found" tick every 30s
      // adds nothing once we know the candidate pipeline is alive.
      await sleep(Math.max(0, LIQUIDATOR_INTERVAL_MS - 1));
      return;
    }

    const wallet = LIQUIDATOR_DRY_RUN
      ? null
      : createKeeperWalletClient(ctx, TELARANA_CHAIN_ID === 43113 ? "fuji" : "arc");

    const liquidated: Array<{ id: string; tx: string }> = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const candidate of candidates) {
      try {
        const outcome = await withSpan(
          "telarana.liquidator.attempt",
          async (span): Promise<
            | { kind: "skipped"; reason: string }
            | { kind: "dry_run" }
            | { kind: "liquidated"; tx: Hex }
          > => {
            // Race protection: re-read the position right before submitting.
            const fresh = await getAccountPosition({
              account: candidate.account,
              hubChainId: candidate.hubChainId,
              marketId: candidate.marketId,
            });
            if (!fresh || !isStillLiquidatable(fresh)) {
              span.setAttribute("liquidator.skipped", "no_longer_liquidatable");
              return { kind: "skipped", reason: "no_longer_liquidatable" };
            }

            const market = await getMarketById({
              hubChainId: candidate.hubChainId,
              marketId: candidate.marketId,
            });
            if (!market) {
              span.setAttribute("liquidator.skipped", "market_not_found");
              return { kind: "skipped", reason: "market_not_found" };
            }

            if (LIQUIDATOR_DRY_RUN || !wallet) {
              ctx.log.info("telarana_liquidator.dry_run", {
                id: candidate.id,
                account: candidate.account,
                healthFactorE18: fresh.healthFactorE18?.toString() ?? null,
              });
              span.setAttribute("liquidator.dry_run", true);
              return { kind: "dry_run" };
            }

            const hash = await wallet.writeContract({
              chain: null,
              account: wallet.account!,
              address: liquidator as Address,
              abi: FxLiquidatorAbi,
              functionName: "liquidate",
              args: [
                market.loanToken,
                market.collateralToken,
                candidate.account,
                // Seize the full collateral — Morpho clamps to position.collateral
                // internally, so this lets the protocol pick the optimal amount
                // without round-trip math on the keeper side.
                fresh.collateral,
                0n,
                // No bound on repay assets — the keeper EOA must hold sufficient
                // loanToken approval to the liquidator beforehand.
                (1n << 255n) - 1n,
                true,
                [] as Hex[],
              ],
              value: 0n,
            });
            return { kind: "liquidated", tx: hash };
          },
          {
            "liquidator.candidate_id": candidate.id,
            "liquidator.account": candidate.account,
            "liquidator.market_id": candidate.marketId,
            "liquidator.chain_id": TELARANA_CHAIN_ID,
          },
          "keeper.telarana-liquidator",
        );

        if (outcome.kind === "skipped") {
          failed.push({ id: candidate.id, reason: outcome.reason });
        } else if (outcome.kind === "liquidated") {
          liquidated.push({ id: candidate.id, tx: outcome.tx });
        }
      } catch (err) {
        // Don't crash the loop — record and continue.
        failed.push({ id: candidate.id, reason: (err as Error).message });
      }
    }

    ctx.log.info("telarana_liquidator.tick", {
      event: "tick",
      chainId: TELARANA_CHAIN_ID,
      candidatesFound: candidates.length,
      liquidated: liquidated.length,
      failed: failed.length,
      dryRun: LIQUIDATOR_DRY_RUN,
      txs: liquidated,
      ...(failed.length > 0 ? { failures: failed } : {}),
    });

    // The runtime's KEEPER_POLL_MS is independent of LIQUIDATOR_INTERVAL_MS.
    // Sleeping here aligns ticks with the operator-configured cadence.
    await sleep(Math.max(0, LIQUIDATOR_INTERVAL_MS - 1));
  },
});

// ───────────────────────── helpers ─────────────────────────────────────────

function isStillLiquidatable(position: AccountPosition): boolean {
  if (position.healthFactorE18 === null) return false;
  return position.healthFactorE18 < WAD;
}

function nextBackoff(current: number): number {
  if (current === 0) return 5_000;
  return Math.min(current * 2, MAX_BACKOFF_MS);
}

interface CandidatesEnvelope {
  candidates?: Array<Record<string, unknown>>;
}

async function fetchCandidates(): Promise<LiquidationCandidate[]> {
  const url = new URL("/telarana/liquidations/candidates", TELARANA_API_URL);
  // Pin to the keeper's target chain — the route accepts hubChainId as a query.
  url.searchParams.set("hubChainId", String(TELARANA_CHAIN_ID));
  url.searchParams.set("limit", "50");

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`candidates fetch failed: ${res.status} ${res.statusText}`);
  }
  const payload = (await res.json()) as CandidatesEnvelope;
  const raw = payload.candidates ?? [];

  // The API marshals bigints as strings. Convert + rank locally so we get
  // a canonical LiquidationCandidate[] regardless of upstream ordering.
  const positions: AccountPosition[] = raw.map((entry) => hydratePosition(entry));
  return rankLiquidationCandidates(positions);
}

function hydratePosition(raw: Record<string, unknown>): AccountPosition {
  const optBig = (k: string): bigint | null => {
    const v = raw[k];
    return v === null || v === undefined ? null : BigInt(v as string | number | bigint);
  };
  const reqBig = (k: string): bigint => {
    const v = raw[k];
    if (v === null || v === undefined)
      throw new Error(`candidate missing required field: ${k}`);
    return BigInt(v as string | number | bigint);
  };
  return {
    id: String(raw.id ?? ""),
    marketId: raw.marketId as Hex,
    hubChainId: Number(raw.hubChainId) as 43113 | 5042002,
    account: raw.account as Address,
    supplyShares: reqBig("supplyShares"),
    borrowShares: reqBig("borrowShares"),
    collateral: reqBig("collateral"),
    supplyAssets: reqBig("supplyAssets"),
    borrowAssets: reqBig("borrowAssets"),
    collateralPriceE36: optBig("collateralPriceE36"),
    oraclePublishedAt: optBig("oraclePublishedAt"),
    healthFactorE18: optBig("healthFactorE18"),
    liquidatable: Boolean(raw.liquidatable),
  };
}

// Graceful shutdown — the runKeeper loop is infinite, but Bun honours these
// signals so the process exits cleanly when systemd/Docker stops it.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    // eslint-disable-next-line no-console
    console.log(`[telarana_liquidator] received ${sig}, exiting`);
    process.exit(0);
  });
}
