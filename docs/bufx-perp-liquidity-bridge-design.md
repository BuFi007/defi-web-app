# BUFX perp-liquidity bridge — architecture design

**Status:** Draft v1 — Step 4 design audit, 2026-05-23.
**Decision needed:** matcher lead + BUFX owner + fx-telarana owner before
any code lands. This doc captures what's actually missing on-chain so
the integration roadmap doesn't accidentally build the wrong thing.

---

## TL;DR

The Step 4 roadmap item said: "Wire `BuFxPerpLiquidityAccepted` events
to the matcher's orderbook so BUFX cross-chain perp-liq requests get
matched + settled like any other intent."

After auditing the actual BUFX + fx-telarana contract surface, this is
the **wrong** shape of work. The real gap isn't matcher-side
consumption — it's an **on-chain `FxPerpExecutor`** that decodes the
hub-side `MINT_AND_REQUEST_MARKET_ACTION` metadata and opens the perp
position via `FxPerpClearinghouse.openOrIncrease`. Today BUFX perp-liq
requests mint USDC to the hub and STOP; no contract picks up the
metadata.

Three forks below. None should be built without explicit sign-off from
both the BUFX owner and the fx-telarana owner.

---

## What's actually on-chain today

### BUFX side (`BuFxVenueRequestRouter` + `BuFxTelaranaRequestRouter`)

```solidity
// IBuFxVenueRequests.sol
struct PerpLiquidityRequest {
    bytes32 marketId;
    address trader;
    bytes32 accountId;
    uint256 notionalUsd;
    uint256 marginUsd;
    int256  sizeDelta;
    uint256 maxExecutionFee;
    uint256 deadline;
    address referrer;
    bytes32 campaignId;
    bytes   data;     // opaque — passed through unchanged
}

event BuFxPerpLiquidityAccepted(
    bytes32 indexed requestId,
    bytes32 indexed marketId,
    bytes32 indexed accountId,
    address trader,
    uint256 notionalUsd,
    uint256 marginUsd,
    int256  sizeDelta,
    uint256 deadline
);

// Two submit paths:
function requestPerpLiquidity(PerpLiquidityRequest) external;
function requestPerpLiquidityWithSignature(
    PerpLiquidityRequest, uint256 nonce, bytes signature
) external;
```

Inside `_requestPerpLiquidity`:

```solidity
telaranaRequest.spot = BuFxRequestTypes.SpotRequest({
    spotRouteId: request.marketId,
    marketId:    request.marketId,
    tokenOut:    address(0),
    minAmountOut: uint256(abs(request.sizeDelta)),
    referrer:    request.referrer,
    campaignId:  request.campaignId,
    metadata:    abi.encode(
        request.accountId,
        request.marginUsd,
        request.sizeDelta,
        request.data  // user-supplied opaque payload
    )
});
// Then routed cross-chain via Telarana → Hyperlane → destination hub.
```

### Hub side (BUFX Telarana router)

```solidity
// BuFxTelaranaRequestRouter.sol:226
} else if (request.action == BuFxRequestTypes.HubAction.MINT_AND_REQUEST_MARKET_ACTION) {
    if (request.spot.marketId == bytes32(0)) revert InvalidSpotRequest();
}
```

That's it. Validation only. The `_gatewayMintContext` helper then maps:

```solidity
GatewayHubAction gatewayAction =
    receipt.action == BuFxRequestTypes.HubAction.MINT_AND_REQUEST_SPOT_FX
    ? GatewayHubAction.MINT_AND_REQUEST_SPOT_FX
    : GatewayHubAction.MINT_TO_HUB;  // <-- perp-liq lands here
```

`MINT_TO_HUB` is a no-op beyond minting the USDC. The `metadata` field
(accountId, marginUsd, sizeDelta, data) is **discarded** at the hub.

### fx-telarana side

`FxSpotExecutor` (`stage13/phase-a v0.1`) exists for `MINT_AND_REQUEST_SPOT_FX`
and decodes the spot-FX metadata. There is **NO analog** for perps.

Net: a BUFX perp-liquidity request originating on Fuji today completes
to "USDC minted on Arc" and then nothing. No margin deposit, no
position open, no matcher invocation.

---

## Three architectural forks

### Fork A — Build `FxPerpExecutor` on Arc (BUFX/fx-telarana work)

