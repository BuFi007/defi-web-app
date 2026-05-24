"use client";

/**
 * React hooks that drive the LoanTab. All on-chain reads come through the
 * Hono fx-telarana surface so we keep RPC fan-out on the server.
 *
 * The hooks intentionally do NOT use react-query yet — keep the dep surface
 * low and let the component own simple state. Switch to TanStack Query
 * later if we need cache sharing across tabs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import {
  useAccount,
  usePublicClient,
  useSignTypedData,
  useWalletClient,
} from "wagmi";

import { FxMarketRegistryAbi } from "@bufi/contracts";

import { toast } from "@/components/ui/use-toast";
import { errMsg } from "@/utils";

// Minimal ERC-20 ABI for allowance + approve. We rebuild rather than
// pull from a shared package because the registry direct-call path only
// needs these two functions and adding a workspace dep on @bufi/contracts
// would be overkill.
const ERC20_ABI = [
  {
    type: "function",
    stateMutability: "view",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

import {
  fetchIntentNonce,
  fetchMarkets,
  fetchPositions,
  postBorrowQuote,
  createIntent,
  submitIntentSignature,
  type BorrowQuoteBody,
  type BorrowQuoteResponseSerialized,
  type TelaranaIntentDoc,
  type TelaranaMarketSerialized,
  type TelaranaPositionSerialized,
} from "./client";
import {
  getTelaranaAddress,
  listTelaranaMarkets,
  TELARANA_DEPLOYMENTS,
  type TelaranaHubChainId,
} from "@bufi/contracts/telarana";
import {
  buildTelaranaSessionTypedData,
  readCachedSession,
  sessionHeaders,
  writeCachedSession,
  type TelaranaWalletSessionProof,
} from "./session";
import { prettifySimError } from "@/lib/web3/use-simulated-write";

/**
 * Backend errors arrive as `Error` instances annotated with `code`/`status`
 * by client.ts → `unwrap`. The fx-telarana package wraps Pyth/Redstone
 * staleness as `OracleStaleError` with code `ORACLE_STALE` (status 503).
 */
export const ORACLE_STALE_CODE = "ORACLE_STALE" as const;

export function isOracleStaleError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; name?: string; message?: string };
  if (e.code === ORACLE_STALE_CODE) return true;
  if (e.name === "OracleStaleError") return true;
  // Last-ditch substring match for backends that surface the message raw.
  return typeof e.message === "string" && /oracle.*stale|stale.*price/i.test(e.message);
}

/**
 * Module-level cooldown shared by every quote/submit caller. We dedupe
 * toasts so a burst of refresh polls only nags the user once per cooldown
 * window.
 */
const ORACLE_STALE_TOAST_COOLDOWN_MS = 5_000;
let lastOracleStaleToastAt = 0;

export function emitOracleStaleToast(): void {
  const now = Date.now();
  if (now - lastOracleStaleToastAt < ORACLE_STALE_TOAST_COOLDOWN_MS) return;
  lastOracleStaleToastAt = now;
  toast({
    title: "Oracle price is stale",
    description: "Retry in a moment — fresh Pyth/Redstone data is on its way.",
    variant: "destructive",
  });
}

const MARKETS_REFRESH_MS = 30_000;
const POSITIONS_REFRESH_MS = 20_000;
// Intent deadlines must stay within the Circle Gateway signer window
// (~7200s). We pick 1 hour so user-side latency is forgiving.
const INTENT_DEADLINE_SKEW_SECONDS = 3_600;

