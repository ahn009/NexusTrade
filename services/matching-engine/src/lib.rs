// services/matching-engine/src/lib.rs
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const MAX_AUDIT_LOG_FILLS: usize = 10_000;
const MAX_ORDER_STATUS_ENTRIES: usize = 100_000;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum Side {
    Buy,
    Sell,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum OrderKind {
    Market,
    Limit,
    StopMarket,
    StopLimit,
    Ioc,
    Fok,
    PostOnly,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum OrderStatus {
    New,
    PartiallyFilled,
    Filled,
    Cancelled,
    Expired,
    Rejected,
    PendingStop,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
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
    pub fn limit(
        order_id: &str,
        user_id: &str,
        side: Side,
        price: Decimal,
        quantity: Decimal,
    ) -> Self {
        Self::new(
            order_id,
            user_id,
            side,
            OrderKind::Limit,
            Some(price),
            None,
            quantity,
        )
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
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

#[derive(Debug, Deserialize, Serialize)]
struct EngineSnapshot {
    books: HashMap<String, OrderBookSnapshot>,
}

#[derive(Debug, Deserialize, Serialize)]
struct OrderBookSnapshot {
    bids: Vec<PriceLevelSnapshot>,
    asks: Vec<PriceLevelSnapshot>,
    stop_orders: Vec<OrderSnapshot>,
    status: Vec<OrderStatusSnapshot>,
    audit_log: Vec<FillSnapshot>,
    next_sequence: u64,
}

#[derive(Debug, Deserialize, Serialize)]
struct PriceLevelSnapshot {
    price: String,
    orders: Vec<OrderSnapshot>,
}

#[derive(Debug, Deserialize, Serialize)]
struct OrderSnapshot {
    order_id: String,
    user_id: String,
    side: Side,
    kind: OrderKind,
    price: Option<String>,
    stop_price: Option<String>,
    original_quantity: String,
    remaining_quantity: String,
    sequence: u64,
}

#[derive(Debug, Deserialize, Serialize)]
struct OrderStatusSnapshot {
    order_id: String,
    status: OrderStatus,
    filled_quantity: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct FillSnapshot {
    trade_id: String,
    maker_order_id: String,
    taker_order_id: String,
    maker_user_id: String,
    taker_user_id: String,
    price: String,
    quantity: String,
}

#[derive(Debug)]
struct PersistenceConfig {
    path: PathBuf,
    wal_path: PathBuf,
    snapshot_interval_trades: u64,
    trades_since_snapshot: Mutex<u64>,
}

pub struct MatchingEngineCore {
    books: Mutex<HashMap<String, Arc<Mutex<OrderBook>>>>,
    persistence: Option<PersistenceConfig>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "type")]
enum WalRecord {
    Submit { symbol: String, order: OrderSnapshot },
    Cancel {
        symbol: String,
        order_id: String,
        user_id: String,
    },
}

impl Default for MatchingEngineCore {
    fn default() -> Self {
        Self::new()
    }
}

impl MatchingEngineCore {
    pub fn new() -> Self {
        Self {
            books: Mutex::new(HashMap::new()),
            persistence: None,
        }
    }

    pub fn with_persistence(
        path: impl Into<PathBuf>,
        snapshot_interval_trades: u64,
    ) -> io::Result<Self> {
        let path = path.into();
        let wal_path = wal_path_for(&path);
        let engine = Self {
            books: Mutex::new(load_books_from_persistence(&path, &wal_path)?),
            persistence: Some(PersistenceConfig {
                path,
                wal_path,
                snapshot_interval_trades: snapshot_interval_trades.max(1),
                trades_since_snapshot: Mutex::new(0),
            }),
        };
        Ok(engine)
    }

    pub fn from_env() -> io::Result<Self> {
        let path = std::env::var("MATCHING_ENGINE_SNAPSHOT_PATH")
            .unwrap_or_else(|_| "matching-engine.snapshot.json".to_string());
        Self::with_persistence(path, 1000)
    }

    pub fn submit_order(&self, symbol: &str, order: Order) -> ExecutionReport {
        if let Err(error) = self.append_wal(WalRecord::Submit {
            symbol: normalize_symbol(symbol),
            order: order_to_snapshot(&order),
        }) {
            return ExecutionReport {
                order_id: order.order_id,
                accepted: false,
                status: OrderStatus::Rejected,
                fills: vec![],
                reject_reason: Some(format!("persistence wal append failed: {error}")),
            };
        }
        let book = self.book_for_symbol(symbol);
        let mut book = book.lock().expect("order book lock");
        let report = book.submit(order);
        let mut trade_count = report.fills.len() as u64;
        let mut trigger_prices: Vec<Decimal> = report.fills.iter().map(|fill| fill.price).collect();
        while let Some(last_price) = trigger_prices.pop() {
            for triggered in book.trigger_stops(last_price) {
                trade_count += triggered.fills.len() as u64;
                trigger_prices.extend(triggered.fills.iter().map(|fill| fill.price));
            }
        }
        drop(book);
        if trade_count > 0 {
            self.record_trade_count(trade_count);
        }
        report
    }

    pub fn cancel_order(&self, symbol: &str, order_id: &str, user_id: &str) -> bool {
        if self
            .append_wal(WalRecord::Cancel {
                symbol: normalize_symbol(symbol),
                order_id: order_id.to_string(),
                user_id: user_id.to_string(),
            })
            .is_err()
        {
            return false;
        }
        let Some(book) = self.existing_book(symbol) else {
            return false;
        };
        let mut book = book.lock().expect("order book lock");
        book.cancel(order_id, user_id)
    }

    pub fn get_order_book(
        &self,
        symbol: &str,
        levels: usize,
    ) -> (Vec<(Decimal, Decimal)>, Vec<(Decimal, Decimal)>) {
        let Some(book) = self.existing_book(symbol) else {
            return (vec![], vec![]);
        };
        let book = book.lock().expect("order book lock");
        book.depth(levels)
    }

    pub fn get_order_status(&self, symbol: &str, order_id: &str) -> Option<(OrderStatus, Decimal)> {
        let book = self.existing_book(symbol)?;
        let book = book.lock().expect("order book lock");
        book.order_status(order_id)
    }

    pub fn snapshot_to_disk(&self) -> io::Result<()> {
        let Some(persistence) = &self.persistence else {
            return Ok(());
        };
        let snapshot = self.snapshot();
        let payload = serde_json::to_vec_pretty(&snapshot)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        if let Some(parent) = persistence.path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }
        let temp_path = persistence.path.with_extension("json.tmp");
        fs::write(&temp_path, payload)?;
        fs::rename(temp_path, &persistence.path)?;
        fs::write(&persistence.wal_path, b"")?;
        Ok(())
    }

    pub fn symbols(&self) -> Vec<String> {
        self.books
            .lock()
            .expect("books lock")
            .keys()
            .cloned()
            .collect()
    }

    fn book_for_symbol(&self, symbol: &str) -> Arc<Mutex<OrderBook>> {
        let normalized = normalize_symbol(symbol);
        let mut books = self.books.lock().expect("books lock");
        books
            .entry(normalized)
            .or_insert_with(|| Arc::new(Mutex::new(OrderBook::default())))
            .clone()
    }

    fn existing_book(&self, symbol: &str) -> Option<Arc<Mutex<OrderBook>>> {
        let normalized = normalize_symbol(symbol);
        self.books
            .lock()
            .expect("books lock")
            .get(&normalized)
            .cloned()
    }

    fn record_trade_count(&self, count: u64) {
        let Some(persistence) = &self.persistence else {
            return;
        };
        let should_snapshot = {
            let mut trades_since_snapshot = persistence
                .trades_since_snapshot
                .lock()
                .expect("snapshot counter lock");
            *trades_since_snapshot += count;
            if *trades_since_snapshot >= persistence.snapshot_interval_trades {
                *trades_since_snapshot = 0;
                true
            } else {
                false
            }
        };
        if should_snapshot {
            let _ = self.snapshot_to_disk();
        }
    }

    fn append_wal(&self, record: WalRecord) -> io::Result<()> {
        let Some(persistence) = &self.persistence else {
            return Ok(());
        };
        if let Some(parent) = persistence.wal_path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }
        let payload = serde_json::to_vec(&record)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&persistence.wal_path)?;
        file.write_all(&payload)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        Ok(())
    }

    fn snapshot(&self) -> EngineSnapshot {
        let books = self.books.lock().expect("books lock");
        EngineSnapshot {
            books: books
                .iter()
                .map(|(symbol, book)| {
                    (
                        symbol.clone(),
                        book.lock().expect("order book lock").to_snapshot(),
                    )
                })
                .collect(),
        }
    }
}

impl OrderBook {
    pub fn submit(&mut self, mut incoming: Order) -> ExecutionReport {
        if self.status.contains_key(&incoming.order_id)
            || self.order_index.contains_key(&incoming.order_id)
        {
            return Self::rejected(incoming.order_id, "duplicate order_id");
        }
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
            self.status.insert(
                incoming.order_id.clone(),
                (OrderStatus::PendingStop, Decimal::ZERO),
            );
            self.prune_status_log();
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
        if incoming.kind == OrderKind::Fok
            && self.available_crossing_quantity(&incoming) < incoming.remaining_quantity
        {
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
                let status = if fills.is_empty() {
                    OrderStatus::Rejected
                } else {
                    OrderStatus::PartiallyFilled
                };
                self.status.insert(
                    order_id.clone(),
                    (status.clone(), original - incoming.remaining_quantity),
                );
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
                let level = self
                    .level_mut(opposite_side, price)
                    .expect("best level exists");
                let resting = level
                    .orders
                    .front_mut()
                    .expect("best level has resting order");
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
                    partial_resting_order = Some((
                        resting.order_id.clone(),
                        resting.original_quantity - resting.remaining_quantity,
                    ));
                }
                remove_empty_level = level.orders.is_empty();
            }
            fills.push(fill.clone());
            self.audit_log.push(fill);
            if let Some((filled_order_id, original_quantity)) = filled_resting_order {
                self.order_index.remove(&filled_order_id);
                self.status
                    .insert(filled_order_id, (OrderStatus::Filled, original_quantity));
            }
            if let Some((partial_order_id, filled_quantity)) = partial_resting_order {
                self.status.insert(
                    partial_order_id,
                    (OrderStatus::PartiallyFilled, filled_quantity),
                );
                self.prune_status_log();
            }
            if remove_empty_level {
                self.remove_level(opposite_side, price);
            }
        }

        let filled_quantity = original - incoming.remaining_quantity;
        let status = if incoming.remaining_quantity == Decimal::ZERO {
            OrderStatus::Filled
        } else if matches!(incoming.kind, OrderKind::Market | OrderKind::Ioc) {
            if fills.is_empty() {
                OrderStatus::Rejected
            } else {
                OrderStatus::PartiallyFilled
            }
        } else if incoming.kind == OrderKind::Fok {
            OrderStatus::Expired
        } else {
            self.rest(incoming);
            if fills.is_empty() {
                OrderStatus::New
            } else {
                OrderStatus::PartiallyFilled
            }
        };
        self.status
            .insert(order_id.clone(), (status.clone(), filled_quantity));
        self.prune_status_log();
        self.prune_audit_log();
        ExecutionReport {
            order_id,
            accepted: true,
            status,
            fills,
            reject_reason: None,
        }
    }

    pub fn cancel(&mut self, order_id: &str, user_id: &str) -> bool {
        let Some((side, price)) = self.order_index.get(order_id).cloned() else {
            return self.cancel_stop_order(order_id, user_id);
        };
        let Some(level) = self.level_mut(side, price) else {
            return false;
        };
        let Some(pos) = level
            .orders
            .iter()
            .position(|order| order.order_id == order_id && order.user_id == user_id)
        else {
            return false;
        };
        let order = level.orders.remove(pos).expect("position was located");
        level.total_quantity -= order.remaining_quantity;
        self.order_index.remove(order_id);
        self.status.insert(
            order_id.to_string(),
            (
                OrderStatus::Cancelled,
                order.original_quantity - order.remaining_quantity,
            ),
        );
        self.prune_status_log();
        if self.level_is_empty(side, price) {
            self.remove_level(side, price);
        }
        true
    }

    fn cancel_stop_order(&mut self, order_id: &str, user_id: &str) -> bool {
        let Some(pos) = self
            .stop_orders
            .iter()
            .position(|order| order.order_id == order_id && order.user_id == user_id)
        else {
            return false;
        };
        let order = self.stop_orders.remove(pos);
        self.status.insert(
            order_id.to_string(),
            (
                OrderStatus::Cancelled,
                order.original_quantity - order.remaining_quantity,
            ),
        );
        self.prune_status_log();
        true
    }

    pub fn depth(&self, levels: usize) -> (Vec<(Decimal, Decimal)>, Vec<(Decimal, Decimal)>) {
        let bids = self
            .bids
            .iter()
            .rev()
            .take(levels)
            .map(|(price, level)| (*price, level.total_quantity))
            .collect();
        let asks = self
            .asks
            .iter()
            .take(levels)
            .map(|(price, level)| (*price, level.total_quantity))
            .collect();
        (bids, asks)
    }

    pub fn order_status(&self, order_id: &str) -> Option<(OrderStatus, Decimal)> {
        self.status.get(order_id).cloned()
    }

    pub fn audit_log(&self) -> &[Fill] {
        &self.audit_log
    }

    fn to_snapshot(&self) -> OrderBookSnapshot {
        OrderBookSnapshot {
            bids: self.bids.values().map(price_level_to_snapshot).collect(),
            asks: self.asks.values().map(price_level_to_snapshot).collect(),
            stop_orders: self.stop_orders.iter().map(order_to_snapshot).collect(),
            status: self
                .status
                .iter()
                .map(
                    |(order_id, (status, filled_quantity))| OrderStatusSnapshot {
                        order_id: order_id.clone(),
                        status: status.clone(),
                        filled_quantity: filled_quantity.to_string(),
                    },
                )
                .collect(),
            audit_log: self.audit_log.iter().map(fill_to_snapshot).collect(),
            next_sequence: self.next_sequence,
        }
    }

    fn from_snapshot(snapshot: OrderBookSnapshot) -> io::Result<Self> {
        let mut book = OrderBook {
            stop_orders: snapshot
                .stop_orders
                .into_iter()
                .map(order_from_snapshot)
                .collect::<io::Result<Vec<_>>>()?,
            status: snapshot
                .status
                .into_iter()
                .map(|entry| {
                    Ok((
                        entry.order_id,
                        (entry.status, parse_decimal_string(&entry.filled_quantity)?),
                    ))
                })
                .collect::<io::Result<HashMap<_, _>>>()?,
            audit_log: snapshot
                .audit_log
                .into_iter()
                .map(fill_from_snapshot)
                .collect::<io::Result<Vec<_>>>()?,
            next_sequence: snapshot.next_sequence,
            ..OrderBook::default()
        };
        for level in snapshot.bids {
            book.restore_level(Side::Buy, level)?;
        }
        for level in snapshot.asks {
            book.restore_level(Side::Sell, level)?;
        }
        Ok(book)
    }

    fn restore_level(&mut self, side: Side, snapshot: PriceLevelSnapshot) -> io::Result<()> {
        let price = parse_decimal_string(&snapshot.price)?;
        let orders = snapshot
            .orders
            .into_iter()
            .map(order_from_snapshot)
            .collect::<io::Result<VecDeque<_>>>()?;
        let total_quantity = orders
            .iter()
            .fold(Decimal::ZERO, |acc, order| acc + order.remaining_quantity);
        for order in &orders {
            self.order_index
                .insert(order.order_id.clone(), (side, price));
        }
        self.levels_mut(side).insert(
            price,
            PriceLevel {
                price,
                orders,
                total_quantity,
            },
        );
        Ok(())
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
                self.status.remove(&order.order_id);
                order.kind = if order.kind == OrderKind::StopMarket {
                    OrderKind::Market
                } else {
                    OrderKind::Limit
                };
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
                .or_insert_with(|| PriceLevel {
                    price,
                    orders: VecDeque::new(),
                    total_quantity: Decimal::ZERO,
                });
            level.total_quantity += order.remaining_quantity;
            level.orders.push_back(order);
        }
        self.order_index.insert(order_id.clone(), (side, price));
        self.status
            .insert(order_id, (OrderStatus::New, filled_quantity));
        self.prune_status_log();
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
        let Some(price) = best_price else {
            return false;
        };
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
        self.level(side, price)
            .map(|level| level.orders.is_empty())
            .unwrap_or(true)
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

    fn prune_audit_log(&mut self) {
        if self.audit_log.len() > MAX_AUDIT_LOG_FILLS {
            let remove_count = self.audit_log.len() - MAX_AUDIT_LOG_FILLS;
            self.audit_log.drain(0..remove_count);
        }
    }

    fn prune_status_log(&mut self) {
        if self.status.len() <= MAX_ORDER_STATUS_ENTRIES {
            return;
        }
        self.status.retain(|order_id, (status, _)| {
            self.order_index.contains_key(order_id)
                || matches!(
                    status,
                    OrderStatus::New | OrderStatus::PartiallyFilled | OrderStatus::PendingStop
                )
        });
    }
}

