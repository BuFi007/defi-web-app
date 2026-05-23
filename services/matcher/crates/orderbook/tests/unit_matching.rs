//! Hand-written matching cases. The proptest invariants cover the
//! distribution; these spell out the named behaviours so a regression
//! fails on a readable test.

// `1 * ONE_E18` is intentionally the "one unit" idiom in fixtures — keeps
// every line in a level-walk reading the same shape.
#![allow(clippy::identity_op)]

mod common;

use bufi_orderbook::{
    cancel_intent, match_intent, peek_match, CancelStatus, MatchStatus, OrderType, RejectReason,
    Side, Size, TimeInForce,
};
use common::{book_with, intent, intent_id, maker, ONE_E18};

const NOW_MS: u64 = 2_000_000_000_000; // far in the future, well past any expiry
const NOW_SECS: u64 = NOW_MS / 1_000;

#[test]
fn long_taker_crosses_single_ask() {
    let mut book = book_with([maker(0x01, 0x10, Side::Short, ONE_E18, 5 * ONE_E18 as u128, 100)]);
    let taker = intent(
        0x02,
        0x20,
        Side::Long,
        ONE_E18,
        5 * ONE_E18 as u128,
        1,
        NOW_SECS,
    );

    let result = match_intent(&mut book, taker, NOW_MS, 0);

    assert_eq!(result.status, MatchStatus::Filled);
    assert_eq!(result.fills.len(), 1);
    assert_eq!(result.fills[0].size, Size::new(5 * ONE_E18 as u128));
    assert!(book.asks.is_empty());
    assert!(book.bids.is_empty());
}

#[test]
fn taker_larger_than_maker_rests_residual_under_gtc() {
    let mut book = book_with([maker(0x01, 0x10, Side::Short, ONE_E18, 3 * ONE_E18 as u128, 100)]);
    let taker = intent(
        0x02,
        0x20,
        Side::Long,
        ONE_E18,
        5 * ONE_E18 as u128,
        1,
        NOW_SECS,
    );

    let result = match_intent(&mut book, taker, NOW_MS, 0);

    assert_eq!(result.status, MatchStatus::Partial);
    assert_eq!(result.fills.len(), 1);
    assert_eq!(result.residual, Size::new(2 * ONE_E18 as u128));
    assert_eq!(book.bids.total_size(), Size::new(2 * ONE_E18 as u128));
    assert!(book.asks.is_empty());
}

#[test]
fn multi_level_walk_takes_best_first() {
    let mut book = book_with([
        // Two asks: the cheaper one fills first even though it was inserted second.
        maker(0x01, 0x10, Side::Short, 2 * ONE_E18, 5 * ONE_E18 as u128, 100),
        maker(0x02, 0x11, Side::Short, 1 * ONE_E18, 3 * ONE_E18 as u128, 200),
    ]);
    let taker = intent(
        0x03,
        0x20,
        Side::Long,
        3 * ONE_E18,
        6 * ONE_E18 as u128,
        1,
        NOW_SECS,
    );

    let result = match_intent(&mut book, taker, NOW_MS, 0);

    assert_eq!(result.status, MatchStatus::Filled);
    assert_eq!(result.fills.len(), 2);
    // Best (cheapest) ask fills first.
    assert_eq!(result.fills[0].price.raw(), 1 * ONE_E18);
    assert_eq!(result.fills[0].size, Size::new(3 * ONE_E18 as u128));
    assert_eq!(result.fills[1].price.raw(), 2 * ONE_E18);
    assert_eq!(result.fills[1].size, Size::new(3 * ONE_E18 as u128));
    // 2 of the 5 ask@2 remain.
    assert_eq!(book.asks.total_size(), Size::new(2 * ONE_E18 as u128));
}

#[test]
fn fifo_within_price_level() {
    let mut book = book_with([
        // Two makers at the same price; insertion order is the FIFO order.
        maker(0x01, 0x10, Side::Short, ONE_E18, 1 * ONE_E18 as u128, 100),
        maker(0x02, 0x11, Side::Short, ONE_E18, 1 * ONE_E18 as u128, 200),
    ]);
    let taker = intent(
        0x03,
        0x20,
        Side::Long,
        ONE_E18,
        1 * ONE_E18 as u128,
        1,
        NOW_SECS,
    );

    let result = match_intent(&mut book, taker, NOW_MS, 0);
    assert_eq!(result.status, MatchStatus::Filled);
    assert_eq!(result.fills[0].maker_intent_id, intent_id(0x01));
}

#[test]
fn fok_rejected_when_insufficient_liquidity_and_book_unchanged() {
    let mut book = book_with([maker(0x01, 0x10, Side::Short, ONE_E18, 1 * ONE_E18 as u128, 100)]);
    let original_ask_size = book.asks.total_size();
    let mut taker = intent(
        0x02,
        0x20,
        Side::Long,
        ONE_E18,
        5 * ONE_E18 as u128,
        1,
        NOW_SECS,
    );
    taker.tif = TimeInForce::FillOrKill;

    let result = match_intent(&mut book, taker, NOW_MS, 0);

    assert_eq!(result.status, MatchStatus::Rejected);
    assert_eq!(
        result.reject_reason,
        Some(RejectReason::FokInsufficientLiquidity)
    );
    assert!(result.fills.is_empty());
    // Critical: peek-then-execute means the book is untouched.
    assert_eq!(book.asks.total_size(), original_ask_size);
}