export interface MarketsState {
  markets: TelaranaMarketSerialized[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Static fallback: build TelaranaMarketSerialized[] from the deployment
 * manifests in @bufi/contracts. We have the marketId hash, loan/collateral
 * addresses, oracle adapter address, the IrmMock, AND the per-market LLTV
 * (from the manifest's `marketLltvs` map) all from the manifest; the only
 * runtime-only field is `state` (totalSupplyAssets / borrow / util), which
 * stays undefined so the UI renders honest em-dashes for APY/util/tvl.
 * The on-chain identity (marketId + loanToken + decimals + lltv) IS
 * populated, so `market.onchain` works even when `/fx-telarana/markets`
 * is unreachable.
 */
function staticMarketsSerialized(): TelaranaMarketSerialized[] {
  return listTelaranaMarkets().map((m) => {
    const deployment = TELARANA_DEPLOYMENTS[m.chainId as TelaranaHubChainId];
    return {
      id: m.id,
      hubChainId: m.chainId as 43113 | 5042002,
      hubName: m.hubName,
      isLive: true,
      loanToken: m.loanToken,
      collateralToken: m.collateralToken,
      oracle: m.morphoOracleAdapter,
      irm: deployment.contracts.IrmMock,
      lltv: m.lltv.toString(),
      // state stays undefined -> toLoanMarket() renders supply/borrow/util/tvl
      // as null -> "—" in the UI. Honest about not knowing the live state.
    } satisfies TelaranaMarketSerialized;
  });
}

export function useMarkets(): MarketsState {
  // Seed with the static set so the ActionCard's Confirm button is enabled
  // from first paint — no waiting on the API, no "feed: Failed to fetch"
  // window where deposits silently break.
  const [markets, setMarkets] = useState<TelaranaMarketSerialized[]>(() =>
    staticMarketsSerialized(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchMarkets();
      // Merge: prefer the live row when it carries `state` (runtime data);
      // keep the static row otherwise so we don't regress to no-onchain.
      const liveById = new Map(data.markets.map((m) => [m.id.toLowerCase(), m]));
      const merged = staticMarketsSerialized().map(
        (s) => liveById.get(s.id.toLowerCase()) ?? s,
      );
      // Include any live-only markets the static manifest doesn't know about
      // (e.g. a market deployed AFTER the last @bufi/contracts sync).
      const staticIds = new Set(
        staticMarketsSerialized().map((s) => s.id.toLowerCase()),
      );
      for (const m of data.markets) {
        if (!staticIds.has(m.id.toLowerCase())) merged.push(m);
      }
      setMarkets(merged);
      setError(null);
    } catch (err) {
      // Keep the static set in place — caller still sees real markets,
      // just without live util/tvl numbers. The error string surfaces
      // in the LoanTab's "markets feed:" banner.
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load();
    const id = window.setInterval(() => {
      if (!cancelled) void load();
    }, MARKETS_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [load]);

  return { markets, loading, error, refresh: () => void load() };
}

export interface PositionsState {
  positions: TelaranaPositionSerialized[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function usePositions(address: Address | undefined): PositionsState {
  const [positions, setPositions] = useState<TelaranaPositionSerialized[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) {
      setPositions([]);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchPositions(address);
      setPositions(data.positions);
      setError(null);
    } catch (err) {
      if (isOracleStaleError(err)) emitOracleStaleToast();
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    void load();
    if (!address) return undefined;
    const id = window.setInterval(() => {
      if (!cancelled) void load();
    }, POSITIONS_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [address, load]);

  return { positions, loading, error, refresh: () => void load() };
}

export interface QuoteBorrowState {
  quote: BorrowQuoteResponseSerialized | null;
  loading: boolean;
  error: string | null;
}

export function useQuoteBorrow(body: BorrowQuoteBody | null): QuoteBorrowState {
  const [quote, setQuote] = useState<BorrowQuoteResponseSerialized | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Serialize a stable key so the effect only fires on real input changes.
  const key = useMemo(() => {
    if (!body) return null;
    return JSON.stringify({
      ...body,
      collateral: body.collateral.toString(),
      borrowAmount: body.borrowAmount.toString(),
    });
  }, [body]);

  useEffect(() => {
    if (!body || !key) {
      setQuote(null);
      return undefined;
    }
    if (body.borrowAmount === 0n && body.collateral === 0n) {
      setQuote(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    postBorrowQuote(body)
      .then((data) => {
        if (cancelled) return;
        setQuote(data);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (isOracleStaleError(err)) emitOracleStaleToast();
        setError(errMsg(err));
        setQuote(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [body, key]);

  return { quote, loading, error };
}

export type LendingActionKind =
  | "supply"
  | "borrow"
  | "repay"
  | "withdraw"
  | "collateral/supply"
  | "collateral/withdraw";

const ACTION_TO_INTENT_KIND: Record<LendingActionKind, TelaranaIntentDoc["kind"]> = {
  supply: "Supply",
  borrow: "Borrow",
  repay: "Repay",
  withdraw: "Withdraw",
  "collateral/supply": "SupplyCollateral",
  "collateral/withdraw": "WithdrawCollateral",
};

export interface LendingActionInput {
  kind: LendingActionKind;
  hubChainId: 43113 | 5042002;
  spokeChainId: number;
  loanToken: Address;
  collateralToken: Address;
  onBehalf: Address;
  receiver?: Address;
  /** Amount in atomic units; meaning depends on `kind`. */
  amount: bigint;
}

export interface LendingActionResult {
  /** Tx hash of the FxMarketRegistry call. If an ERC-20 approve was
   *  required (supply/repay/collateral/supply with insufficient
   *  allowance), `approveTx` holds that hash too. */
  tx: Hex;
  approveTx?: Hex;
}

interface SessionEnsureContext {
  proofRef: { current: TelaranaWalletSessionProof | null };
  signTypedDataAsync: ReturnType<typeof useSignTypedData>["signTypedDataAsync"];
}

async function ensureSession(
  ctx: SessionEnsureContext,
  account: Address,
  chainId: number,
): Promise<TelaranaWalletSessionProof> {
  const cached = ctx.proofRef.current ?? readCachedSession(account, chainId);
  if (cached) {
    ctx.proofRef.current = cached;
    return cached;
  }
  const session = buildTelaranaSessionTypedData({ address: account, chainId });
  const signature = (await ctx.signTypedDataAsync({
    domain: session.typedData.domain,
    types: session.typedData.types,
    primaryType: session.typedData.primaryType,
    message: session.typedData.message,
  })) as Hex;
  const proof: TelaranaWalletSessionProof = {
    address: account,
    chainId,
    message: session.message,
    signature,
    iat: session.iat,
    exp: session.exp,
    typedData: session.typedData,
  };
  writeCachedSession(proof);
  ctx.proofRef.current = proof;
  return proof;
}

function buildIntentBody(input: LendingActionInput, nonce: bigint, deadline: number): Record<string, unknown> {
  const base = {
    hubChainId: input.hubChainId,
    spokeChainId: input.spokeChainId,
    loanToken: input.loanToken,
    collateralToken: input.collateralToken,
    onBehalf: input.onBehalf,
    nonce: nonce.toString(),
    deadline,
  };
  switch (input.kind) {
    case "supply":
      return { ...base, assets: input.amount.toString() };
    case "repay":
      return { ...base, assets: input.amount.toString() };
    case "borrow":
      return {
        ...base,
        borrowAssets: input.amount.toString(),
        receiver: input.receiver ?? input.onBehalf,
      };
    case "withdraw":
      return {
        ...base,
        shares: input.amount.toString(),
        receiver: input.receiver ?? input.onBehalf,
      };
    case "collateral/supply":
    case "collateral/withdraw":
      return { ...base, collateral: input.amount.toString() };
  }
}

function typedDataForSigning(intent: TelaranaIntentDoc) {
  const message: Record<string, string | bigint | number | Address> = {};
  for (const [k, v] of Object.entries(intent.typedData.message)) {
    // The backend returns bigint fields as decimal strings — viem's
    // signTypedData needs bigints back. Address fields stay strings.
    if (/^[0-9]+$/.test(v)) {
      message[k] = BigInt(v);
    } else {
      message[k] = v;
    }
  }
  return {
    domain: intent.typedData.domain,
    types: intent.typedData.types,
    primaryType: intent.typedData.primaryType,
    message,
  };
}

export interface UseLendingActionResult {
  submit: (input: LendingActionInput) => Promise<LendingActionResult>;
  loading: boolean;
  error: string | null;
}

/** Action kinds whose execution moves tokens FROM the user's wallet
 *  into Morpho via the registry. These require an ERC-20 approve on
 *  the moved token (loanToken for supply/repay, collateralToken for
 *  collateral/supply) before the registry call. */
const ACTIONS_REQUIRING_APPROVE = new Set<LendingActionKind>([
  "supply",
  "repay",
  "collateral/supply",
]);

/** Resolve (registry call, token-being-moved) per action kind. */
function planAction(input: LendingActionInput): {
  fn: "supply" | "borrow" | "repay" | "withdraw" | "supplyCollateral" | "withdrawCollateral";
  movedToken: Address | null;
  // FxMarketRegistry args, in ABI order.
  args:
    | readonly [Address, Address, bigint, Address] // supply / repay / supplyCollateral
    | readonly [Address, Address, bigint, Address, Address]; // borrow / withdraw / withdrawCollateral
} {
  const { kind, loanToken, collateralToken, amount, onBehalf, receiver } = input;
  const recipient = receiver ?? onBehalf;
  switch (kind) {
    case "supply":
      return {
        fn: "supply",
        movedToken: loanToken,
        args: [loanToken, collateralToken, amount, onBehalf] as const,
      };
    case "repay":
      return {
        fn: "repay",
        movedToken: loanToken,
        args: [loanToken, collateralToken, amount, onBehalf] as const,
      };
    case "borrow":
      return {
        fn: "borrow",
        movedToken: null,
        args: [loanToken, collateralToken, amount, onBehalf, recipient] as const,
      };
    case "withdraw":
      return {
        fn: "withdraw",
        movedToken: null,
        args: [loanToken, collateralToken, amount, onBehalf, recipient] as const,
      };
    case "collateral/supply":
      return {
        fn: "supplyCollateral",
        movedToken: collateralToken,
        args: [loanToken, collateralToken, amount, onBehalf] as const,
      };
    case "collateral/withdraw":
      return {
        fn: "withdrawCollateral",
        movedToken: null,
        args: [loanToken, collateralToken, amount, onBehalf, recipient] as const,
      };
  }
}

export function useLendingAction(): UseLendingActionResult {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (input: LendingActionInput): Promise<LendingActionResult> => {
      if (!address) {
        throw new Error("Connect a wallet before submitting a lending action.");
      }
      if (address.toLowerCase() !== input.onBehalf.toLowerCase()) {
        throw new Error("onBehalf must match the connected wallet.");
      }
      if (!walletClient) {
        throw new Error("Wallet client not ready. Try again once your wallet finishes connecting.");
      }
      if (!publicClient) {
        throw new Error("Public client not ready for this chain.");
      }

      setLoading(true);
      setError(null);
      try {
        // 1. Pick the right FxMarketRegistry entry point + figure out
        //    whether we need an ERC-20 approve first.
        const plan = planAction(input);
        const registry = getTelaranaAddress(
          input.hubChainId as TelaranaHubChainId,
          "FxMarketRegistry",
        );

        // 2. Approve if the action moves tokens from the user AND the
         //   current allowance is below the amount we're about to spend.
        //    Use exact-amount approve (NOT MaxUint256) so a leftover
        //    approval can't be drained by a future contract bug.
        let approveTx: Hex | undefined;
        if (ACTIONS_REQUIRING_APPROVE.has(input.kind) && plan.movedToken) {
          const current = (await publicClient.readContract({
            address: plan.movedToken,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, registry],
          })) as bigint;
          if (current < input.amount) {
            approveTx = (await walletClient.writeContract({
              address: plan.movedToken,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [registry, input.amount],
            })) as Hex;
            // Wait for confirmation so the registry call sees the new
            // allowance. Without this the next tx races and reverts
            // with ERC20InsufficientAllowance on Arc's faster blocks.
            await publicClient.waitForTransactionReceipt({ hash: approveTx });
          }
        }

        // 3. Hit the registry. Wrap with simulateContract FIRST so any
        //    revert (oracle stale, LLTV breach, insufficient liquidity,
        //    bad market) surfaces inline BEFORE the wallet popup. This
        //    is the UX trust signal the demo is built around — users
        //    no longer burn gas to discover a revert. On simulation
        //    failure we throw a tagged Error so callers can render the
        //    decoded reason in the existing toast / action-card slot.
        let tx: Hex;
        try {
          // Cast publicClient.simulateContract through `any` to escape
          // the generic-heavy return-type union (TS2590 otherwise).
          // viem still validates abi/args at runtime.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sim = (await (publicClient as any).simulateContract({
            address: registry,
            abi: FxMarketRegistryAbi,
            functionName: plan.fn,
            args: plan.args,
            account: address,
          })) as { request: unknown };
          tx = (await walletClient.writeContract(
            // viem narrows the request by function name; passing the
            // pre-validated shape through `as never` keeps the union
            // type happy without losing the runtime safety we built
            // into planAction() + simulateContract.
            sim.request as never,
          )) as Hex;
        } catch (simOrSubmitErr) {
          const pretty = prettifySimError(simOrSubmitErr);
          const tagged = new Error(
            pretty.reason
              ? `${pretty.short} — ${pretty.reason}`
              : pretty.short,
          ) as Error & { simError?: typeof pretty };
          tagged.simError = pretty;
          throw tagged;
        }

        return { tx, approveTx };
      } catch (err) {
        if (isOracleStaleError(err)) emitOracleStaleToast();
        setError(errMsg(err));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [address, walletClient, publicClient],
  );

  return { submit, loading, error };
}
