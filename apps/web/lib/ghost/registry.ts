/**
 * Ghost provider registry — the ONLY place a concrete provider is named.
 *
 * Today every supported chain routes to the MockProvider. To go live, construct
 * a HinkalProvider and map the chains to it here — no call site changes. Later,
 * route specific chains to the own-stack adapter the same way.
 */

import type {
  ChainId,
  GhostProviderRegistry,
  ShieldedExecutionProvider,
} from "./shielded-execution-provider";
import { MockProvider } from "./mock-provider";

class StaticRegistry implements GhostProviderRegistry {
  constructor(private readonly byChain: Map<ChainId, ShieldedExecutionProvider>) {}
  forChain(chainId: ChainId): ShieldedExecutionProvider | null {
    return this.byChain.get(chainId) ?? null;
  }
  all(): ShieldedExecutionProvider[] {
    return [...new Set(this.byChain.values())];
  }
}

const ARC: ChainId = 5042002;

/**
 * Build the active registry. `mode` lets callers force the mock in tests/dev.
 * When the Hinkal adapter lands, swap the Arc entry to a HinkalProvider here.
 */
export function createGhostRegistry(mode: "mock" | "live" = "mock"): GhostProviderRegistry {
  if (mode === "live") {
    // TODO(ghost): const hinkal = new HinkalProvider(...); map ARC -> hinkal.
    // Until the adapter + Phase 0 land, live falls through to mock.
  }
  const mock = new MockProvider();
  return new StaticRegistry(new Map<ChainId, ShieldedExecutionProvider>([[ARC, mock]]));
}

let _singleton: GhostProviderRegistry | null = null;
/** Process-wide registry (lazy). */
export function ghostRegistry(): GhostProviderRegistry {
  if (!_singleton) _singleton = createGhostRegistry(
    (process.env.NEXT_PUBLIC_GHOST_PROVIDER as "mock" | "live" | undefined) ?? "mock",
  );
  return _singleton;
}
