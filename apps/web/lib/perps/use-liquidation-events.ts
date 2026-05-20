"use client";

/**
 * Live liquidation event feed for the trade island.
 *
 * Sources, in order of preference:
 *   1. Ponder GraphQL (TODO — PR #41 doesn't index AccountFlagged /
 *      AccountLiquidated yet; tracked under the contracts-track
 *      "ponder lift-extend" follow-up).
 *   2. Direct RPC `getLogs` over the last N blocks — works today
 *      against the deployed FxLiquidationEngine. We scope to a small
 *      window (default 5000 blocks ≈ ~17min on Arc's 0.2s blocks)
 *      so the RPC call stays cheap.
 *
 * Polling: every 10 seconds. The brief calls for WS push when the
 * Ponder WS broadcast lands (apps/api/src/routes/ws.ts) — wire that
 * in after #41 ships AccountFlagged/AccountLiquidated handlers. Until
 * then a 10s tick is the cheapest correct surface.
 *
 * `AccountFlagRescinded` is shipped by PR #28 but not yet deployed;
 * the topic filter is included so the feed starts emitting rescind
 * rows the moment the v2 engine is live. Pre-deploy, the call returns
 * an empty array for that topic which is harmless.
 */

import { useEffect, useMemo, useState } from "react";
import {
  decodeEventLog,
  parseAbiItem,
  type Hex,
} from "viem";
import { useChainId, usePublicClient } from "wagmi";

import { CONTRACTS, FxLiquidationEngineAbi } from "@bufi/contracts";

const DEFAULT_CHAIN_ID = 5042002 as const;
const POLL_MS = 10_000;
const DEFAULT_BLOCK_LOOKBACK = 5_000n;
const MAX_EVENTS = 25;

// AccountFlagRescinded is shipped by PR #28; the current ABI on this
// branch doesn't include it. Parse the signature inline so the topic
// filter is well-formed regardless of which engine version is live.
//
// NOTE: the contract event arg is named `auto` (a Solidity-legal but
// JS-reserved identifier). We rename it to `isAuto` here purely for the
// TypeScript-side decode — the topic ordering, types, and 4-byte
// signature hash are unaffected (selectors are computed from types,
// not names), so the filter still matches the on-chain emission. We
// then re-export under the original `auto` key in our typed
// LiquidationEvent.
const ACCOUNT_FLAG_RESCINDED_EVENT = parseAbiItem(
  "event AccountFlagRescinded(bytes32 indexed marketId, address indexed trader, address indexed caller, bool isAuto)",
);

const ACCOUNT_FLAG_RESCINDED_ABI = [ACCOUNT_FLAG_RESCINDED_EVENT] as const;

export type LiquidationEventKind = "flagged" | "rescinded" | "liquidated";

export interface LiquidationEvent {
  kind: LiquidationEventKind;
  marketId: Hex;
  trader: `0x${string}`;
  /** flag-raiser / rescinder / liquidator address. */
  actor: `0x${string}`;
  /** Block-timestamp unix seconds. */
  timestamp: number;
  /** Block number — used for stable sorting. */
  blockNumber: bigint;
  /** Originating tx hash for deep-linking. */
  txHash: Hex;
  /** Liquidator reward (AccountLiquidated only), raw uint256. */
  reward?: bigint;
  /** Socialized loss (AccountLiquidated only), signed int256. */
  socializedLoss?: bigint;
  /** `auto` flag from AccountFlagRescinded (true = keeper, false = direct). */
  auto?: boolean;
}

interface UseLiquidationEventsResult {
  events: LiquidationEvent[];
  isLoading: boolean;
  isError: boolean;
  lastUpdatedAt: number | null;
}

