// services/matching-engine/src/main.rs
use nexus_matching_engine::{MatchingEngineCore, Order, OrderKind, OrderStatus, Side};
use rust_decimal::Decimal;
use std::str::FromStr;
use std::sync::Arc;
use tonic::{transport::Server, Request, Response, Status};

pub mod matching {
    tonic::include_proto!("nexus.matching");
}

use matching::matching_engine_server::{MatchingEngine, MatchingEngineServer};
use matching::{
    CancelOrderRequest, CancelOrderResponse, Fill, GetOrderBookRequest, GetOrderBookResponse,
    GetOrderStatusRequest, GetOrderStatusResponse, PriceLevel, SubmitOrderRequest,
    SubmitOrderResponse,
};

struct MatchingService {
    engine: Arc<MatchingEngineCore>,
}

impl MatchingService {
    fn new(engine: MatchingEngineCore) -> Self {
        Self {
            engine: Arc::new(engine),
        }
    }
}

#[tonic::async_trait]
impl MatchingEngine for MatchingService {
    async fn submit_order(
        &self,
        request: Request<SubmitOrderRequest>,
    ) -> Result<Response<SubmitOrderResponse>, Status> {
        let input = request.into_inner();
        let side = parse_side(&input.side)?;
        let kind = parse_kind(&input.order_type)?;
        let price = if input.price.is_empty() {
            None
        } else {
            Some(parse_decimal(&input.price)?)
        };
        let stop_price = if input.stop_price.is_empty() {
            None
        } else {
            Some(parse_decimal(&input.stop_price)?)
        };
        let quantity = parse_decimal(&input.quantity)?;
        let symbol = parse_symbol(&input.symbol)?;
        let order = Order::new(
            &input.order_id,
            &input.user_id,
            side,
            kind,
            price,
            stop_price,
            quantity,
        );
        let report = self.engine.submit_order(symbol, order);
        Ok(Response::new(SubmitOrderResponse {
            order_id: report.order_id,
            accepted: report.accepted,
            status: status_to_wire(&report.status).to_string(),
            fills: report
                .fills
                .into_iter()
                .map(|fill| Fill {
                    trade_id: fill.trade_id,
                    maker_order_id: fill.maker_order_id,
                    taker_order_id: fill.taker_order_id,
                    maker_user_id: fill.maker_user_id,
                    taker_user_id: fill.taker_user_id,
                    price: fill.price.to_string(),
                    quantity: fill.quantity.to_string(),
                })
                .collect(),
            reject_reason: report.reject_reason.unwrap_or_default(),
        }))
    }

    async fn cancel_order(
        &self,
        request: Request<CancelOrderRequest>,
    ) -> Result<Response<CancelOrderResponse>, Status> {
        let input = request.into_inner();
        let symbol = parse_symbol(&input.symbol)?;
        let cancelled = self
            .engine
            .cancel_order(symbol, &input.order_id, &input.user_id);
        Ok(Response::new(CancelOrderResponse { cancelled }))
    }

    async fn get_order_book(
        &self,
        request: Request<GetOrderBookRequest>,
    ) -> Result<Response<GetOrderBookResponse>, Status> {
        let input = request.into_inner();
        let symbol = parse_symbol(&input.symbol)?;
        let depth = input.depth as usize;
        let (bids, asks) = self.engine.get_order_book(symbol, depth);
        Ok(Response::new(GetOrderBookResponse {
            bids: bids
                .into_iter()
                .map(|(price, quantity)| PriceLevel {
                    price: price.to_string(),
                    quantity: quantity.to_string(),
                })
                .collect(),
            asks: asks
                .into_iter()
                .map(|(price, quantity)| PriceLevel {
                    price: price.to_string(),
                    quantity: quantity.to_string(),
                })
                .collect(),
        }))
    }

    async fn get_order_status(
        &self,
        request: Request<GetOrderStatusRequest>,
    ) -> Result<Response<GetOrderStatusResponse>, Status> {
        let input = request.into_inner();
        let symbol = parse_symbol(&input.symbol)?;
        let (status, filled) = self
            .engine
            .get_order_status(symbol, &input.order_id)
            .unwrap_or((OrderStatus::Rejected, Decimal::ZERO));
        Ok(Response::new(GetOrderStatusResponse {
            order_id: input.order_id,
            status: status_to_wire(&status).to_string(),
            filled_quantity: filled.to_string(),
        }))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = "0.0.0.0:50051".parse()?;
    let engine = MatchingEngineCore::from_env()?;
    let service = MatchingService::new(engine);
    let shutdown_engine = Arc::clone(&service.engine);
    Server::builder()
        .add_service(MatchingEngineServer::new(service))
        .serve_with_shutdown(addr, async move {
            if tokio::signal::ctrl_c().await.is_ok() {
                if let Err(error) = shutdown_engine.snapshot_to_disk() {
                    eprintln!("failed to snapshot matching engine on shutdown: {error}");
                }
            }
        })
        .await?;
    Ok(())
}

fn parse_symbol(value: &str) -> Result<&str, Status> {
    let symbol = value.trim();
    if symbol.is_empty() {
        Err(Status::invalid_argument("symbol is required"))
    } else {
        Ok(symbol)
    }
}

fn parse_side(value: &str) -> Result<Side, Status> {
    match value {
        "BUY" | "Buy" => Ok(Side::Buy),
        "SELL" | "Sell" => Ok(Side::Sell),
        _ => Err(Status::invalid_argument("invalid side")),
    }
}

fn parse_kind(value: &str) -> Result<OrderKind, Status> {
    match value {
        "MARKET" | "Market" => Ok(OrderKind::Market),
        "LIMIT" | "Limit" => Ok(OrderKind::Limit),
        "STOP_MARKET" | "StopMarket" => Ok(OrderKind::StopMarket),
        "STOP_LIMIT" | "StopLimit" => Ok(OrderKind::StopLimit),
        "IOC" | "Ioc" => Ok(OrderKind::Ioc),
        "FOK" | "Fok" => Ok(OrderKind::Fok),
        "FOC" => Ok(OrderKind::Ioc),
        "POST_ONLY" | "PostOnly" => Ok(OrderKind::PostOnly),
        _ => Err(Status::invalid_argument("invalid order_type")),
    }
}

fn parse_decimal(value: &str) -> Result<Decimal, Status> {
    Decimal::from_str(value).map_err(|_| Status::invalid_argument("invalid decimal"))
}

fn status_to_wire(status: &OrderStatus) -> &'static str {
    match status {
        OrderStatus::New => "NEW",
        OrderStatus::PartiallyFilled => "PARTIALLY_FILLED",
        OrderStatus::Filled => "FILLED",
        OrderStatus::Cancelled => "CANCELLED",
        OrderStatus::Expired => "EXPIRED",
        OrderStatus::Rejected => "REJECTED",
        OrderStatus::PendingStop => "PENDING_STOP",
    }
}
