// Re-export the session primitives so consumers can either pull from
// the root (`@bufi/wallet`) or the deeper path (`@bufi/wallet/session`).
// The deeper path is preferred for tree-shaking; the root export is here
// so callers that import the proof type alone don't have to remember
// which subpath it lives under.
export * from "./session";
