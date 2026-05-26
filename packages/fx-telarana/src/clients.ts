import { createPublicClient, http, type PublicClient } from "viem";

import type { TelaranaHubChainId } from "@bufi/contracts/telarana";

import { LENDING_HUBS, chainForHub, rpcUrlForHub } from "./chains";

export type HubClientMap = Partial<Record<TelaranaHubChainId, PublicClient>>;

const DEFAULT_RPC_TIMEOUT_MS = 3_000;

function rpcTimeoutMs(): number {
  const configured = Number(
    process.env.FX_TELARANA_HUB_READ_TIMEOUT_MS ?? DEFAULT_RPC_TIMEOUT_MS,
  );
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_RPC_TIMEOUT_MS;
}

export function createHubPublicClient(chainId: TelaranaHubChainId): PublicClient {
  const hub = LENDING_HUBS.find((candidate) => candidate.chainId === chainId);
  if (!hub) throw new Error(`Unsupported hub chainId ${chainId}`);
  return createPublicClient({
    chain: chainForHub(chainId),
    transport: http(rpcUrlForHub(hub), {
      retryCount: 0,
      timeout: rpcTimeoutMs(),
    }),
  });
}

export function createHubClients(): HubClientMap {
  return Object.fromEntries(
    LENDING_HUBS.map((hub) => [hub.chainId, createHubPublicClient(hub.chainId)]),
  ) as HubClientMap;
}

export function getHubClient(
  clients: HubClientMap | undefined,
  chainId: TelaranaHubChainId,
): PublicClient {
  return clients?.[chainId] ?? createHubPublicClient(chainId);
}
