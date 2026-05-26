"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useWalletClient } from "wagmi";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";

export function useIdentityRegistration() {
  const { user, primaryWallet } = useDynamicContext();
  const { data: walletClient } = useWalletClient();
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [registering, setRegistering] = useState(false);
  const checkedRef = useRef<string | null>(null);

  const address = primaryWallet?.address;

  useEffect(() => {
    if (!address || checkedRef.current === address) return;
    checkedRef.current = address;

    fetch(`${API_URL}/reputation/check/${address}`)
      .then((r) => r.json())
      .then((d) => setRegistered(d.registered ?? false))
      .catch(() => setRegistered(null));
  }, [address]);

  const register = useCallback(async () => {
    if (!address || !primaryWallet) return;
    setRegistering(true);

    const name =
      user?.username?.trim() ??
      user?.alias?.trim() ??
      user?.firstName?.trim() ??
      user?.email?.split("@")[0] ??
      `Trader-${address.slice(0, 8)}`;

    try {
      const res = await fetch(`${API_URL}/reputation/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          name,
          type: "human",
          source: "dynamic",
        }),
      });
      const data = await res.json();

      if (data.registered) {
        setRegistered(true);
        return data;
      }

      if (data.contract) {
        if (walletClient?.writeContract) {
          const tx = await walletClient.writeContract({
            address: data.contract.to as `0x${string}`,
            abi: [
              {
                type: "function",
                name: "register",
                inputs: [{ name: "_metadataURI", type: "string" }],
                outputs: [{ name: "", type: "uint256" }],
                stateMutability: "nonpayable",
              },
            ],
            functionName: "register",
            args: data.contract.args,
          });
          setRegistered(true);
          return { ...data, txHash: tx };
        }
      }

      return data;
    } catch (e) {
      console.error("Identity registration failed:", e);
      return null;
    } finally {
      setRegistering(false);
    }
  }, [address, primaryWallet, walletClient, user]);

  return { registered, registering, register, address };
}
