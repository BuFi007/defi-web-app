//! Shared helpers for orderbook integration tests + goldens.
//!
//! Kept tiny and deterministic — no clock reads, no RNG, no float math.

use bufi_orderbook::{
    Intent, IntentId, MarketId, Order, OrderBook, OrderType, Price, Side, Size, TimeInForce,
};

/// Standard market id used across all fixtures: 32 bytes of 0xAA pattern.
pub const TEST_MARKET: MarketId = [
    0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA,
    0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA,
    0xAA, 0xAA,
];

/// 1.0 in 18-decimal WAD.
pub const ONE_E18: i128 = 1_000_000_000_000_000_000;

/// Build a 32-byte intent id from a single seed byte (helps make goldens readable).
pub const fn intent_id(seed: u8) -> IntentId {
    [seed; 32]
}

/// Build a 20-byte trader address from a seed byte.
pub const fn trader(seed: u8) -> [u8; 20] {
    [seed; 20]
}

/// Construct a maker order — bypasses the matcher and inserts directly.
pub fn maker(
    id_seed: u8,
    trader_seed: u8,
    side: Side,
    price_e18: i128,
    size_e18: u128,
    inserted_at_ms: u64,
) -> Order {
    Order {
        id: intent_id(id_seed),
        trader: trader(trader_seed),
        side,
        price: Price::new(price_e18),
        remaining: Size::new(size_e18),
        flags: 0,
        inserted_at_ms,
    }
}

/// Construct an intent for the test market with sensible defaults
/// (GTC, limit, no flags, no max fee, expiry 1h in the future).
pub fn intent(
    id_seed: u8,
    trader_seed: u8,
    side: Side,
    price_e18: i128,
    magnitude_e18: u128,
    nonce: u64,
    now_secs: u64,
) -> Intent {
    Intent {
        id: intent_id(id_seed),
        market_id: TEST_MARKET,
        trader: trader(trader_seed),
        side,
        magnitude: Size::new(magnitude_e18),
        price: Price::new(price_e18),
        max_fee: 0,
        order_type: OrderType::Limit,
        flags: 0,
        nonce,
        deadline_secs: now_secs + 3_600,
        tif: TimeInForce::GoodTilCancel,
    }
}

/// Seed a fresh book on `TEST_MARKET` with the supplied maker orders.
pub fn book_with(makers: impl IntoIterator<Item = Order>) -> OrderBook {
    let mut book = OrderBook::new(TEST_MARKET);
    for m in makers {
        book.insert(m);
    }
    book
}
