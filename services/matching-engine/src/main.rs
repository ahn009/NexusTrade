// services/matching-engine/src/main.rs
use nexus_matching_engine::{Order, OrderBook, OrderKind, Side};
use rust_decimal::Decimal;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use tonic::{transport::Server, Request, Response, Status};

pub mod matching {
    tonic::include_proto!("nexus.matching");
}

use matching::matching_engine_server::{MatchingEngine, MatchingEngineServer};
use matching::{
    CancelOrderRequest, CancelOrderResponse, Fill, GetOrderBookRequest, GetOrderBookResponse,
    GetOrderStatusRequest, GetOrderStatusResponse, PriceLevel, SubmitOrderRequest, SubmitOrderResponse,
};

#[derive(Default)]
struct MatchingService {
    book: Arc<Mutex<OrderBook>>,
}

#[tonic::async_trait]
impl MatchingEngine for MatchingService {
    async fn submit_order(&self, request: Request<SubmitOrderRequest>) -> Result<Response<SubmitOrderResponse>, Status> {
        let input = request.into_inner();
        let side = parse_side(&input.side)?;
        let kind = parse_kind(&input.order_type)?;
        let price = if input.price.is_empty() { None } else { Some(parse_decimal(&input.price)?) };
        let quantity = parse_decimal(&input.quantity)?;
        let order = Order::new(&input.order_id, &input.user_id, side, kind, price, None, quantity);
        let report = self.book.lock().expect("order book lock").submit(order);
        Ok(Response::new(SubmitOrderResponse {
            order_id: report.order_id,
            accepted: report.accepted,
            status: format!("{:?}", report.status),
            fills: report.fills.into_iter().map(|fill| Fill {
                trade_id: fill.trade_id,
                maker_order_id: fill.maker_order_id,
                taker_order_id: fill.taker_order_id,
                maker_user_id: fill.maker_user_id,
                taker_user_id: fill.taker_user_id,
                price: fill.price.to_string(),
                quantity: fill.quantity.to_string(),
            }).collect(),
            reject_reason: report.reject_reason.unwrap_or_default(),
        }))
    }

    async fn cancel_order(&self, request: Request<CancelOrderRequest>) -> Result<Response<CancelOrderResponse>, Status> {
        let input = request.into_inner();
        let cancelled = self.book.lock().expect("order book lock").cancel(&input.order_id, &input.user_id);
        Ok(Response::new(CancelOrderResponse { cancelled }))
    }

    async fn get_order_book(&self, request: Request<GetOrderBookRequest>) -> Result<Response<GetOrderBookResponse>, Status> {
        let depth = request.into_inner().depth as usize;
        let (bids, asks) = self.book.lock().expect("order book lock").depth(depth);
        Ok(Response::new(GetOrderBookResponse {
            bids: bids.into_iter().map(|(price, quantity)| PriceLevel { price: price.to_string(), quantity: quantity.to_string() }).collect(),
            asks: asks.into_iter().map(|(price, quantity)| PriceLevel { price: price.to_string(), quantity: quantity.to_string() }).collect(),
        }))
    }

    async fn get_order_status(&self, request: Request<GetOrderStatusRequest>) -> Result<Response<GetOrderStatusResponse>, Status> {
        let input = request.into_inner();
        let (status, filled) = self.book.lock().expect("order book lock").order_status(&input.order_id).unwrap_or((nexus_matching_engine::OrderStatus::Rejected, Decimal::ZERO));
        Ok(Response::new(GetOrderStatusResponse {
            order_id: input.order_id,
            status: format!("{:?}", status),
            filled_quantity: filled.to_string(),
        }))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = "0.0.0.0:50051".parse()?;
    Server::builder()
        .add_service(MatchingEngineServer::new(MatchingService::default()))
        .serve(addr)
        .await?;
    Ok(())
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
        "FOK" | "Fok" | "FOC" => Ok(OrderKind::Fok),
        "POST_ONLY" | "PostOnly" => Ok(OrderKind::PostOnly),
        _ => Err(Status::invalid_argument("invalid order_type")),
    }
}

fn parse_decimal(value: &str) -> Result<Decimal, Status> {
    Decimal::from_str(value).map_err(|_| Status::invalid_argument("invalid decimal"))
}
