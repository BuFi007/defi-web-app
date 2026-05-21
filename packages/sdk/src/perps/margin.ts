/**
 * Margin deposit / withdraw flow.
 *
 * These are direct on-chain calls (no API mediation needed) — the SDK
 * imports the `FxMarginAccount` ABI from `@bufi/contracts` and the
 * integrator's viem `WalletClient` writes the tx.
 *
 * The `FxMarginAccount` contract custodies USDC margin for the trader.
 * Before calling `depositMargin`, the trader must approve the
 * `marginAccount` for the desired USDC amount via the USDC ERC-20 contract.
 */

import type { Account, Address, Hex, WalletClient, PublicClient } from "viem";

import { FxMarginAccountAbi } from "@bufi/contracts";

import type { ChainId } from "../chains";
import type { BufiClient } from "../client";
import { getPerpsContracts } from "../contracts";

/** Arguments for {@link depositMargin}. */
export interface DepositMarginArgs {
  /** USDC amount in atomic 6dp units (e.g. `10_000_000n` = 10 USDC). */
  amount: bigint;
  /** Override the client's default chain id. */
  chainId?: ChainId;
  walletClient: WalletClient;
  account?: Account;
}

/**
 * Submit a `depositMargin(amount)` transaction to the `FxMarginAccount`
 * contract on the active chain.
 *
 * NOTE: this does NOT handle the prerequisite USDC `approve`. Integrators
 * must approve the margin-account spender first.
 *
 * Returns the transaction hash. Use a `PublicClient.waitForTransactionReceipt`
 * to await inclusion.
 */
export async function depositMargin(
  client: BufiClient,
  args: DepositMarginArgs,
): Promise<Hex> {
  const account = args.account ?? args.walletClient.account;
  if (!account) throw new Error("depositMargin: walletClient.account is required");

  const chainId = (args.chainId ?? client.chainId) as ChainId;
  if (!chainId) throw new Error("depositMargin: chainId is required");

  const perps = getPerpsContracts(chainId);

  return args.walletClient.writeContract({
    address: perps.marginAccount as Address,
    abi: FxMarginAccountAbi,
    functionName: "depositMargin",
    args: [account.address, args.amount],
    account,
    chain: args.walletClient.chain,
  });
}

/** Arguments for {@link withdrawMargin}. */
export interface WithdrawMarginArgs {
  amount: bigint;
  chainId?: ChainId;
  walletClient: WalletClient;
  account?: Account;
}

/**
 * Submit a `withdrawMargin(amount)` transaction to the `FxMarginAccount`
 * contract. The contract reverts if the trader's positions become
 * undercollateralized — call `previewWithdraw` (not yet wrapped) for the
 * max safely-withdrawable amount.
 */
export async function withdrawMargin(
  client: BufiClient,
  args: WithdrawMarginArgs,
): Promise<Hex> {
  const account = args.account ?? args.walletClient.account;
  if (!account) throw new Error("withdrawMargin: walletClient.account is required");

  const chainId = (args.chainId ?? client.chainId) as ChainId;
  if (!chainId) throw new Error("withdrawMargin: chainId is required");

  const perps = getPerpsContracts(chainId);

  return args.walletClient.writeContract({
    address: perps.marginAccount as Address,
    abi: FxMarginAccountAbi,
    functionName: "withdrawMargin",
    args: [account.address, args.amount],
    account,
    chain: args.walletClient.chain,
  });
}

/** Arguments for {@link getMarginBalance}. */
export interface GetMarginBalanceArgs {
  trader: Address;
  chainId?: ChainId;
  publicClient: PublicClient;
}

/**
 * Read the trader's current margin balance from `FxMarginAccount`.
 *
 * Returns the balance as a `bigint` in USDC atomic 6dp units.
 */
export async function getMarginBalance(
  client: BufiClient,
  args: GetMarginBalanceArgs,
): Promise<bigint> {
  const chainId = (args.chainId ?? client.chainId) as ChainId;
  if (!chainId) throw new Error("getMarginBalance: chainId is required");

  const perps = getPerpsContracts(chainId);

  const balance = await args.publicClient.readContract({
    address: perps.marginAccount as Address,
    abi: FxMarginAccountAbi,
    functionName: "marginOf",
    args: [args.trader],
  });
  return balance as bigint;
}
