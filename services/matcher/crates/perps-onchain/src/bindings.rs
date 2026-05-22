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

    /// Clearinghouse view surface for the OI gate.
    #[sol(rpc)]
    contract FxPerpClearinghouse {
        function openInterestLong(bytes32 marketId) external view returns (uint256);
        function openInterestShort(bytes32 marketId) external view returns (uint256);
        function maxOpenInterest(bytes32 marketId) external view returns (uint256);
    }
}
