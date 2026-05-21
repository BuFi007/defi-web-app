//! EIP-712 signature verification, nonce window tracking, expiry checks.
//!
//! Phase 1 stub. Validation order (final):
//!   1. `expires_at_ms > now_ms`
//!   2. `size > 0` and `limit_price` valid for `OrderType::Limit`
//!   3. Signature recovers to `account`
//!   4. `(account, nonce)` not in the recent-nonce set
//!   5. `nonce` strictly greater than the largest seen for `account`
