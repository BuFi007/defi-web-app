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
import { useAccount, useSignTypedData } from "wagmi";

import { toast } from "@/components/ui/use-toast";
import { errMsg } from "@/utils";

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
 * addresses, oracle adapter address, and the IrmMock from the manifest;
 * the only runtime-only field is `state` (totalSupplyAssets / borrow /
 * util), which stays undefined so the UI renders honest em-dashes for
 * APY/util/tvl. The on-chain identity (marketId + loanToken + decimals)
 * IS populated, which is what `market.onchain` needs — the Confirm Lend
 * button + the BALANCE row + the useLendingAction submit path ALL work
 * even when `/fx-telarana/markets` is unreachable.
 *
 * LLTV defaults to 86% (0.86e18). All M1-M4 markets ship with this
 * value per the deploy scripts; revisit if a non-86% market lands.
 */
const STATIC_LLTV = "860000000000000000"; // 0.86e18

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
      lltv: STATIC_LLTV,
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
  intent: TelaranaIntentDoc;
  verified: TelaranaIntentDoc;
  signature: Hex;
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

export function useLendingAction(): UseLendingActionResult {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const proofRef = useRef<TelaranaWalletSessionProof | null>(null);

  const submit = useCallback(
    async (input: LendingActionInput): Promise<LendingActionResult> => {
      if (!address) {
        throw new Error("Connect a wallet before signing intents.");
      }
      if (address.toLowerCase() !== input.onBehalf.toLowerCase()) {
        throw new Error("onBehalf must match the connected wallet.");
      }

      setLoading(true);
      setError(null);
      try {
        const proof = await ensureSession({ proofRef, signTypedDataAsync }, address, input.hubChainId);
        const headers = sessionHeaders(proof);

        const intentKind = ACTION_TO_INTENT_KIND[input.kind];
        const nonceResp = await fetchIntentNonce({
          hubChainId: input.hubChainId,
          action: intentKind,
          account: address,
        });
        const nonce = BigInt(nonceResp.nextNonce);
        const deadline = Math.floor(Date.now() / 1000) + INTENT_DEADLINE_SKEW_SECONDS;
        const body = buildIntentBody(input, nonce, deadline);

        const intent = await createIntent({ path: input.kind, body, session: headers });

        const intentTypedData = typedDataForSigning(intent);
        const signature = (await signTypedDataAsync({
          domain: intentTypedData.domain,
          types: intentTypedData.types,
          primaryType: intentTypedData.primaryType,
          message: intentTypedData.message as Record<string, unknown>,
        })) as Hex;

        const verified = await submitIntentSignature({
          path: input.kind,
          id: intent.id,
          signer: address,
          signature,
        });

        return { intent, verified, signature };
      } catch (err) {
        if (isOracleStaleError(err)) emitOracleStaleToast();
        setError(errMsg(err));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [address, signTypedDataAsync],
  );

  return { submit, loading, error };
}
