"use client";

/**
 * MarginPanel — deposit/withdraw USDC margin against FxMarginAccount.
 *
 * Surfaces the three margin numbers (`total`, `free`, `reserved`) from
 * the on-chain account in a small card, plus two amount inputs +
 * Deposit / Withdraw CTAs. Both flows go through the simulate-first
 * `useDepositMargin` / `useWithdrawMargin` hooks shipped in PR #49 —
 * if the call would revert, the inline `<OrderFeedback>` card surfaces
 * the decoded reason and no wallet popup ever fires.
 *
 * Posture:
 *   - Withdraw is disabled (CTA + sim) when the requested amount
 *     exceeds `free` margin. The contract would revert with
 *     `InsufficientFreeMargin`, but a client-side guard saves the
 *     round-trip.
 *   - Deposit is disabled when the requested amount exceeds the
 *     wallet's USDC balance (same posture as the lending supply path).
 *     Pre-flight ERC-20 approve is handled inside `useDepositMargin`.
 *   - After a successful deposit/withdraw we invalidate the margin
 *     query so the displayed numbers refresh; the underlying hooks
 *     resolve when the on-chain receipt is mined.
 */

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatUnits, parseUnits, type Address } from "viem";
import { useAccount, useBalance, useChainId } from "wagmi";

import { Icon, fmtUSD } from "./data";
import { Hint } from "./hint";
import { OrderFeedback } from "./order-feedback";
import { useDepositMargin, useWithdrawMargin } from "@/lib/perps/use-perp-writes";
import { useMarginBalances } from "@/lib/perps/use-margin-balances";
import type { SimError } from "@/lib/web3/use-simulated-write";

// Mirrors USDC_BY_CHAIN in panels.tsx — the chain-keyed map exists in
// two places today (the deposit hook also keeps a copy). Kept local
// here so a future consolidation just deletes this constant; the
// component itself doesn't reach across files.
const USDC_BY_CHAIN: Record<number, Address> = {
  43113: "0x5425890298aed601595a70AB815c96711a31Bc65",
  5042002: "0x3600000000000000000000000000000000000000",
};

function useUsdcWalletBalance(address: Address | undefined): {
  raw: bigint;
  decimals: number;
} {
  const chainId = useChainId();
  const token = USDC_BY_CHAIN[chainId];
  const { data } = useBalance({
    address,
    token,
    chainId: (token ? chainId : undefined) as 43113 | 5042002 | undefined,
    query: { enabled: Boolean(address && token) },
  });
  if (!data) return { raw: 0n, decimals: 6 };
  return { raw: data.value, decimals: data.decimals ?? 6 };
}

function fmtMargin(raw: bigint | undefined, decimals: number): string {
  if (raw == null) return "—";
  try {
    return fmtUSD(Number(formatUnits(raw, decimals)));
  } catch {
    return "—";
  }
}

/** Parse a user-typed decimal-USDC amount into 6-decimal base units.
 *  Returns `null` if the input is empty or NaN — the CTA disables
 *  itself, so we never end up sending `0` to the deposit hook. */
function parseAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const raw = parseUnits(trimmed, decimals);
    return raw > 0n ? raw : null;
  } catch {
    return null;
  }
}