fn requires_price(kind: OrderKind) -> bool {
    matches!(
        kind,
        OrderKind::Limit
            | OrderKind::StopLimit
            | OrderKind::Ioc
            | OrderKind::Fok
            | OrderKind::PostOnly
    )
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

fn normalize_symbol(symbol: &str) -> String {
    symbol.trim().to_ascii_uppercase()
}

fn load_books_from_persistence(
    path: &Path,
    wal_path: &Path,
) -> io::Result<HashMap<String, Arc<Mutex<OrderBook>>>> {
    let mut books = load_books_from_snapshot(path)?;
    replay_wal(wal_path, &mut books)?;
    Ok(books)
}

fn load_books_from_snapshot(path: &Path) -> io::Result<HashMap<String, Arc<Mutex<OrderBook>>>> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let payload = fs::read(path)?;
    let snapshot: EngineSnapshot = serde_json::from_slice(&payload)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    snapshot
        .books
        .into_iter()
        .map(|(symbol, book)| {
            Ok((
                normalize_symbol(&symbol),
                Arc::new(Mutex::new(OrderBook::from_snapshot(book)?)),
            ))
        })
        .collect()
}

fn replay_wal(
    wal_path: &Path,
    books: &mut HashMap<String, Arc<Mutex<OrderBook>>>,
) -> io::Result<()> {
    if !wal_path.exists() {
        return Ok(());
    }
    let file = fs::File::open(wal_path)?;
    for line in BufReader::new(file).lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let Ok(record) = serde_json::from_str::<WalRecord>(&line) else {
            continue;
        };
        match record {
            WalRecord::Submit { symbol, order } => {
                let book = books
                    .entry(normalize_symbol(&symbol))
                    .or_insert_with(|| Arc::new(Mutex::new(OrderBook::default())))
                    .clone();
                let order = order_from_snapshot(order)?;
                book.lock().expect("order book lock").submit(order);
            }
            WalRecord::Cancel {
                symbol,
                order_id,
                user_id,
            } => {
                if let Some(book) = books.get(&normalize_symbol(&symbol)) {
                    book.lock()
                        .expect("order book lock")
                        .cancel(&order_id, &user_id);
                }
            }
        }
    }
    Ok(())
}

