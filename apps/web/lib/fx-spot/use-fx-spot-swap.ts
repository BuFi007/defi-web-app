"use client";

import { useCallback, useState } from "react";
import { getPublicClient } from "@wagmi/core";
import { useAccount, useChainId, useSignTypedData, useSwitchChain, useWalletClient } from "wagmi";
import {
  encodeAbiParameters,
  type Address,
  type Hex,
} from "viem";

import {
  buildFxIntent,
  FX_INTENT_TYPES,
  FX_SWAP_CHAIN_ID,
  FX_SWAP_VENUE,
  fxIntentDomain,
} from "@bufi/fx-telarana";

import { config } from "@/lib/wagmi";
import type { FxSpotSwapPlan } from "./plan";

export interface FxSpotSwapResult {
  tx: Hex;
  approveTx?: Hex;
  sellSymbol: string;
  buySymbol: string;
  expectedBuyAmount: bigint;
}

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

const FX_ROUTER_ABI = [
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "executeIntent",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "taker", type: "address" },
          { name: "recipient", type: "address" },
          { name: "sellToken", type: "address" },
          { name: "buyToken", type: "address" },
          { name: "sellAmount", type: "uint256" },
          { name: "minBuyAmount", type: "uint256" },
          { name: "deadline", type: "uint48" },
          { name: "feeBps", type: "uint48" },
          { name: "tenor", type: "uint8" },
          { name: "quoteId", type: "bytes32" },
          { name: "uuid", type: "uint256" },
        ],
      },
      { name: "intentSig", type: "bytes" },
      { name: "permit", type: "bytes" },
      { name: "permitSig", type: "bytes" },
    ],
    outputs: [{ name: "buyAmount", type: "uint256" }],
  },
] as const;

const PERMIT2_TYPES = {
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  PermitTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function useFxSpotSwap(): {
  execute: (plan: FxSpotSwapPlan) => Promise<FxSpotSwapResult>;
  isPending: boolean;
} {
  const { address } = useAccount();
  const wagmiChainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [isPending, setIsPending] = useState(false);

  const execute = useCallback(
    async (plan: FxSpotSwapPlan): Promise<FxSpotSwapResult> => {
      if (!address) throw new Error("Connect a wallet before swapping.");
      if (!walletClient) {
        throw new Error("Wallet client not ready. Try again once your wallet finishes connecting.");
      }

      setIsPending(true);
      try {
        if (wagmiChainId !== FX_SWAP_CHAIN_ID) {
          try {
            await switchChainAsync({ chainId: FX_SWAP_CHAIN_ID as never });
          } catch (err) {
            if (isUserRejection(err)) throw new Error("Network switch cancelled in wallet");
            throw err;
          }
        }

        const walletChainId = await walletClient.getChainId();
        if (walletChainId !== FX_SWAP_CHAIN_ID) {
          throw new Error(`Wallet on chain ${walletChainId}, expected Arc Testnet ${FX_SWAP_CHAIN_ID}.`);
        }

        const publicClient = getPublicClient(config, { chainId: FX_SWAP_CHAIN_ID });
        if (!publicClient) throw new Error("Public client not ready for Arc Testnet.");

        let approveTx: Hex | undefined;
        let allowance = 0n;
        try {
          allowance = (await publicClient.readContract({
            address: plan.sellToken,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, FX_SWAP_VENUE.permit2 as Address],
          })) as bigint;
        } catch {
          allowance = 0n;
        }

        if (allowance < plan.sellAmount) {
          approveTx = (await walletClient.writeContract({
            address: plan.sellToken,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [FX_SWAP_VENUE.permit2 as Address, plan.sellAmount],
          })) as Hex;
          await publicClient.waitForTransactionReceipt({ hash: approveTx });
        }

        const nowSeconds = Math.floor(Date.now() / 1000);
        const intent = buildFxIntent({
          taker: address,
          recipient: address,
          sellToken: plan.sellToken,
          buyToken: plan.buyToken,
          sellAmount: plan.sellAmount,
          minBuyAmount: plan.minBuyAmount,
          nowSeconds,
          uuid: freshNonce(),
        });

        let intentSig: Hex;
        try {
          intentSig = (await signTypedDataAsync({
            domain: fxIntentDomain(),
            types: FX_INTENT_TYPES,
            primaryType: "FxIntent",
            message: intent,
          })) as Hex;
        } catch (err) {
          if (isUserRejection(err)) throw new Error("Swap intent signature cancelled in wallet");
          throw err;
        }

        const permitNonce = freshNonce();
        const permitMessage = {
          permitted: {
            token: plan.sellToken,
            amount: plan.sellAmount,
          },
          spender: FX_SWAP_VENUE.fxRouter as Address,
          nonce: permitNonce,
          deadline: BigInt(intent.deadline),
        };

        let permitSig: Hex;
        try {
          permitSig = (await signTypedDataAsync({
            domain: {
              name: "Permit2",
              chainId: FX_SWAP_CHAIN_ID,
              verifyingContract: FX_SWAP_VENUE.permit2 as Address,
            },
            types: PERMIT2_TYPES,
            primaryType: "PermitTransferFrom",
            message: permitMessage,
          })) as Hex;
        } catch (err) {
          if (isUserRejection(err)) throw new Error("Permit2 signature cancelled in wallet");
          throw err;
        }

        const permit = encodePermitTransferFrom({
          token: plan.sellToken,
          amount: plan.sellAmount,
          nonce: permitNonce,
          deadline: BigInt(intent.deadline),
        });

        const tx = (await walletClient.writeContract({
          address: FX_SWAP_VENUE.fxRouter as Address,
          abi: FX_ROUTER_ABI,
          functionName: "executeIntent",
          args: [intent, intentSig, permit, permitSig],
        })) as Hex;
        await publicClient.waitForTransactionReceipt({ hash: tx });

        return {
          tx,
          approveTx,
          sellSymbol: plan.sellSymbol,
          buySymbol: plan.buySymbol,
          expectedBuyAmount: plan.expectedBuyAmount,
        };
      } finally {
        setIsPending(false);
      }
    },
    [address, signTypedDataAsync, switchChainAsync, wagmiChainId, walletClient],
  );

  return { execute, isPending };
}

function encodePermitTransferFrom(input: {
  token: Address;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
}): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          {
            name: "permitted",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    [
      {
        permitted: {
          token: input.token,
          amount: input.amount,
        },
        nonce: input.nonce,
        deadline: input.deadline,
      },
    ],
  );
}

function freshNonce(): bigint {
  const time = BigInt(Date.now()) << 80n;
  return time | randomBits80();
}

function randomBits80(): bigint {
  const bytes = new Uint8Array(10);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = 0n;
  for (const byte of bytes) out = (out << 8n) | BigInt(byte);
  return out;
}

function isUserRejection(error: unknown): boolean {
  const e = error as { code?: number | string; message?: string; shortMessage?: string };
  const text = `${e?.message ?? ""} ${e?.shortMessage ?? ""}`;
  return e?.code === 4001 || /user rejected|user denied|rejected request|request rejected|cancelled/i.test(text);
}