function dedupe(events: LiquidationEvent[]): LiquidationEvent[] {
  const seen = new Set<string>();
  const out: LiquidationEvent[] = [];
  for (const ev of events) {
    const key = `${ev.txHash}-${ev.kind}-${ev.trader}-${ev.marketId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
}

export function useLiquidationEvents(args?: {
  chainIdOverride?: number;
  /** Block-window to scan back from `latest`. Defaults to 5000. */
  lookbackBlocks?: bigint;
  /** Maximum events to retain. Defaults to 25. */
  maxEvents?: number;
}): UseLiquidationEventsResult {
  const wagmiChainId = useChainId();
  const chainId = args?.chainIdOverride ?? (wagmiChainId || DEFAULT_CHAIN_ID);
  const lookback = args?.lookbackBlocks ?? DEFAULT_BLOCK_LOOKBACK;
  const cap = args?.maxEvents ?? MAX_EVENTS;
  const publicClient = usePublicClient();

  const liquidationEngine = useMemo(() => {
    const contracts = (CONTRACTS as Record<number, { perps: { liquidationEngine?: `0x${string}` } }>)[
      chainId
    ];
    return contracts?.perps.liquidationEngine;
  }, [chainId]);

  const [events, setEvents] = useState<LiquidationEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!publicClient || !liquidationEngine) return;
    let cancelled = false;

    async function tick() {
      if (!publicClient || !liquidationEngine) return;
      try {
        setIsLoading(true);
        const latest = await publicClient.getBlockNumber();
        const fromBlock = latest > lookback ? latest - lookback : 0n;

        // Pull all three event types in parallel. We use ABI-typed
        // filters where the event is in our ABI (AccountFlagged,
        // AccountLiquidated) and a parseAbiItem filter for the
        // post-deploy AccountFlagRescinded event.
        const [flaggedLogs, liquidatedLogs, rescindedLogs] = await Promise.all([
          publicClient.getContractEvents({
            address: liquidationEngine,
            abi: FxLiquidationEngineAbi,
            eventName: "AccountFlagged",
            fromBlock,
            toBlock: latest,
          }),
          publicClient.getContractEvents({
            address: liquidationEngine,
            abi: FxLiquidationEngineAbi,
            eventName: "AccountLiquidated",
            fromBlock,
            toBlock: latest,
          }),
          publicClient
            .getLogs({
              address: liquidationEngine,
              event: ACCOUNT_FLAG_RESCINDED_EVENT,
              fromBlock,
              toBlock: latest,
            })
            .catch(
              () =>
                [] as Awaited<
                  ReturnType<
                    typeof publicClient.getLogs<typeof ACCOUNT_FLAG_RESCINDED_EVENT>
                  >
                >,
            ),
        ]);

        // Collect unique block numbers to batch the block-timestamp lookup
        // — one getBlock per unique block, not per log. Pending logs (the
        // `blockNumber: null` case) are filtered out — we only render
        // settled events.
        const uniqueBlocks = new Set<bigint>();
        for (const log of flaggedLogs) {
          if (log.blockNumber !== null) uniqueBlocks.add(log.blockNumber);
        }
        for (const log of liquidatedLogs) {
          if (log.blockNumber !== null) uniqueBlocks.add(log.blockNumber);
        }
        for (const log of rescindedLogs) {
          if (log.blockNumber !== null) uniqueBlocks.add(log.blockNumber);
        }
        const timestampByBlock = new Map<string, number>();
        await Promise.all(
          Array.from(uniqueBlocks).map(async (bn) => {
            const block = await publicClient.getBlock({ blockNumber: bn });
            timestampByBlock.set(bn.toString(), Number(block.timestamp));
          }),
        );

        const next: LiquidationEvent[] = [];
        for (const log of flaggedLogs) {
          if (
            log.blockNumber === null ||
            log.transactionHash === null ||
            !log.args.marketId ||
            !log.args.trader ||
            !log.args.flagger
          ) {
            continue;
          }
          const ts = timestampByBlock.get(log.blockNumber.toString()) ?? 0;
          next.push({
            kind: "flagged",
            marketId: log.args.marketId as Hex,
            trader: log.args.trader as `0x${string}`,
            actor: log.args.flagger as `0x${string}`,
            timestamp: ts,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
          });
        }
        for (const log of liquidatedLogs) {
          if (
            log.blockNumber === null ||
            log.transactionHash === null ||
            !log.args.marketId ||
            !log.args.trader ||
            !log.args.liquidator
          ) {
            continue;
          }
          const ts = timestampByBlock.get(log.blockNumber.toString()) ?? 0;
          next.push({
            kind: "liquidated",
            marketId: log.args.marketId as Hex,
            trader: log.args.trader as `0x${string}`,
            actor: log.args.liquidator as `0x${string}`,
            timestamp: ts,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
            reward: log.args.reward as bigint,
            socializedLoss: log.args.socializedLoss as bigint,
          });
        }
        for (const log of rescindedLogs) {
          if (log.blockNumber === null || log.transactionHash === null) continue;
          const ts = timestampByBlock.get(log.blockNumber.toString()) ?? 0;
          try {
            const decoded = decodeEventLog({
              abi: ACCOUNT_FLAG_RESCINDED_ABI,
              data: log.data,
              topics: log.topics,
            });
            // Decoded args carries `isAuto` (renamed because `auto` is a
            // JS-reserved identifier — see the parseAbiItem note above).
            const a = decoded.args as unknown as {
              marketId: Hex;
              trader: `0x${string}`;
              caller: `0x${string}`;
              isAuto: boolean;
            };
            next.push({
              kind: "rescinded",
              marketId: a.marketId,
              trader: a.trader,
              actor: a.caller,
              timestamp: ts,
              blockNumber: log.blockNumber,
              txHash: log.transactionHash,
              auto: a.isAuto,
            });
          } catch {
            // Pre-deploy: event signature won't match — skip.
          }
        }

        next.sort((a, b) => {
          if (a.blockNumber === b.blockNumber) return 0;
          return a.blockNumber > b.blockNumber ? -1 : 1;
        });

        if (!cancelled) {
          setEvents(dedupe(next).slice(0, cap));
          setIsError(false);
          setLastUpdatedAt(Date.now());
        }
      } catch {
        if (!cancelled) {
          setIsError(true);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void tick();
    const handle = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [publicClient, liquidationEngine, lookback, cap]);

  return { events, isLoading, isError, lastUpdatedAt };
}