fn wal_path_for(snapshot_path: &Path) -> PathBuf {
    snapshot_path.with_extension("wal.jsonl")
}

fn price_level_to_snapshot(level: &PriceLevel) -> PriceLevelSnapshot {
    PriceLevelSnapshot {
        price: level.price.to_string(),
        orders: level.orders.iter().map(order_to_snapshot).collect(),
    }
}

fn order_to_snapshot(order: &Order) -> OrderSnapshot {
    OrderSnapshot {
        order_id: order.order_id.clone(),
        user_id: order.user_id.clone(),
        side: order.side,
        kind: order.kind,
        price: order.price.map(|price| price.to_string()),
        stop_price: order.stop_price.map(|price| price.to_string()),
        original_quantity: order.original_quantity.to_string(),
        remaining_quantity: order.remaining_quantity.to_string(),
        sequence: order.sequence,
    }
}

fn order_from_snapshot(snapshot: OrderSnapshot) -> io::Result<Order> {
    Ok(Order {
        order_id: snapshot.order_id,
        user_id: snapshot.user_id,
        side: snapshot.side,
        kind: snapshot.kind,
        price: snapshot
            .price
            .as_deref()
            .map(parse_decimal_string)
            .transpose()?,
        stop_price: snapshot
            .stop_price
            .as_deref()
            .map(parse_decimal_string)
            .transpose()?,
        original_quantity: parse_decimal_string(&snapshot.original_quantity)?,
        remaining_quantity: parse_decimal_string(&snapshot.remaining_quantity)?,
        sequence: snapshot.sequence,
    })
}

