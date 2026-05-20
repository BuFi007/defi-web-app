# Permit2 entrypoints needed on FxMarketRegistry — web wk 2 blocker

## Context

The web track ships Permit2 as the deposit/supply UX upgrade in week 2,
day 1. FxMarketRegistry today uses safeTransferFrom on every entry
(supply L211, supplyCollateral L239, repay L295). No Permit2 surface in
the contract. Web track is blocked without one.

Two paths. Audit-first framing, not speed-first.

### (a) FxPermit2Router wrapper contract

- **Spec**: holds inner allowance to FxMarketRegistry, accepts Permit2
  signature, calls ISignatureTransfer.permitTransferFrom, forwards to
  registry.supply/supplyCollateral/repay
- **Time**: 1 day
- **Audit blast radius**: GROWS, not shrinks. The router becomes a
  privileged forwarder. Any user who approves Permit2 → router is
  exposed to a router bug. Audited registry stays frozen, but a new
  unaudited contract enters the trust path.
- **Verdict**: acceptable for testnet + Synthra side-by-side demo.
  NOT acceptable for mainnet / real-USDC without focused audit pass
  on the router alone.

### (b) Direct *WithPermit2 entrypoints on FxMarketRegistry

- **Spec**: supplyWithPermit2, supplyCollateralWithPermit2,
  repayWithPermit2 — each accepts (params..., permit, signature),
  swaps safeTransferFrom for permitTransferFrom, post-conditions
  identical to the existing path
- **Time**: 2 days
- **Audit blast radius**: SMALL delta on the audited contract. The
  transformation is well-understood and isolated. Delta-audit is
  cheap.
- **Verdict**: the right answer before any production traffic.

## Recommendation

Ship (a) THIS WEEK for the demo. Schedule (b) as the contracts-track
follow-up before any mainnet promotion. Do NOT default to (a) on speed
alone — make the audit-radius choice explicit.

Web track unblock date needed: Monday, wk 2 (whichever path).

## Refs

- `FxMarketRegistry.sol:211, 239, 295` (entry points)
- Web wk 2 plan: Permit2 as day-1 deliverable
