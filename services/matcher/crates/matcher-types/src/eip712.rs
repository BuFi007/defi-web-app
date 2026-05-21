//! EIP-712 typed-data schemas for signed intents.
//!
//! Domain layout chosen during the Phase 0 reading pass (see
//! `docs/matcher-reading-notes.md` table row 4). Implementation lands with
//! the Phase 1 server stand-up — this module is the placeholder.
//!
//! ```text
//! Domain:
//!   name:       "BUFI Matcher"
//!   version:    "1"
//!   chainId:    deployment-specific
//!   verifyingContract: address(0)  -- matcher is off-chain; settlement contracts
//!                                     verify their own EIP-712 separately.
//! ```

use alloy_sol_types::sol;

sol! {
    /// EIP-712 typed `Intent` payload — must stay in sync with proto `SignedIntent`.
    struct Intent {
        bytes32 marketId;
        address account;
        uint8   side;
        uint8   orderType;
        uint8   tif;
        uint256 size;
        uint256 limitPrice;
        uint64  nonce;
        uint64  expiresAtMs;
        bytes32 clientTag;
    }
}
