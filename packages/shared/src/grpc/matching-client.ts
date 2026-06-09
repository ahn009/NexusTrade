// packages/shared/src/grpc/matching-client.ts
import { OrderSide, OrderType } from '../types/domain';

export interface SubmitOrderRequest {
  orderId: string;
  userId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  price?: string;
  quantity: string;
  clientOrderId?: string;
}

export interface MatchFill {
  tradeId: string;
  makerOrderId: string;
  takerOrderId: string;
  makerUserId: string;
  takerUserId: string;
  price: string;
  quantity: string;
}

export interface SubmitOrderResponse {
  orderId: string;
  accepted: boolean;
  status: string;
  fills: MatchFill[];
  rejectReason?: string;
}

export interface MatchingEngineClient {
  submitOrder(request: SubmitOrderRequest): Promise<SubmitOrderResponse>;
  cancelOrder(orderId: string, symbol: string, userId: string): Promise<{ cancelled: boolean }>;
  getOrderBook(symbol: string, depth: number): Promise<{ bids: [string, string][]; asks: [string, string][] }>;
  getOrderStatus(orderId: string, symbol: string): Promise<{ orderId: string; status: string; filledQuantity: string }>;
}

export class InProcessMatchingClient implements MatchingEngineClient {
  async submitOrder(request: SubmitOrderRequest): Promise<SubmitOrderResponse> {
    return {
      orderId: request.orderId,
      accepted: true,
      status: request.orderType === OrderType.Market ? 'EXPIRED' : 'NEW',
      fills: []
    };
  }

  async cancelOrder(_orderId: string, _symbol: string, _userId: string): Promise<{ cancelled: boolean }> {
    return { cancelled: true };
  }

  async getOrderBook(_symbol: string, _depth: number): Promise<{ bids: [string, string][]; asks: [string, string][] }> {
    return { bids: [], asks: [] };
  }

  async getOrderStatus(orderId: string, _symbol: string): Promise<{ orderId: string; status: string; filledQuantity: string }> {
    return { orderId, status: 'NEW', filledQuantity: '0' };
  }
}
