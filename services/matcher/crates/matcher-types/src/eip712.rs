//! EIP-712 typed-data schemas for signed orders.
//!
//! The `SignedOrder` `sol!` block is bytes-for-bytes equivalent to the
//! `SignedOrder` struct in `FxOrderSettlement` (fx-telarana). The typehash
//! recovered from `SIGNED_ORDER_TYPEHASH` here MUST equal
//!
//!   keccak256("SignedOrder(address trader,bytes32 marketId,int256 sizeDeltaE18,
//!             uint256 priceE18,uint256 maxFee,uint8 orderType,uint8 flags,
//!             uint64 nonce,uint64 deadline)")
//!
//! which is the constant `SIGNED_ORDER_TYPEHASH` at
//! `fx-telarana/contracts/src/perp/FxOrderSettlement.sol:33-34`.
//!
//! Domain:
//! ```text
//!   name              "TelaranaFxOrderSettlement"
//!   version           "1"
//!   chainId           deployment-specific (5042002 on Arc, 43113 on Fuji)
//!   verifyingContract address of the deployed FxOrderSettlement
//! ```

use alloy_primitives::{Address, FixedBytes};
use alloy_sol_types::{eip712_domain, sol, Eip712Domain};

sol! {
    /// Mirrors `FxOrderSettlement.SignedOrder` field-for-field.
    /// Reordering or renaming any field here breaks signature verification
    /// on the contract side — don't.
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
}

/// EIP-712 domain matching `FxOrderSettlement` constructor:
/// `EIP712("TelaranaFxOrderSettlement", "1")`.
pub fn domain(chain_id: u64, verifying_contract: Address) -> Eip712Domain {
    eip712_domain! {
        name: "TelaranaFxOrderSettlement",
        version: "1",
        chain_id: chain_id,
        verifying_contract: verifying_contract,
    }
}

/// Convenience alias for the 32-byte intent id derived from the order hash.
pub type IntentId = FixedBytes<32>;
