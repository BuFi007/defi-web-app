import { createPublicClient, http, type PublicClient } from "viem";

import type { TelaranaHubChainId } from "@bufi/contracts/telarana";

import { LENDING_HUBS, chainForHub, rpcUrlForHub } from "./chains";

export type HubClientMap = Partial<Record<TelaranaHubChainId, PublicClient>>;

export function createHubPublicClient(chainId: TelaranaHubChainId): PublicClient {
  const hub = LENDING_HUBS.find((candidate) => candidate.chainId === chainId);
  if (!hub) throw new Error(`Unsupported hub chainId ${chainId}`);
  return createPublicClient({
    chain: chainForHub(chainId),
    transport: http(rpcUrlForHub(hub)),
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
