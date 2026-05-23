//! Per-market orderbook state.
//!
//! `BTreeMap<Price, VecDeque<Order>>` per side. Deterministic iteration
//! order (BTreeMap is sorted, VecDeque is FIFO). Plus an `intent_index`
//! that maps an `IntentId` to its `(Side, Price)` slot — needed for
//! O(log n) cancel-by-id without scanning every level.

use std::collections::{BTreeMap, VecDeque};

use crate::order::{IntentId, MarketId, Order, Side};
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

    /// Which side this is.
    pub fn side(&self) -> Option<Side> {
        self.side
    }

    /// True when no levels carry any size.
    pub fn is_empty(&self) -> bool {
        self.levels.values().all(|q| q.is_empty())
    }

    /// Total resting magnitude across all levels — O(n).
    pub fn total_size(&self) -> Size {
        let mut acc = 0u128;
        for q in self.levels.values() {
            for o in q {
                acc = acc.saturating_add(o.remaining.raw());
            }
        }
        Size::new(acc)
    }

    /// Iterate `(price, queue)` in match-priority order for the given taker:
    /// a Long taker walks asks ascending; a Short taker walks bids descending.
    /// `self` MUST be the maker side (opposite of `taker`).
    pub fn iter_for_taker(
        &self,
        taker: Side,
    ) -> Box<dyn Iterator<Item = (Price, &VecDeque<Order>)> + '_> {
        match taker {
            // Taker is Long → walk asks ascending (lowest first).
            Side::Long => Box::new(self.levels.iter().map(|(p, q)| (*p, q))),
            // Taker is Short → walk bids descending (highest first).
            Side::Short => Box::new(self.levels.iter().rev().map(|(p, q)| (*p, q))),
        }
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

    /// Remove a specific resting order by intent id at a known price.
    /// Returns the removed order if found. O(k) at the level.
    pub fn remove_by_id(&mut self, price: Price, id: IntentId) -> Option<Order> {
        let queue = self.levels.get_mut(&price)?;
        let pos = queue.iter().position(|o| o.id == id)?;
        let removed = queue.remove(pos);
        if queue.is_empty() {
            self.levels.remove(&price);
        }
        removed
    }

    /// Best price + its queue — `None` if empty.
    /// Best = lowest for asks (Short side), highest for bids (Long side).
    pub fn peek_best(&self, side: Side) -> Option<(Price, &VecDeque<Order>)> {
        match side {
            Side::Short => self.levels.iter().next().map(|(p, q)| (*p, q)),
            Side::Long => self.levels.iter().next_back().map(|(p, q)| (*p, q)),
        }
    }

    /// Visit every level + queue in price-ascending order. Used by snapshots.
    pub fn levels_ascending(&self) -> impl Iterator<Item = (Price, &VecDeque<Order>)> {
        self.levels.iter().map(|(p, q)| (*p, q))
    }
}

/// One market's full book — bids + asks + an intent-id index.
#[derive(Debug, Clone)]
pub struct OrderBook {
    /// The market this book belongs to.
    pub market_id: MarketId,
    /// Bid side (`Long`).
    pub bids: OrderBookSide,
    /// Ask side (`Short`).
    pub asks: OrderBookSide,
    /// O(log n) lookup for cancellation: id → (side, price).
    intent_index: BTreeMap<IntentId, (Side, Price)>,
}

impl OrderBook {
    /// Fresh empty book.
    pub fn new(market_id: MarketId) -> Self {
        Self {
            market_id,
            bids: OrderBookSide::new(Side::Long),
            asks: OrderBookSide::new(Side::Short),
            intent_index: BTreeMap::new(),
        }
    }

    /// Mutable side for a resting order's side.
    pub fn side_mut(&mut self, side: Side) -> &mut OrderBookSide {
        match side {
            Side::Long => &mut self.bids,
            Side::Short => &mut self.asks,
        }
    }

    /// Immutable side.
    pub fn side(&self, side: Side) -> &OrderBookSide {
        match side {
            Side::Long => &self.bids,
            Side::Short => &self.asks,
        }
    }

    /// Insert a resting order and update the intent index.
    pub fn insert(&mut self, order: Order) {
        self.intent_index
            .insert(order.id, (order.side, order.price));
        self.side_mut(order.side).insert(order);
    }

    /// Cancel by intent id. Returns the cancelled order if found.
    pub fn cancel(&mut self, id: IntentId) -> Option<Order> {
        let (side, price) = self.intent_index.remove(&id)?;
        self.side_mut(side).remove_by_id(price, id)
    }

    /// Look up an intent's location without mutating.
    pub fn locate(&self, id: IntentId) -> Option<(Side, Price)> {
        self.intent_index.get(&id).copied()
    }

    /// Update the intent index after a partial maker fill where the maker
    /// residual is pushed back onto the front of its level. The price + id
    /// don't change, so this is a no-op today — kept as a docstring hook so
    /// future invariant work has a single place to extend.
    pub fn note_partial_maker_fill(&mut self, _id: IntentId, _new_remaining: Size) {}

    /// Remove an intent from the index — used when the matcher fully fills
    /// a maker and pops it off the book.
    pub fn drop_from_index(&mut self, id: IntentId) {
        self.intent_index.remove(&id);
    }
}
