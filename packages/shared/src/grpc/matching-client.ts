// packages/shared/src/grpc/matching-client.ts
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { existsSync } from 'fs';
import { resolve } from 'path';
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
  stopPrice?: string;
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
  healthCheck(): Promise<boolean>;
  close(): void;
}

interface MatchingProtoRoot {
  nexus: {
    matching: {
      MatchingEngine: grpc.ServiceClientConstructor;
    };
  };
}

type GrpcClient = grpc.Client & Record<string, GrpcUnaryMethod>;
type GrpcUnaryMethod = (request: Record<string, unknown>, callback: (error: grpc.ServiceError | null, response?: unknown) => void) => void;

interface GrpcFill {
  trade_id?: string;
  maker_order_id?: string;
  taker_order_id?: string;
  maker_user_id?: string;
  taker_user_id?: string;
  price?: string;
  quantity?: string;
}

interface SubmitOrderGrpcResponse {
  order_id?: string;
  accepted?: boolean;
  status?: string;
  fills?: GrpcFill[];
  reject_reason?: string;
}

interface OrderBookGrpcResponse {
  bids?: Array<{ price?: string; quantity?: string }>;
  asks?: Array<{ price?: string; quantity?: string }>;
}

interface OrderStatusGrpcResponse {
  order_id?: string;
  status?: string;
  filled_quantity?: string;
}

export interface GrpcMatchingClientOptions {
  address?: string;
  protoPath?: string;
  maxRetries?: number;
  initialRetryMs?: number;
  readyTimeoutMs?: number;
}

export class GrpcMatchingClient implements MatchingEngineClient {
  private readonly address: string;
  private readonly protoPath: string;
  private readonly maxRetries: number;
  private readonly initialRetryMs: number;
  private readonly readyTimeoutMs: number;
  private client: GrpcClient;

  constructor(options: GrpcMatchingClientOptions = {}) {
    this.address = options.address ?? process.env.MATCHING_ENGINE_GRPC_URL ?? 'localhost:50051';
    this.protoPath = options.protoPath ?? resolveProtoPath();
    this.maxRetries = options.maxRetries ?? 3;
    this.initialRetryMs = options.initialRetryMs ?? 100;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 1500;
    this.client = this.createClient();
  }

  async submitOrder(request: SubmitOrderRequest): Promise<SubmitOrderResponse> {
    const response = await this.unary<SubmitOrderGrpcResponse>('submitOrder', {
      order_id: request.orderId,
      user_id: request.userId,
      symbol: request.symbol,
      side: request.side,
      order_type: request.orderType,
      price: request.price ?? '',
      quantity: request.quantity,
      client_order_id: request.clientOrderId ?? '',
      stop_price: request.stopPrice ?? ''
    });

    return {
      orderId: response.order_id ?? request.orderId,
      accepted: response.accepted ?? false,
      status: response.status ?? 'REJECTED',
      fills: (response.fills ?? []).map((fill) => ({
        tradeId: fill.trade_id ?? '',
        makerOrderId: fill.maker_order_id ?? '',
        takerOrderId: fill.taker_order_id ?? '',
        makerUserId: fill.maker_user_id ?? '',
        takerUserId: fill.taker_user_id ?? '',
        price: fill.price ?? '0',
        quantity: fill.quantity ?? '0'
      })),
      rejectReason: response.reject_reason || undefined
    };
  }

  async cancelOrder(orderId: string, symbol: string, userId: string): Promise<{ cancelled: boolean }> {
    const response = await this.unary<{ cancelled?: boolean }>('cancelOrder', {
      order_id: orderId,
      symbol,
      user_id: userId
    });
    return { cancelled: response.cancelled ?? false };
  }

  async getOrderBook(symbol: string, depth: number): Promise<{ bids: [string, string][]; asks: [string, string][] }> {
    const response = await this.unary<OrderBookGrpcResponse>('getOrderBook', { symbol, depth });
    return {
      bids: (response.bids ?? []).map((level) => [level.price ?? '0', level.quantity ?? '0']),
      asks: (response.asks ?? []).map((level) => [level.price ?? '0', level.quantity ?? '0'])
    };
  }

  async getOrderStatus(orderId: string, symbol: string): Promise<{ orderId: string; status: string; filledQuantity: string }> {
    const response = await this.unary<OrderStatusGrpcResponse>('getOrderStatus', {
      order_id: orderId,
      symbol
    });
    return {
      orderId: response.order_id ?? orderId,
      status: response.status ?? 'REJECTED',
      filledQuantity: response.filled_quantity ?? '0'
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.waitForReady();
      const state = this.client.getChannel().getConnectivityState(false);
      return state === grpc.connectivityState.READY || state === grpc.connectivityState.IDLE;
    } catch {
      return false;
    }
  }

  close(): void {
    this.client.close();
  }

  private createClient(): GrpcClient {
    const packageDefinition = protoLoader.loadSync(this.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });
    const root = grpc.loadPackageDefinition(packageDefinition) as unknown as MatchingProtoRoot;
    return new root.nexus.matching.MatchingEngine(this.address, grpc.credentials.createInsecure()) as GrpcClient;
  }

  private async unary<TResponse>(method: string, request: Record<string, unknown>): Promise<TResponse> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        await this.waitForReady();
        return await new Promise<TResponse>((resolvePromise, rejectPromise) => {
          this.client[method](request, (error, response) => {
            if (error) {
              rejectPromise(error);
              return;
            }
            resolvePromise(response as TResponse);
          });
        });
      } catch (error) {
        lastError = error as Error;
        if (attempt === this.maxRetries || !isRetryable(error)) break;
        await delay(this.initialRetryMs * 2 ** attempt);
        this.reconnect();
      }
    }
    throw lastError ?? new Error(`gRPC ${method} failed`);
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
      const deadline = new Date(Date.now() + this.readyTimeoutMs);
      this.client.waitForReady(deadline, (error) => {
        if (error) rejectPromise(error);
        else resolvePromise();
      });
    });
  }

  private reconnect(): void {
    this.client.close();
    this.client = this.createClient();
  }
}

function resolveProtoPath(): string {
  const candidates = [
    resolve(process.cwd(), 'packages/shared/src/proto/matching.proto'),
    resolve(__dirname, '../proto/matching.proto'),
    resolve(__dirname, '../../src/proto/matching.proto')
  ];
  const protoPath = candidates.find((candidate) => existsSync(candidate));
  if (!protoPath) {
    throw new Error(`matching.proto not found in: ${candidates.join(', ')}`);
  }
  return protoPath;
}

function isRetryable(error: unknown): boolean {
  const code = (error as Partial<grpc.ServiceError>).code;
  return code === grpc.status.UNAVAILABLE || code === grpc.status.DEADLINE_EXCEEDED || code === grpc.status.INTERNAL;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
