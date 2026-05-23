//! Helpers for parsing the string-encoded big-ints `@bufi/db` writes into
//! `perp_order_intents.price_e18` and friends into the matcher's i128 Price.

use bufi_orderbook::Price;

/// Parse a decimal string representing an 18-dec WAD price into
/// `bufi_orderbook::Price`. Returns `None` on parse failure or overflow.
pub fn price_from_dec_string_e18(s: &str) -> Option<Price> {
    // The TS package stores priceE18 as a positive integer string (`"1000000000000000000"`).
    // i128 holds the full E18 range with headroom (i128::MAX ≈ 1.7e38).
    let v: i128 = s.parse().ok()?;
    Some(Price::new(v))
}
