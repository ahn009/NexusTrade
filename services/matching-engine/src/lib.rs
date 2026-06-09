// services/matching-engine/src/lib.rs
use rust_decimal::Decimal;
use std::collections::{BTreeMap, HashMap, VecDeque};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Side {
    Buy,
    Sell,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrderKind {
    Market,
    Limit,
    StopMarket,
    StopLimit,
    Ioc,
    Fok,
    PostOnly,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OrderStatus {
    New,
    PartiallyFilled,
    Filled,
    Cancelled,
    Expired,
    Rejected,
    PendingStop,
}

#[derive(Clone, Debug)]
pub struct Order {
    pub order_id: String,
    pub user_id: String,
    pub side: Side,
    pub kind: OrderKind,
    pub price: Option<Decimal>,
    pub stop_price: Option<Decimal>,
    pub original_quantity: Decimal,
    pub remaining_quantity: Decimal,
    pub sequence: u64,
}

impl Order {
    pub fn limit(order_id: &str, user_id: &str, side: Side, price: Decimal, quantity: Decimal) -> Self {
        Self::new(order_id, user_id, side, OrderKind::Limit, Some(price), None, quantity)
    }

    pub fn new(
        order_id: &str,
        user_id: &str,
        side: Side,
        kind: OrderKind,
        price: Option<Decimal>,
        stop_price: Option<Decimal>,
        quantity: Decimal,
    ) -> Self {
        Self {
            order_id: order_id.to_string(),
            user_id: user_id.to_string(),
            side,
            kind,
            price,
            stop_price,
            original_quantity: quantity,
            remaining_quantity: quantity,
            sequence: 0,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Fill {
    pub trade_id: String,
    pub maker_order_id: String,
    pub taker_order_id: String,
    pub maker_user_id: String,
    pub taker_user_id: String,
    pub price: Decimal,
    pub quantity: Decimal,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionReport {
    pub order_id: String,
    pub accepted: bool,
    pub status: OrderStatus,
    pub fills: Vec<Fill>,
    pub reject_reason: Option<String>,
}

#[derive(Clone, Debug)]
pub struct PriceLevel {
    pub price: Decimal,
    pub orders: VecDeque<Order>,
    pub total_quantity: Decimal,
}

#[derive(Default)]
pub struct OrderBook {
    bids: BTreeMap<Decimal, PriceLevel>,
    asks: BTreeMap<Decimal, PriceLevel>,
    stop_orders: Vec<Order>,
    order_index: HashMap<String, (Side, Decimal)>,
    status: HashMap<String, (OrderStatus, Decimal)>,
    audit_log: Vec<Fill>,
    next_sequence: u64,
}

impl OrderBook {
    pub fn submit(&mut self, mut incoming: Order) -> ExecutionReport {
        if incoming.remaining_quantity <= Decimal::ZERO {
            return Self::rejected(incoming.order_id, "quantity must be positive");
        }
        if requires_price(incoming.kind) && incoming.price.is_none() {
            return Self::rejected(incoming.order_id, "limit-style orders require price");
        }
        if matches!(incoming.kind, OrderKind::StopMarket | OrderKind::StopLimit) {
            if incoming.stop_price.is_none() {
                return Self::rejected(incoming.order_id, "stop orders require stop_price");
            }
            self.next_sequence += 1;
            incoming.sequence = self.next_sequence;
            self.status.insert(incoming.order_id.clone(), (OrderStatus::PendingStop, Decimal::ZERO));
            self.stop_orders.push(incoming.clone());
            return ExecutionReport {
                order_id: incoming.order_id,
                accepted: true,
                status: OrderStatus::PendingStop,
                fills: vec![],
                reject_reason: None,
            };
        }
        if incoming.kind == OrderKind::PostOnly && self.would_cross(&incoming) {
            return Self::rejected(incoming.order_id, "post-only order would take liquidity");
        }
        if incoming.kind == OrderKind::Fok && self.available_crossing_quantity(&incoming) < incoming.remaining_quantity {
            return ExecutionReport {
                order_id: incoming.order_id,
                accepted: true,
                status: OrderStatus::Expired,
                fills: vec![],
                reject_reason: None,
            };
        }

        let order_id = incoming.order_id.clone();
        let mut fills = Vec::new();
        let original = incoming.original_quantity;
        self.next_sequence += 1;
        incoming.sequence = self.next_sequence;

        while incoming.remaining_quantity > Decimal::ZERO {
            let best_price = match incoming.side {
                Side::Buy => self.asks.keys().next().cloned(),
                Side::Sell => self.bids.keys().next_back().cloned(),
            };
            let Some(price) = best_price else { break };
            if !crosses(&incoming, price) {
                break;
            }

            let opposite_side = opposite(incoming.side);
            let is_self_trade = self
                .level(opposite_side, price)
                .and_then(|level| level.orders.front())
                .map(|resting| resting.user_id == incoming.user_id)
                .unwrap_or(false);
            if is_self_trade {
                let status = if fills.is_empty() { OrderStatus::Rejected } else { OrderStatus::PartiallyFilled };
                self.status.insert(order_id.clone(), (status.clone(), original - incoming.remaining_quantity));
                return ExecutionReport {
                    order_id,
                    accepted: !fills.is_empty(),
                    status,
                    fills,
                    reject_reason: Some("self-trade prevention blocked match".to_string()),
                };
            }

            let mut filled_resting_order: Option<(String, Decimal)> = None;
            let mut partial_resting_order: Option<(String, Decimal)> = None;
            let remove_empty_level;
            let fill;
            {
                let level = self.level_mut(opposite_side, price).expect("best level exists");
                let resting = level.orders.front_mut().expect("best level has resting order");
                let quantity = incoming.remaining_quantity.min(resting.remaining_quantity);
                incoming.remaining_quantity -= quantity;
                resting.remaining_quantity -= quantity;
                level.total_quantity -= quantity;
                fill = Fill {
                    trade_id: Uuid::new_v4().to_string(),
                    maker_order_id: resting.order_id.clone(),
                    taker_order_id: incoming.order_id.clone(),
                    maker_user_id: resting.user_id.clone(),
                    taker_user_id: incoming.user_id.clone(),
                    price,
                    quantity,
                };
                if resting.remaining_quantity == Decimal::ZERO {
                    let filled = level.orders.pop_front().expect("front order exists");
                    filled_resting_order = Some((filled.order_id, filled.original_quantity));
                } else {
                    partial_resting_order = Some((resting.order_id.clone(), resting.original_quantity - resting.remaining_quantity));
                }
                remove_empty_level = level.orders.is_empty();
            }
            fills.push(fill.clone());
            self.audit_log.push(fill);
            if let Some((filled_order_id, original_quantity)) = filled_resting_order {
                self.order_index.remove(&filled_order_id);
                self.status.insert(filled_order_id, (OrderStatus::Filled, original_quantity));
            }
            if let Some((partial_order_id, filled_quantity)) = partial_resting_order {
                self.status.insert(partial_order_id, (OrderStatus::PartiallyFilled, filled_quantity));
            }
            if remove_empty_level {
                self.remove_level(opposite_side, price);
            }
        }

        let filled_quantity = original - incoming.remaining_quantity;
        let status = if incoming.remaining_quantity == Decimal::ZERO {
            OrderStatus::Filled
        } else if matches!(incoming.kind, OrderKind::Market | OrderKind::Ioc) {
            if fills.is_empty() { OrderStatus::Rejected } else { OrderStatus::PartiallyFilled }
        } else if incoming.kind == OrderKind::Fok {
            OrderStatus::Expired
        } else {
            self.rest(incoming);
            if fills.is_empty() { OrderStatus::New } else { OrderStatus::PartiallyFilled }
        };
        self.status.insert(order_id.clone(), (status.clone(), filled_quantity));
        ExecutionReport { order_id, accepted: true, status, fills, reject_reason: None }
    }

    pub fn cancel(&mut self, order_id: &str, user_id: &str) -> bool {
        let Some((side, price)) = self.order_index.get(order_id).cloned() else { return false };
        let Some(level) = self.level_mut(side, price) else { return false };
        let Some(pos) = level.orders.iter().position(|order| order.order_id == order_id && order.user_id == user_id) else { return false };
        let order = level.orders.remove(pos).expect("position was located");
        level.total_quantity -= order.remaining_quantity;
        self.order_index.remove(order_id);
        self.status.insert(order_id.to_string(), (OrderStatus::Cancelled, order.original_quantity - order.remaining_quantity));
        if self.level_is_empty(side, price) {
            self.remove_level(side, price);
        }
        true
    }

    pub fn depth(&self, levels: usize) -> (Vec<(Decimal, Decimal)>, Vec<(Decimal, Decimal)>) {
        let bids = self.bids.iter().rev().take(levels).map(|(price, level)| (*price, level.total_quantity)).collect();
        let asks = self.asks.iter().take(levels).map(|(price, level)| (*price, level.total_quantity)).collect();
        (bids, asks)
    }

    pub fn order_status(&self, order_id: &str) -> Option<(OrderStatus, Decimal)> {
        self.status.get(order_id).cloned()
    }

    pub fn audit_log(&self) -> &[Fill] {
        &self.audit_log
    }

    pub fn trigger_stops(&mut self, last_price: Decimal) -> Vec<ExecutionReport> {
        let mut ready = Vec::new();
        let mut pending = Vec::new();
        for mut order in self.stop_orders.drain(..) {
            let stop_price = order.stop_price.expect("validated stop price");
            let should_trigger = match order.side {
                Side::Buy => last_price >= stop_price,
                Side::Sell => last_price <= stop_price,
            };
            if should_trigger {
                order.kind = if order.kind == OrderKind::StopMarket { OrderKind::Market } else { OrderKind::Limit };
                ready.push(order);
            } else {
                pending.push(order);
            }
        }
        self.stop_orders = pending;
        ready.into_iter().map(|order| self.submit(order)).collect()
    }

    fn rest(&mut self, order: Order) {
        let price = order.price.expect("resting order requires price");
        let side = order.side;
        let order_id = order.order_id.clone();
        let filled_quantity = order.original_quantity - order.remaining_quantity;
        {
            let level = self
                .levels_mut(side)
                .entry(price)
                .or_insert_with(|| PriceLevel { price, orders: VecDeque::new(), total_quantity: Decimal::ZERO });
            level.total_quantity += order.remaining_quantity;
            level.orders.push_back(order);
        }
        self.order_index.insert(order_id.clone(), (side, price));
        self.status.insert(order_id, (OrderStatus::New, filled_quantity));
    }

    fn available_crossing_quantity(&self, incoming: &Order) -> Decimal {
        let mut available = Decimal::ZERO;
        let levels: Vec<&PriceLevel> = match incoming.side {
            Side::Buy => self.asks.iter().map(|(_, level)| level).collect(),
            Side::Sell => self.bids.iter().rev().map(|(_, level)| level).collect(),
        };
        for level in levels {
            if !crosses(incoming, level.price) {
                break;
            }
            for order in &level.orders {
                if order.user_id != incoming.user_id {
                    available += order.remaining_quantity;
                    if available >= incoming.remaining_quantity {
                        return available;
                    }
                }
            }
        }
        available
    }

    fn would_cross(&self, incoming: &Order) -> bool {
        let best_price = match incoming.side {
            Side::Buy => self.asks.keys().next().cloned(),
            Side::Sell => self.bids.keys().next_back().cloned(),
        };
        let Some(price) = best_price else { return false };
        crosses(incoming, price)
    }

    fn levels_mut(&mut self, side: Side) -> &mut BTreeMap<Decimal, PriceLevel> {
        match side {
            Side::Buy => &mut self.bids,
            Side::Sell => &mut self.asks,
        }
    }

    fn level(&self, side: Side, price: Decimal) -> Option<&PriceLevel> {
        match side {
            Side::Buy => self.bids.get(&price),
            Side::Sell => self.asks.get(&price),
        }
    }

    fn level_mut(&mut self, side: Side, price: Decimal) -> Option<&mut PriceLevel> {
        match side {
            Side::Buy => self.bids.get_mut(&price),
            Side::Sell => self.asks.get_mut(&price),
        }
    }

    fn level_is_empty(&self, side: Side, price: Decimal) -> bool {
        self.level(side, price).map(|level| level.orders.is_empty()).unwrap_or(true)
    }

    fn remove_level(&mut self, side: Side, price: Decimal) {
        self.levels_mut(side).remove(&price);
    }

    fn rejected(order_id: String, reason: &str) -> ExecutionReport {
        ExecutionReport {
            order_id,
            accepted: false,
            status: OrderStatus::Rejected,
            fills: vec![],
            reject_reason: Some(reason.to_string()),
        }
    }
}

fn requires_price(kind: OrderKind) -> bool {
    matches!(kind, OrderKind::Limit | OrderKind::StopLimit | OrderKind::Ioc | OrderKind::Fok | OrderKind::PostOnly)
}

fn opposite(side: Side) -> Side {
    match side {
        Side::Buy => Side::Sell,
        Side::Sell => Side::Buy,
    }
}

fn crosses(order: &Order, resting_price: Decimal) -> bool {
    match order.kind {
        OrderKind::Market => true,
        _ => match (order.side, order.price) {
            (Side::Buy, Some(price)) => price >= resting_price,
            (Side::Sell, Some(price)) => price <= resting_price,
            _ => false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn limit_order_rests_when_not_crossing() {
        let mut book = OrderBook::default();
        let report = book.submit(Order::limit("b1", "u1", Side::Buy, dec!(100), dec!(2)));
        println!("resting limit report: {:?}", report);
        assert_eq!(report.status, OrderStatus::New);
        assert_eq!(book.depth(10).0, vec![(dec!(100), dec!(2))]);
    }

    #[test]
    fn limit_buy_and_sell_at_same_price_match() {
        let mut book = OrderBook::default();
        book.submit(Order::limit("s1", "u2", Side::Sell, dec!(100), dec!(1)));
        let report = book.submit(Order::limit("b1", "u1", Side::Buy, dec!(100), dec!(1)));
        println!("exact-price match report: {:?}", report);
        assert_eq!(report.status, OrderStatus::Filled);
        assert_eq!(report.fills.len(), 1);
        assert_eq!(report.fills[0].price, dec!(100));
        assert_eq!(report.fills[0].quantity, dec!(1));
        assert_eq!(book.depth(10), (vec![], vec![]));
    }

    #[test]
    fn partial_fill_leaves_remainder_at_incoming_price() {
        let mut book = OrderBook::default();
        book.submit(Order::limit("s1", "u2", Side::Sell, dec!(101), dec!(1)));
        let report = book.submit(Order::limit("b1", "u1", Side::Buy, dec!(102), dec!(3)));
        println!("partial-fill report: {:?}", report);
        assert_eq!(report.status, OrderStatus::PartiallyFilled);
        assert_eq!(report.fills[0].price, dec!(101));
        assert_eq!(report.fills[0].quantity, dec!(1));
        assert_eq!(book.depth(10).0, vec![(dec!(102), dec!(2))]);
    }

    #[test]
    fn fifo_priority_at_same_price() {
        let mut book = OrderBook::default();
        book.submit(Order::limit("s1", "u2", Side::Sell, dec!(100), dec!(1)));
        book.submit(Order::limit("s2", "u3", Side::Sell, dec!(100), dec!(1)));
        let report = book.submit(Order::limit("b1", "u1", Side::Buy, dec!(100), dec!(1.5)));
        println!("fifo report: {:?}", report);
        assert_eq!(report.fills[0].maker_order_id, "s1");
        assert_eq!(report.fills[1].maker_order_id, "s2");
        assert_eq!(report.fills[1].quantity, dec!(0.5));
    }

    #[test]
    fn ioc_does_not_rest_remainder() {
        let mut book = OrderBook::default();
        book.submit(Order::limit("s1", "u2", Side::Sell, dec!(100), dec!(1)));
        let report = book.submit(Order::new("b1", "u1", Side::Buy, OrderKind::Ioc, Some(dec!(100)), None, dec!(3)));
        println!("partial IOC report: {:?}", report);
        assert_eq!(report.status, OrderStatus::PartiallyFilled);
        assert!(book.depth(10).0.is_empty());
    }

    #[test]
    fn ioc_that_cannot_fill_is_rejected_and_not_rested() {
        let mut book = OrderBook::default();
        let report = book.submit(Order::new("b1", "u1", Side::Buy, OrderKind::Ioc, Some(dec!(100)), None, dec!(1)));
        println!("unfilled IOC report: {:?}", report);
        assert_eq!(report.status, OrderStatus::Rejected);
        assert_eq!(report.fills.len(), 0);
        assert_eq!(book.depth(10), (vec![], vec![]));
    }

    #[test]
    fn market_order_without_opposing_liquidity_is_rejected() {
        let mut book = OrderBook::default();
        let report = book.submit(Order::new("m1", "u1", Side::Buy, OrderKind::Market, None, None, dec!(1)));
        println!("empty-book market report: {:?}", report);
        assert_eq!(report.status, OrderStatus::Rejected);
        assert_eq!(report.fills.len(), 0);
        assert_eq!(book.depth(10), (vec![], vec![]));
    }

    #[test]
    fn fok_expires_without_full_available_quantity() {
        let mut book = OrderBook::default();
        book.submit(Order::limit("s1", "u2", Side::Sell, dec!(100), dec!(1)));
        let report = book.submit(Order::new("b1", "u1", Side::Buy, OrderKind::Fok, Some(dec!(100)), None, dec!(3)));
        println!("unfilled FOK report: {:?}", report);
        assert_eq!(report.status, OrderStatus::Expired);
        assert_eq!(book.depth(10).1, vec![(dec!(100), dec!(1))]);
    }

    #[test]
    fn post_only_rejects_crossing_order() {
        let mut book = OrderBook::default();
        book.submit(Order::limit("s1", "u2", Side::Sell, dec!(100), dec!(1)));
        let report = book.submit(Order::new("b1", "u1", Side::Buy, OrderKind::PostOnly, Some(dec!(100)), None, dec!(1)));
        println!("post-only report: {:?}", report);
        assert_eq!(report.status, OrderStatus::Rejected);
    }

    #[test]
    fn self_trade_prevention_blocks_same_user_match() {
        let mut book = OrderBook::default();
        book.submit(Order::limit("s1", "u1", Side::Sell, dec!(100), dec!(1)));
        let report = book.submit(Order::limit("b1", "u1", Side::Buy, dec!(100), dec!(1)));
        println!("self-trade prevention report: {:?}", report);
        assert_eq!(report.status, OrderStatus::Rejected);
        assert!(report.reject_reason.unwrap().contains("self-trade"));
        assert_eq!(book.depth(10).1, vec![(dec!(100), dec!(1))]);
    }
}