export function MarginPanel() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const queryClient = useQueryClient();

  const balances = useMarginBalances();
  const decimals = balances.data?.decimals ?? 6;
  const free = balances.data?.free;
  const total = balances.data?.total;
  const reserved = balances.data?.reserved;
  const wallet = useUsdcWalletBalance(address as Address | undefined);

  const [depositInput, setDepositInput] = useState("");
  const [withdrawInput, setWithdrawInput] = useState("");
  const [localError, setLocalError] = useState<SimError | null>(null);

  const deposit = useDepositMargin();
  const withdraw = useWithdrawMargin();

  const depositAmount = useMemo(
    () => parseAmount(depositInput, decimals),
    [depositInput, decimals],
  );
  const withdrawAmount = useMemo(
    () => parseAmount(withdrawInput, decimals),
    [withdrawInput, decimals],
  );

  // Pre-flight: client-side guard on withdraw so we don't burn an RPC
  // round-trip just to learn the contract would revert with
  // InsufficientFreeMargin. Surface a SimError-shaped warning inline so
  // OrderFeedback can render the same way as a real revert.
  const overdrawError: SimError | null = useMemo(() => {
    if (!withdrawAmount) return null;
    if (free == null) return null;
    if (withdrawAmount <= free) return null;
    return {
      short: "Insufficient free margin",
      full:
        `Trying to withdraw ${formatUnits(withdrawAmount, decimals)} USDC ` +
        `but only ${formatUnits(free, decimals)} USDC is free. Reduce ` +
        `the amount or close a position to release reserved margin.`,
      reason: "InsufficientFreeMargin",
    };
  }, [withdrawAmount, free, decimals]);

  // Same guard on the deposit side — when the requested amount exceeds
  // the wallet's USDC balance, ERC-20 would revert with
  // ERC20InsufficientBalance. The deposit hook would catch it at
  // simulate-time too; this just saves the popup-less round-trip.
  const walletShortError: SimError | null = useMemo(() => {
    if (!depositAmount) return null;
    if (depositAmount <= wallet.raw) return null;
    return {
      short: "Insufficient USDC balance",
      full:
        `Trying to deposit ${formatUnits(depositAmount, decimals)} USDC ` +
        `but the wallet holds ${formatUnits(wallet.raw, wallet.decimals)} USDC. ` +
        `Top up or reduce the deposit amount.`,
      reason: "ERC20InsufficientBalance",
    };
  }, [depositAmount, wallet.raw, wallet.decimals, decimals]);

  const depositDisabled =
    !isConnected ||
    !depositAmount ||
    deposit.simulating ||
    deposit.submitting ||
    Boolean(walletShortError);
  const withdrawDisabled =
    !isConnected ||
    !withdrawAmount ||
    withdraw.simulating ||
    withdraw.submitting ||
    Boolean(overdrawError);

  const onDeposit = async () => {
    if (!depositAmount) return;
    setLocalError(null);
    deposit.clearError();
    const result = await deposit.submit({ amount: depositAmount, chainId });
    if (result.txHash) {
      setDepositInput("");
      // Optimistic refresh — the on-chain receipt has already mined by
      // the time submit() returns, but the multicall query needs a
      // poke to refetch immediately rather than wait for the 8s tick.
      void queryClient.invalidateQueries({
        queryKey: ["perps", "margin-balances"],
      });
    }
  };

  const onWithdraw = async () => {
    if (!withdrawAmount) return;
    setLocalError(null);
    withdraw.clearError();
    const result = await withdraw.submit({ amount: withdrawAmount, chainId });
    if (result.txHash) {
      setWithdrawInput("");
      void queryClient.invalidateQueries({
        queryKey: ["perps", "margin-balances"],
      });
    }
  };

  // Surface order of inline errors: client-side guards first (cheapest
  // signal), then the hook-level sim errors. Only one renders at a time
  // — fresh user input clears the local guard automatically.
  const activeError =
    overdrawError ??
    walletShortError ??
    deposit.simError ??
    withdraw.simError ??
    localError;

  return (
    <div className="card margin-panel-card">
      <div className="card-head">
        <div className="card-title">
          <span className="card-icon">
            <Icon name="vault" size={15} />
          </span>
          <span>
            Margin Account{" "}
            <Hint w={280}>
              On-chain collateral backing your perp positions. Free
              margin can be withdrawn or used to open new trades;
              reserved margin is locked up against open positions.
            </Hint>
          </span>
        </div>
      </div>
      <div
        className="margin-summary"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 8,
          padding: "8px 12px 4px",
        }}
      >
        <div className="hsum-card" style={{ padding: 8 }}>
          <div className="hsum-l">
            Total{" "}
            <Hint w={220}>
              All margin you&apos;ve deposited — free + reserved.
            </Hint>
          </div>
          <div className="hsum-v mono">
            {balances.isLoading ? "…" : fmtMargin(total, decimals)}
          </div>
        </div>
        <div className="hsum-card" style={{ padding: 8 }}>
          <div className="hsum-l">
            Free{" "}
            <Hint w={220}>Available to withdraw or back new trades.</Hint>
          </div>
          <div
            className="hsum-v mono"
            style={{ color: "var(--profit-ink)" }}
          >
            {balances.isLoading ? "…" : fmtMargin(free, decimals)}
          </div>
        </div>
        <div className="hsum-card" style={{ padding: 8 }}>
          <div className="hsum-l">
            Reserved{" "}
            <Hint w={220}>
              Locked up against open positions. Released when you close
              or reduce a trade.
            </Hint>
          </div>
          <div
            className="hsum-v mono"
            style={{ color: "var(--ink-3)" }}
          >
            {balances.isLoading ? "…" : fmtMargin(reserved, decimals)}
          </div>
        </div>
      </div>

      <div
        className="margin-actions"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          padding: "8px 12px 12px",
        }}
      >
        <div className="field">
          <div className="field-label">
            <span>Deposit</span>
            <button
              type="button"
              onClick={() => {
                // Use the wallet's full balance — formatted at its
                // native decimals so a partial-unit amount round-trips
                // through parseUnits without loss.
                setDepositInput(formatUnits(wallet.raw, wallet.decimals));
              }}
              style={{
                background: "transparent",
                border: 0,
                fontSize: 11,
                fontWeight: 700,
                color: "var(--ink-3)",
                cursor: "pointer",
              }}
              title="Use the wallet's full USDC balance"
            >
              max
            </button>
          </div>
          <div className="input-wrap">
            <input
              type="text"
              placeholder="0.00"
              value={depositInput}
              onChange={(e) => {
                setDepositInput(e.target.value);
                deposit.clearError();
                setLocalError(null);
              }}
              inputMode="decimal"
              aria-label="Deposit amount"
            />
            <span className="unit">USDC</span>
          </div>
          <button
            type="button"
            className="cta"
            onClick={onDeposit}
            disabled={depositDisabled}
            style={{
              marginTop: 6,
              width: "100%",
              padding: "8px 12px",
              borderRadius: 10,
              border: 0,
              cursor: depositDisabled ? "not-allowed" : "pointer",
              opacity: depositDisabled ? 0.55 : 1,
              background: "var(--profit-ink, #10b981)",
              color: "white",
              fontWeight: 800,
              fontSize: 12.5,
            }}
            aria-busy={deposit.simulating || deposit.submitting}
            data-state={
              deposit.simulating
                ? "simulating"
                : deposit.submitting
                  ? "submitting"
                  : "idle"
            }
          >
            {deposit.simulating
              ? "Validating…"
              : deposit.submitting
                ? "Confirming…"
                : "Deposit"}
          </button>
        </div>

        <div className="field">
          <div className="field-label">
            <span>Withdraw</span>
            <button
              type="button"
              onClick={() => {
                if (free == null) return;
                setWithdrawInput(formatUnits(free, decimals));
              }}
              style={{
                background: "transparent",
                border: 0,
                fontSize: 11,
                fontWeight: 700,
                color: "var(--ink-3)",
                cursor: "pointer",
              }}
              title="Use the full free-margin balance"
            >
              max
            </button>
          </div>
          <div className="input-wrap">
            <input
              type="text"
              placeholder="0.00"
              value={withdrawInput}
              onChange={(e) => {
                setWithdrawInput(e.target.value);
                withdraw.clearError();
                setLocalError(null);
              }}
              inputMode="decimal"
              aria-label="Withdraw amount"
            />
            <span className="unit">USDC</span>
          </div>
          <button
            type="button"
            className="cta"
            onClick={onWithdraw}
            disabled={withdrawDisabled}
            style={{
              marginTop: 6,
              width: "100%",
              padding: "8px 12px",
              borderRadius: 10,
              border: 0,
              cursor: withdrawDisabled ? "not-allowed" : "pointer",
              opacity: withdrawDisabled ? 0.55 : 1,
              background: "var(--loss-ink, #ef4444)",
              color: "white",
              fontWeight: 800,
              fontSize: 12.5,
            }}
            aria-busy={withdraw.simulating || withdraw.submitting}
            data-state={
              withdraw.simulating
                ? "simulating"
                : withdraw.submitting
                  ? "submitting"
                  : "idle"
            }
          >
            {withdraw.simulating
              ? "Validating…"
              : withdraw.submitting
                ? "Confirming…"
                : "Withdraw"}
          </button>
        </div>
      </div>

      <OrderFeedback
        simError={activeError}
        onDismiss={() => {
          setLocalError(null);
          deposit.clearError();
          withdraw.clearError();
        }}
      />
    </div>
  );
}
