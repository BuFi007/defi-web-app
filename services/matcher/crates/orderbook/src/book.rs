//! Per-market orderbook state.
//!
//! `BTreeMap<Price, VecDeque<Order>>` per side. Deterministic iteration order
//! (BTreeMap is sorted, VecDeque is FIFO). Adopted from joaquinbejar's match
//! loop pattern — see `docs/matcher-reading-notes.md` §Source 3.

use std::collections::{BTreeMap, VecDeque};

use crate::order::{MarketId, Order, Side};
use crate::price::{Price, Size};

/// One side of the book — bids or asks.
#[derive(Debug, Default, Clone)]
pub struct OrderBookSide {
    side: Option<Side>,
    levels: BTreeMap<Price, VecDeque<Order>>,
}

impl OrderBookSide {
    /// Build a new side; `side` is recorded for invariant checks.
    pub fn new(side: Side) -> Self {
        Self {
            side: Some(side),
            levels: BTreeMap::new(),
        }
    }

    /// True when no levels carry any size.
    pub fn is_empty(&self) -> bool {
        self.levels.values().all(|q| q.is_empty())
    }

    /// Total resting size across all levels — O(n) in number of orders.
    /// Useful for invariants + tests; not on the hot path.
    pub fn total_size(&self) -> Size {
        let mut acc = 0u128;
        for q in self.levels.values() {
            for o in q {
                acc = acc.saturating_add(o.remaining.raw());
            }
        }
        Size::new(acc)
    }

    /// Push a new resting order to the back of its price-level FIFO.
    pub fn insert(&mut self, order: Order) {
        debug_assert!(
            self.side.is_none_or(|s| s == order.side),
            "OrderBookSide received an order for the wrong side",
        );
        self.levels
            .entry(order.price)
            .or_default()
            .push_back(order);
    }

    /// View, but do not pop, the best-priced level.
    /// For a bid side this is the highest price; for an ask side the lowest.
    pub fn peek_best(&self, side: Side) -> Option<(Price, &VecDeque<Order>)> {
        match side {
            // Asks: we want the lowest ask price first.
            Side::Short => self.levels.iter().next().map(|(p, q)| (*p, q)),
            // Bids: we want the highest bid price first.
            Side::Long => self.levels.iter().next_back().map(|(p, q)| (*p, q)),
        }
    }

    /// Remove the front-of-queue order at `price`, returning it.
    pub fn pop_front_at(&mut self, price: Price) -> Option<Order> {
        let queue = self.levels.get_mut(&price)?;
        let head = queue.pop_front();
        if queue.is_empty() {
            self.levels.remove(&price);
        }
        head
    }

    /// Push an order back onto the front of its price-level FIFO. Used when
    /// a maker is partially filled and the residual stays resting.
    pub fn push_front_at(&mut self, price: Price, order: Order) {
        self.levels
            .entry(price)
            .or_default()
            .push_front(order);
    }
}

/// One market's full book — bids + asks.
#[derive(Debug, Clone)]
pub struct OrderBook {
    /// The market this book belongs to.
    pub market_id: MarketId,
    /// Bid side (`Long`).
    pub bids: OrderBookSide,
    /// Ask side (`Short`).
    pub asks: OrderBookSide,
}

impl OrderBook {
    /// Fresh empty book.
    pub fn new(market_id: MarketId) -> Self {
        Self {
            market_id,
            bids: OrderBookSide::new(Side::Long),
            asks: OrderBookSide::new(Side::Short),
        }
    }

    /// Mutable side for the given resting-order side.
    pub fn side_mut(&mut self, side: Side) -> &mut OrderBookSide {
        match side {
            Side::Long => &mut self.bids,
            Side::Short => &mut self.asks,
        }
    }

    /// Immutable side for the given resting-order side.
    pub fn side(&self, side: Side) -> &OrderBookSide {
        match side {
            Side::Long => &self.bids,
            Side::Short => &self.asks,
        }
    }
}
