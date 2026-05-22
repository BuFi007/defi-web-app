//! alloy `sol!` bindings for FxOrderSettlement + FxPerpClearinghouse.
//!
//! `SignedOrder` is defined here for tx-encoding. The matcher-types
//! `SignedOrder` (for EIP-712 hashing) is ABI-equivalent; convert at the
//! validator boundary. Keeping two copies avoids dragging the
//! alloy-contract dependency into matcher-types.

use alloy_sol_types::sol;

sol! {
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
