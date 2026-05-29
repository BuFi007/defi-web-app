import { createPublicClient, http, getAddress, parseEventLogs, parseAbi, type Address } from "viem";
import { arcTestnet } from "viem/chains";

/**
 * On-chain payment verification for the Kawaii gate. TESTNET tier: USDC on Arc
 * Testnet only (no JPYC on testnet — JPYC + −20% are the mainnet/Avax path).
 *
 * Arc's USDC (0x3600…) is the native gas token AND a 6-dec ERC20, so a payment
 * can arrive either as an ERC20 Transfer (6-dec) or a native value send (18-dec
 * at the gas layer). We accept either, both addressed to `recipient` from `payer`.
 */
const TRANSFER_ABI = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

function arcClient() {
  return createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL || arcTestnet.rpcUrls.default.http[0]) });
}

export interface UsdcPaymentCheck {
  txHash: `0x${string}`;
  usdc: Address; // USDC token address (0x3600… on Arc)
  recipient: Address; // earnings agent
  payer: Address; // the minting wallet
  minAmount6: bigint; // required amount in 6-dec USDC units
}

/** Returns the verified paid amount (6-dec) or throws with a reason. */
export async function verifyUsdcPaymentArc(p: UsdcPaymentCheck): Promise<bigint> {
  const c = arcClient();
  const recipient = getAddress(p.recipient);
  const payer = getAddress(p.payer);

  const receipt = await c.getTransactionReceipt({ hash: p.txHash }).catch(() => null);
  if (!receipt) throw new Error("payment tx not found");
  if (receipt.status !== "success") throw new Error("payment tx reverted");

  // (a) ERC20 Transfer on USDC → recipient, from payer, value >= min (6-dec).
  const logs = parseEventLogs({ abi: TRANSFER_ABI, logs: receipt.logs }).filter(
    (l) => getAddress(l.address) === getAddress(p.usdc),
  );
  for (const l of logs) {
    const { from, to, value } = l.args as { from: Address; to: Address; value: bigint };
    if (getAddress(to) === recipient && getAddress(from) === payer && value >= p.minAmount6) {
      return value;
    }
  }

  // (b) Native value send (Arc native USDC is 18-dec at the gas layer).
  const tx = await c.getTransaction({ hash: p.txHash }).catch(() => null);
  if (tx && tx.to && getAddress(tx.to) === recipient && getAddress(tx.from) === payer) {
    const min18 = p.minAmount6 * 10n ** 12n; // 6-dec → 18-dec
    if (tx.value >= min18) return p.minAmount6;
  }

  throw new Error("no matching USDC payment to recipient found in tx");
}