fn fill_to_snapshot(fill: &Fill) -> FillSnapshot {
    FillSnapshot {
        trade_id: fill.trade_id.clone(),
        maker_order_id: fill.maker_order_id.clone(),
        taker_order_id: fill.taker_order_id.clone(),
        maker_user_id: fill.maker_user_id.clone(),
        taker_user_id: fill.taker_user_id.clone(),
        price: fill.price.to_string(),
        quantity: fill.quantity.to_string(),
    }
}

fn fill_from_snapshot(snapshot: FillSnapshot) -> io::Result<Fill> {
    Ok(Fill {
        trade_id: snapshot.trade_id,
        maker_order_id: snapshot.maker_order_id,
        taker_order_id: snapshot.taker_order_id,
        maker_user_id: snapshot.maker_user_id,
        taker_user_id: snapshot.taker_user_id,
        price: parse_decimal_string(&snapshot.price)?,
        quantity: parse_decimal_string(&snapshot.quantity)?,
    })
}

fn parse_decimal_string(value: &str) -> io::Result<Decimal> {
    Decimal::from_str(value).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;
    use std::thread;

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
        let report = book.submit(Order::new(
            "b1",
            "u1",
            Side::Buy,
            OrderKind::Ioc,
            Some(dec!(100)),
            None,
            dec!(3),
        ));
        println!("partial IOC report: {:?}", report);
        assert_eq!(report.status, OrderStatus::PartiallyFilled);
        assert!(book.depth(10).0.is_empty());
    }

    #[test]
    fn ioc_that_cannot_fill_is_rejected_and_not_rested() {
        let mut book = OrderBook::default();
        let report = book.submit(Order::new(
            "b1",
            "u1",
            Side::Buy,
            OrderKind::Ioc,
            Some(dec!(100)),
            None,
            dec!(1),
        ));
        println!("unfilled IOC report: {:?}", report);
        assert_eq!(report.status, OrderStatus::Rejected);
        assert_eq!(report.fills.len(), 0);
        assert_eq!(book.depth(10), (vec![], vec![]));
    }

    #[test]
    fn market_order_without_opposing_liquidity_is_rejected() {
        let mut book = OrderBook::default();
        let report = book.submit(Order::new(
            "m1",
            "u1",
            Side::Buy,
            OrderKind::Market,
            None,
            None,
            dec!(1),
        ));
        println!("empty-book market report: {:?}", report);
        assert_eq!(report.status, OrderStatus::Rejected);
        assert_eq!(report.fills.len(), 0);
        assert_eq!(book.depth(10), (vec![], vec![]));
    }

    #[test]
    fn fok_expires_without_full_available_quantity() {
        let mut book = OrderBook::default();
        book.submit(Order::limit("s1", "u2", Side::Sell, dec!(100), dec!(1)));
        let report = book.submit(Order::new(
            "b1",
            "u1",
            Side::Buy,
            OrderKind::Fok,
            Some(dec!(100)),
            None,
            dec!(3),
        ));
        println!("unfilled FOK report: {:?}", report);
        assert_eq!(report.status, OrderStatus::Expired);
        assert_eq!(book.depth(10).1, vec![(dec!(100), dec!(1))]);
    }

    #[test]
    fn post_only_rejects_crossing_order() {
        let mut book = OrderBook::default();
        book.submit(Order::limit("s1", "u2", Side::Sell, dec!(100), dec!(1)));
        let report = book.submit(Order::new(
            "b1",
            "u1",
            Side::Buy,
            OrderKind::PostOnly,
            Some(dec!(100)),
            None,
            dec!(1),
        ));
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

    #[test]
    fn duplicate_order_id_is_rejected() {
        let mut book = OrderBook::default();
        let first = book.submit(Order::limit("b1", "u1", Side::Buy, dec!(100), dec!(1)));
        let duplicate = book.submit(Order::limit("b1", "u2", Side::Buy, dec!(101), dec!(1)));
        assert_eq!(first.status, OrderStatus::New);
        assert_eq!(duplicate.status, OrderStatus::Rejected);
        assert!(duplicate.reject_reason.unwrap().contains("duplicate"));
        assert_eq!(book.depth(10).0, vec![(dec!(100), dec!(1))]);
    }

    #[test]
    fn pending_stop_order_can_be_cancelled() {
        let mut book = OrderBook::default();
        let report = book.submit(Order::new(
            "stop-1",
            "u1",
            Side::Buy,
            OrderKind::StopLimit,
            Some(dec!(101)),
            Some(dec!(100)),
            dec!(1),
        ));
        assert_eq!(report.status, OrderStatus::PendingStop);

        assert!(book.cancel("stop-1", "u1"));
        assert_eq!(
            book.order_status("stop-1").unwrap().0,
            OrderStatus::Cancelled
        );
        assert!(book.trigger_stops(dec!(100)).is_empty());
    }

    #[test]
    fn engine_keeps_symbols_isolated() {
        let engine = MatchingEngineCore::new();
        engine.submit_order(
            "BTC-USDT",
            Order::limit("btc-bid", "u1", Side::Buy, dec!(100), dec!(2)),
        );
        engine.submit_order(
            "ETH-USDT",
            Order::limit("eth-ask", "u2", Side::Sell, dec!(50), dec!(3)),
        );

        assert_eq!(
            engine.get_order_book("BTC-USDT", 10).0,
            vec![(dec!(100), dec!(2))]
        );
        assert_eq!(engine.get_order_book("BTC-USDT", 10).1, vec![]);
        assert_eq!(engine.get_order_book("ETH-USDT", 10).0, vec![]);
        assert_eq!(
            engine.get_order_book("ETH-USDT", 10).1,
            vec![(dec!(50), dec!(3))]
        );
    }

    #[test]
    fn cancel_routes_to_requested_symbol_only() {
        let engine = MatchingEngineCore::new();
        engine.submit_order(
            "BTC-USDT",
            Order::limit("same-id", "u1", Side::Buy, dec!(100), dec!(1)),
        );
        engine.submit_order(
            "ETH-USDT",
            Order::limit("same-id", "u1", Side::Buy, dec!(25), dec!(1)),
        );

        assert!(engine.cancel_order("BTC-USDT", "same-id", "u1"));
        assert_eq!(
            engine.get_order_status("BTC-USDT", "same-id").unwrap().0,
            OrderStatus::Cancelled
        );
        assert_eq!(
            engine.get_order_status("ETH-USDT", "same-id").unwrap().0,
            OrderStatus::New
        );
        assert_eq!(
            engine.get_order_book("ETH-USDT", 10).0,
            vec![(dec!(25), dec!(1))]
        );
    }

    #[test]
    fn order_status_is_symbol_scoped() {
        let engine = MatchingEngineCore::new();
        engine.submit_order(
            "BTC-USDT",
            Order::limit("order-1", "u1", Side::Buy, dec!(100), dec!(1)),
        );

        assert!(engine.get_order_status("ETH-USDT", "order-1").is_none());
        assert_eq!(
            engine.get_order_status("BTC-USDT", "order-1").unwrap().0,
            OrderStatus::New
        );
    }

    #[test]
    fn snapshot_replays_resting_books_on_startup() {
        let path = temp_snapshot_path("resting-books");
        let engine = MatchingEngineCore::with_persistence(&path, 1000).expect("engine");
        engine.submit_order(
            "BTC-USDT",
            Order::limit("bid-1", "u1", Side::Buy, dec!(100), dec!(4)),
        );
        engine.submit_order(
            "ETH-USDT",
            Order::limit("ask-1", "u2", Side::Sell, dec!(80), dec!(5)),
        );
        engine.snapshot_to_disk().expect("snapshot");

        let restored = MatchingEngineCore::with_persistence(&path, 1000).expect("restored engine");
        assert_eq!(
            restored.get_order_book("BTC-USDT", 10).0,
            vec![(dec!(100), dec!(4))]
        );
        assert_eq!(
            restored.get_order_book("ETH-USDT", 10).1,
            vec![(dec!(80), dec!(5))]
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn snapshot_is_written_after_configured_trade_interval() {
        let path = temp_snapshot_path("interval");
        let engine = MatchingEngineCore::with_persistence(&path, 1).expect("engine");
        engine.submit_order(
            "BTC-USDT",
            Order::limit("ask-1", "u2", Side::Sell, dec!(100), dec!(1)),
        );
        assert!(!path.exists());

        engine.submit_order(
            "BTC-USDT",
            Order::limit("bid-1", "u1", Side::Buy, dec!(100), dec!(1)),
        );
        assert!(path.exists());
        let restored = MatchingEngineCore::with_persistence(&path, 1).expect("restored engine");
        assert_eq!(
            restored.get_order_status("BTC-USDT", "bid-1").unwrap().0,
            OrderStatus::Filled
        );
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(wal_path_for(&path));
    }

    #[test]
    fn wal_replays_orders_and_cancels_since_snapshot() {
        let path = temp_snapshot_path("wal");
        let wal_path = wal_path_for(&path);
        let engine = MatchingEngineCore::with_persistence(&path, 1000).expect("engine");
        engine.submit_order(
            "BTC-USDT",
            Order::limit("bid-1", "u1", Side::Buy, dec!(100), dec!(2)),
        );
        engine.submit_order(
            "BTC-USDT",
            Order::limit("bid-2", "u1", Side::Buy, dec!(99), dec!(3)),
        );
        assert!(engine.cancel_order("BTC-USDT", "bid-2", "u1"));

        let restored = MatchingEngineCore::with_persistence(&path, 1000).expect("restored engine");
        assert_eq!(
            restored.get_order_book("BTC-USDT", 10).0,
            vec![(dec!(100), dec!(2))]
        );
        assert_eq!(
            restored.get_order_status("BTC-USDT", "bid-2").unwrap().0,
            OrderStatus::Cancelled
        );
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(wal_path);
    }

    #[test]
    fn stop_orders_trigger_automatically_after_trade() {
        let engine = MatchingEngineCore::new();
        engine.submit_order(
            "BTC-USDT",
            Order::new(
                "stop-buy",
                "u1",
                Side::Buy,
                OrderKind::StopLimit,
                Some(dec!(101)),
                Some(dec!(100)),
                dec!(1),
            ),
        );
        engine.submit_order(
            "BTC-USDT",
            Order::limit("ask-1", "u2", Side::Sell, dec!(100), dec!(2)),
        );
        engine.submit_order(
            "BTC-USDT",
            Order::limit("bid-1", "u3", Side::Buy, dec!(100), dec!(1)),
        );

        assert_eq!(
            engine.get_order_status("BTC-USDT", "stop-buy").unwrap().0,
            OrderStatus::Filled
        );
        assert_eq!(engine.get_order_book("BTC-USDT", 10), (vec![], vec![]));
    }

    #[test]
    fn concurrent_access_preserves_all_symbol_books() {
        let engine = Arc::new(MatchingEngineCore::new());
        let handles: Vec<_> = (0..8)
            .map(|idx| {
                let engine = Arc::clone(&engine);
                thread::spawn(move || {
                    let symbol = if idx % 2 == 0 { "BTC-USDT" } else { "ETH-USDT" };
                    engine.submit_order(
                        symbol,
                        Order::limit(&format!("bid-{idx}"), "u1", Side::Buy, dec!(100), dec!(1)),
                    );
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("thread join");
        }

        assert_eq!(engine.get_order_book("BTC-USDT", 10).0[0].1, dec!(4));
        assert_eq!(engine.get_order_book("ETH-USDT", 10).0[0].1, dec!(4));
    }

    fn temp_snapshot_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("nexus-matching-{label}-{}.json", Uuid::new_v4()))
    }
}