#[test]
fn ioc_partials_drop_residual() {
    let mut book = book_with([maker(0x01, 0x10, Side::Short, ONE_E18, 2 * ONE_E18 as u128, 100)]);
    let mut taker = intent(
        0x02,
        0x20,
        Side::Long,
        ONE_E18,
        5 * ONE_E18 as u128,
        1,
        NOW_SECS,
    );
    taker.tif = TimeInForce::ImmediateOrCancel;

    let result = match_intent(&mut book, taker, NOW_MS, 0);

    assert_eq!(result.status, MatchStatus::Partial);
    assert_eq!(result.fills.len(), 1);
    assert_eq!(result.residual, Size::new(3 * ONE_E18 as u128));
    // IOC residual MUST NOT rest on the book.
    assert!(book.bids.is_empty());
}

#[test]
fn expired_intent_never_matches() {
    let mut book = book_with([maker(0x01, 0x10, Side::Short, ONE_E18, 5 * ONE_E18 as u128, 100)]);
    let mut taker = intent(
        0x02,
        0x20,
        Side::Long,
        ONE_E18,
        5 * ONE_E18 as u128,
        1,
        NOW_SECS,
    );
    // Set deadline to be already past `now_secs`.
    taker.deadline_secs = NOW_SECS - 1;

    let result = match_intent(&mut book, taker, NOW_MS, 0);

    assert_eq!(result.status, MatchStatus::Rejected);
    assert_eq!(result.reject_reason, Some(RejectReason::Expired));
    assert!(result.fills.is_empty());
    assert_eq!(book.asks.total_size(), Size::new(5 * ONE_E18 as u128));
}

#[test]
fn limit_does_not_cross_at_unfavourable_price() {
    let mut book = book_with([maker(0x01, 0x10, Side::Short, 2 * ONE_E18, 5 * ONE_E18 as u128, 100)]);
    let taker = intent(
        0x02,
        0x20,
        Side::Long,
        ONE_E18, // bid below the ask
        5 * ONE_E18 as u128,
        1,
        NOW_SECS,
    );

    let result = match_intent(&mut book, taker, NOW_MS, 0);

    // No cross — under GTC the taker rests.
    assert_eq!(result.status, MatchStatus::Resting);
    assert!(result.fills.is_empty());
    assert_eq!(book.bids.total_size(), Size::new(5 * ONE_E18 as u128));
    assert_eq!(book.asks.total_size(), Size::new(5 * ONE_E18 as u128));
}

#[test]
fn market_order_walks_until_filled() {
    let mut book = book_with([
        maker(0x01, 0x10, Side::Short, 1 * ONE_E18, 2 * ONE_E18 as u128, 100),
        maker(0x02, 0x11, Side::Short, 5 * ONE_E18, 5 * ONE_E18 as u128, 200),
    ]);
    let mut taker = intent(
        0x03,
        0x20,
        Side::Long,
        0,
        4 * ONE_E18 as u128,
        1,
        NOW_SECS,
    );
    taker.order_type = OrderType::Market;

    let result = match_intent(&mut book, taker, NOW_MS, 0);
    assert_eq!(result.status, MatchStatus::Filled);
    assert_eq!(result.fills.len(), 2);
    assert_eq!(result.fills[0].price.raw(), 1 * ONE_E18);
    assert_eq!(result.fills[0].size, Size::new(2 * ONE_E18 as u128));
    assert_eq!(result.fills[1].price.raw(), 5 * ONE_E18);
    assert_eq!(result.fills[1].size, Size::new(2 * ONE_E18 as u128));
}

#[test]
fn cancel_resting_order_returns_residual() {
    let mut book = book_with([maker(0x01, 0x10, Side::Long, ONE_E18, 3 * ONE_E18 as u128, 100)]);

    let result = cancel_intent(&mut book, intent_id(0x01));

    assert_eq!(result.status, CancelStatus::Canceled);
    assert_eq!(result.residual, Size::new(3 * ONE_E18 as u128));
    assert!(book.bids.is_empty());
}

#[test]
fn cancel_unknown_id_is_not_found_not_error() {
    let mut book = book_with([]);
    let result = cancel_intent(&mut book, intent_id(0xFF));
    assert_eq!(result.status, CancelStatus::NotFound);
    assert_eq!(result.residual, Size::new(0));
}

#[test]
fn peek_match_does_not_mutate_book() {
    let book = book_with([maker(0x01, 0x10, Side::Short, ONE_E18, 5 * ONE_E18 as u128, 100)]);
    let snapshot_size = book.asks.total_size();
    let taker = intent(
        0x02,
        0x20,
        Side::Long,
        ONE_E18,
        5 * ONE_E18 as u128,
        1,
        NOW_SECS,
    );
    let can_fill = peek_match(&book, &taker, NOW_MS);
    assert!(can_fill);
    assert_eq!(book.asks.total_size(), snapshot_size);
}
