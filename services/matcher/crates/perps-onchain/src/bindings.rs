//! alloy `sol!` bindings for FxOrderSettlement + FxPerpClearinghouse.
//!
//! `SignedOrder` is defined here for tx-encoding. The matcher-types
//! `SignedOrder` (for EIP-712 hashing) is ABI-equivalent; convert at the
//! validator boundary. Keeping two copies avoids dragging the
//! alloy-contract dependency into matcher-types.

use alloy_sol_types::sol;

sol! {
    // -------- Events emitted by the perp stack (used by the matcher's
    // event subscriber for state mirroring). Names + signatures verified
    // against contracts/src/perp/*.sol at fx-telarana HEAD c0ff0d3. --------

    /// `FxOrderSettlement.MatchSettled` — emitted on every successful settleMatch.
    #[derive(Debug)]
    event MatchSettled(
        bytes32 indexed marketId,
        address indexed maker,
        address indexed taker,
        uint256 fillSizeE18,
        uint256 fillPriceE18
    );

    /// `FxOrderSettlement.OrderCancelled` — emitted when a trader burns a nonce.
    #[derive(Debug)]
    event OrderCancelled(address indexed trader, uint64 nonce);

    /// `FxPerpClearinghouse.PositionIncreased`.
    #[derive(Debug)]
    event PositionIncreased(
        bytes32 indexed marketId,
        address indexed trader,
        int256 sizeDeltaE18,
        int256 resultingSizeE18,
        uint256 entryPriceE18,
        uint256 marginReserved,
        uint256 fee
    );

    /// `FxPerpClearinghouse.PositionDecreased`.
    #[derive(Debug)]
    event PositionDecreased(
        bytes32 indexed marketId,
        address indexed trader,
        int256 sizeDeltaE18,
        int256 resultingSizeE18,
        uint256 priceE18,
        uint256 marginReleased,
        int256 pnl,
        uint256 badDebt
    );

    /// `FxLiquidationEngine.AccountFlagged`.
    #[derive(Debug)]
    event AccountFlagged(
        bytes32 indexed marketId,
        address indexed trader,
        address indexed flagger
    );

    /// `FxLiquidationEngine.AccountFlagRescinded`.
    #[derive(Debug)]
    event AccountFlagRescinded(
        bytes32 indexed marketId,
        address indexed trader,
        address indexed caller,
        bool auto_
    );

    /// `FxFundingEngine.FundingPoked`.
    #[derive(Debug)]
    event FundingPoked(
        bytes32 indexed marketId,
        uint64 version,
        int256 rateE18PerSecond,
        int256 cumulativeFundingE18
    );

    /// `FxFundingEngine.FundingSettled`.
    #[derive(Debug)]
    event FundingSettled(
        bytes32 indexed marketId,
        address indexed trader,
        int256 fundingPaid
    );

    /// Mirrors `IFxOrderSettlement.SignedOrder` calldata layout.
    /// Field order MUST equal the contract's `SIGNED_ORDER_TYPEHASH`.
    #[derive(Debug)]
    struct SignedOrder {
        address trader;
        bytes32 marketId;
        int256  sizeDeltaE18;
        uint256 priceE18;
        uint256 maxFee;
        uint8   orderType;
        uint8   flags;
        uint64  nonce;
        uint64  deadline;
    }

    /// Settlement contract surface used by the matcher.
    #[sol(rpc)]
    contract FxOrderSettlement {
        function settleMatch(
            SignedOrder maker,
            bytes makerSig,
            SignedOrder taker,
            bytes takerSig,
            uint256 fillSizeE18,
            uint256 fillPriceE18
        ) external;
    }

    /// Per-trader position. Mirrors `FxPerpClearinghouse.Position`.
    struct Position {
        int256  sizeE18;
        uint256 entryPriceE18;
        uint256 marginReservedUsdc;
        int256  fundingIndexAtEntryE18;
    }

    /// Per-market config. Mirrors `FxPerpClearinghouse.MarketConfig`.
    /// Field order MUST match the contract struct — keep in sync if upstream changes.
    struct MarketConfig {
        bool    enabled;
        bool    fundingEnabled;
        address baseToken;
        uint256 maxOpenInterestUsd;
        uint256 maxSkewUsd;
        uint32  initialMarginBps;
        uint32  maintenanceMarginBps;
        uint32  tradingFeeBps;
        uint32  maxLeverageBps;
        int256  fundingVelocityBps;
        int256  maxFundingRateBpsPerSecond;
    }

    /// `FxFundingEngine` surface — Phase 5 funding poker.
    /// Mirrors `IFxFundingEngine.pokeFundingRate` + the public `fundingState`
    /// mapping (which solc auto-generates a view fn for).
    #[sol(rpc)]
    contract FxFundingEngine {
        function pokeFundingRate(bytes32 marketId) external;
        function fundingState(bytes32 marketId)
            external
            view
            returns (
                uint64 currentVersion,
                uint256 lastUpdate,
                int256 currentRateE18PerSecond,
                int256 cumulativeFundingE18
            );
    }

    /// `FxOracle` view surface (Phase 4 — LP backstop).
    /// `publishedAt` is unix seconds; the matcher uses it for invariant 4.
    #[sol(rpc)]
    contract IFxOracle {
        function getMid(address base, address quote)
            external
            view
            returns (uint256 midE18, uint256 publishedAt);
    }

    /// Clearinghouse view surface used by Phase 3c+ (OI gate + position state).
    #[sol(rpc)]
    contract FxPerpClearinghouse {
        function openInterestLong(bytes32 marketId) external view returns (uint256);
        function openInterestShort(bytes32 marketId) external view returns (uint256);
        function maxOpenInterest(bytes32 marketId) external view returns (uint256);
        function marketConfig(bytes32 marketId) external view returns (MarketConfig);
        function position(bytes32 marketId, address trader) external view returns (Position);
        // Lenient read for matcher display + gating.
        function unrealizedPnl(bytes32 marketId, address trader) external view returns (int256);
        // Strict read for liquidation use — needs RedStone payload in calldata tail.
        function unrealizedPnlVerified(bytes32 marketId, address trader) external view returns (int256);
    }
}