A new on-chain contract that:
1. Has `EXECUTOR_ROLE` on `FxPerpClearinghouse` (already exists per `IFxPerpClearinghouse.openOrIncrease`'s `onlyRole(EXECUTOR_ROLE)`).
2. Is called by the hub-side Gateway hook when `GatewayMintContext.action ==
   GatewayHubAction.MINT_AND_REQUEST_PERP_LIQ` (new variant).
3. Decodes `metadata = abi.encode(accountId, marginUsd, sizeDelta, data)`.
4. Calls `FxMarginAccount.depositMargin(trader, marginUsd)` from the hub-minted USDC.
5. Calls `FxPerpClearinghouse.openOrIncrease(marketId, trader, sizeDelta, maxFee)`.
6. Matcher is **not involved** — this is a direct clearinghouse path
   (same as the existing `apps/keeper-perps-matcher` opens positions
   for matched intents, except here the position is opened atomically
   in the same cross-chain receipt).

**Pros:** the cleanest, most atomic path. No off-chain bridge, no
extra signing key, settles in one cross-chain hop. Matches the
`FxSpotExecutor` shape stage13 already shipped.

**Cons:** new Solidity contract + audit. BUFX + fx-telarana sprint
work; not matcher work.

### Fork B — Off-chain bridge: BUFX request → matcher orderbook

A TS keeper at `apps/keeper-bufx-bridge/` polls Ponder for
`bufx_request` rows where `status = 'perp_accepted'`, and for each:
1. Reads the originating tx's calldata to extract `request.data`
   (the canonical PerpLiquidityRequest tail).
2. Either decodes `data` as a pre-signed `SignedOrder` (requires
   contract change to lock that schema) OR uses a relay key to sign
   on the trader's behalf (breaks the matcher's verifier guarantee
   that recovered signer == trader).
3. Inserts into `perp_order_intents` for the matcher to pick up.

**Pros:** no new on-chain contracts; matcher already exists.

**Cons:**
- Requires the BUFX `data` field to lock to a specific shape
  (SignedOrder bytes), which is a contract spec change.
- OR breaks EIP-712 ownership semantics by introducing a relay-signing
  EOA whose signed orders the matcher's verifier (`intent_translator`)
  would currently reject. Either way, contract OR matcher change.
- BUFX cross-chain settle latency (CCTP attestation: minutes) means
  the matcher's intent shows up AFTER the BUFX request is already
  "accepted" — UX confusion ("intent submitted twice").
- Two-path divergence: direct Trade UI submits go via `/perps/intents`;
  BUFX submits go via this bridge. Two paths to maintain forever.

### Fork C — Defer until product demand surfaces (recommended)

The Trade UI's `/perps/intents` flow already serves both spot (lev=1)
and perp (lev≥2). BUFX perp-liquidity requests are a **different
product**: cross-chain origination ("inject perp liquidity from Fuji").
Until a real user / market-maker / institution shows up wanting that
flow, Fork A's Solidity work doesn't have a forcing function.

**Action items if Fork C:**
- File a tracker issue in BUFX repo: "`MINT_AND_REQUEST_MARKET_ACTION`
  has no hub-side executor; perp-liq requests complete to MINT_TO_HUB
  only."
- File a tracker issue in fx-telarana: "Need `FxPerpExecutor` analog
  to `FxSpotExecutor`."
- Update this matcher doc: "Step 4 deferred pending Fork A upstream."
- Keep Ponder indexing `BuFxPerpLiquidityAccepted` (already wired) so
  when Fork A lands, the dashboard view of perp-liq requests is
  already populated.

---

## Recommendation

**Fork C now**, **Fork A when a stakeholder asks**, **never Fork B**.

The Trade UI's existing direct-to-matcher path covers the user-facing
spot + perp surface. The BUFX cross-chain perp-liq surface is product-
gated, not engineering-gated — building Fork A speculatively before
anyone asks for it burns audit budget on an unconfirmed user journey.
Fork B's off-chain bridge looks attractive but introduces two-path
divergence + EIP-712 ownership weirdness that the matcher's audit
surface would have to swallow.

If the product call says "we need this for ", the work
splits cleanly:
- BUFX team: deploy `FxPerpExecutor` on Arc + Fuji.
- fx-telarana team: add `GatewayHubAction.MINT_AND_REQUEST_PERP_LIQ`
  variant + wire `_gatewayMintContext` to dispatch it.
- Matcher team: **no work**. The new executor calls
  `FxPerpClearinghouse.openOrIncrease` directly. The matcher only
  matches CLOB intents, which this isn't.

---

## What ships in this PR

This doc. No code. The roadmap's Step 4 entry is updated to point at
this doc and mark the step as "deferred — see design audit."

If you want the BUFX team to start on Fork A immediately, file an
issue in `~/coding-dojo/BUFX` referencing this doc + the specific
contract pointers in §"What's actually on-chain today."

---

## Sign-off

| Role | Reviewer | Verdict |
|---|---|---|
| Matcher lead | TBD | ⬜ |
| BUFX owner | TBD | ⬜ |
| fx-telarana owner | TBD | ⬜ |
