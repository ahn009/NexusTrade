// services/trading-service/src/main.ts
import 'reflect-metadata';
import { Body, Controller, Delete, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Server } from 'socket.io';
import { createEvent, EventType, money, OrderSide, OrderStatus, OrderType, requireDecimalString, requireSymbol } from '@nexus/shared';
import { randomUUID } from 'crypto';

class PlaceOrderDto {
  @IsString()
  userId!: string;

  @IsString()
  accountId!: string;

  @IsString()
  symbol!: string;

  @IsEnum(OrderSide)
  side!: OrderSide;

  @IsEnum(OrderType)
  type!: OrderType;

  @IsOptional()
  @IsString()
  price?: string;

  @IsString()
  quantity!: string;

  @IsOptional()
  @IsString()
  clientOrderId?: string;
}

@WebSocketGateway({ namespace: '/user-stream', cors: true })
class TradingGateway {
  @WebSocketServer()
  server!: Server;

  publishUserOrder(userId: string, payload: unknown) {
    this.server?.to(userId).emit('order.update', payload);
  }
}

interface StoredOrder {
  id: string;
  userId: string;
  accountId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price?: string;
  quantity: string;
  filledQuantity: string;
  status: OrderStatus;
  clientOrderId?: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredTrade {
  id: string;
  symbol: string;
  makerOrderId: string;
  takerOrderId: string;
  makerUserId: string;
  takerUserId: string;
  price: string;
  quantity: string;
  executedAt: string;
}

@Injectable()
class TradingService {
  private orders: StoredOrder[] = [];
  private trades: StoredTrade[] = [];
  private readonly walletUrl = process.env.WALLET_SERVICE_URL ?? 'http://localhost:3004';

  constructor(private readonly gateway: TradingGateway) {}

  async placeOrder(dto: PlaceOrderDto) {
    const order: StoredOrder = {
      id: randomUUID(),
      userId: dto.userId,
      accountId: dto.accountId,
      symbol: requireSymbol(dto.symbol),
      side: dto.side,
      type: dto.type,
      price: dto.price ? requireDecimalString(dto.price, 'price') : undefined,
      quantity: requireDecimalString(dto.quantity, 'quantity'),
      filledQuantity: '0',
      status: OrderStatus.New,
      clientOrderId: dto.clientOrderId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const fills = await this.match(order);
    order.status = this.remaining(order).eq(0) ? OrderStatus.Filled : fills.length > 0 ? OrderStatus.PartiallyFilled : OrderStatus.New;
    const accepted = {
      orderId: order.id,
      accepted: true,
      status: order.status,
      fills
    };
    const event = createEvent(EventType.OrderPlaced, order.id, order, 'trading-service', { userId: order.userId });
    if (this.remaining(order).gt(0) && ![OrderType.Market, OrderType.IOC, OrderType.FOK].includes(order.type)) {
      this.orders.push(order);
    }
    this.gateway.publishUserOrder(order.userId, { order, matching: accepted, event });
    return { order, matching: accepted, event };
  }

  cancelOrder(orderId: string, symbol: string, userId: string) {
    const order = this.orders.find((candidate) => candidate.id === orderId && candidate.symbol === symbol && candidate.userId === userId);
    const result = { cancelled: false };
    if (order) {
      order.status = OrderStatus.Cancelled;
      result.cancelled = true;
    }
    this.gateway.publishUserOrder(userId, { orderId, status: OrderStatus.Cancelled });
    return result;
  }

  listOrders(userId?: string) {
    return userId ? this.orders.filter((order) => order.userId === userId) : this.orders;
  }

  listTrades(userId?: string) {
    return userId ? this.trades.filter((trade) => trade.makerUserId === userId || trade.takerUserId === userId) : this.trades;
  }

  private async match(incoming: StoredOrder) {
    const fills: StoredTrade[] = [];
    const candidates = this.orders
      .filter((order) => order.symbol === incoming.symbol && order.side !== incoming.side && [OrderStatus.New, OrderStatus.PartiallyFilled].includes(order.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const resting of candidates) {
      if (this.remaining(incoming).lte(0)) break;
      if (!this.crosses(incoming, resting)) continue;

      const quantity = DecimalMin(this.remaining(incoming), this.remaining(resting)).toFixed();
      const price = resting.price ?? incoming.price;
      if (!price) continue;
      const trade: StoredTrade = {
        id: randomUUID(),
        symbol: incoming.symbol,
        makerOrderId: resting.id,
        takerOrderId: incoming.id,
        makerUserId: resting.userId,
        takerUserId: incoming.userId,
        price,
        quantity,
        executedAt: new Date().toISOString()
      };

      await this.settleTrade(resting, incoming, trade);
      resting.filledQuantity = money(resting.filledQuantity).plus(quantity).toFixed();
      incoming.filledQuantity = money(incoming.filledQuantity).plus(quantity).toFixed();
      resting.status = this.remaining(resting).eq(0) ? OrderStatus.Filled : OrderStatus.PartiallyFilled;
      this.trades.push(trade);
      fills.push(trade);
      this.gateway.publishUserOrder(resting.userId, { order: resting, trade });
    }
    return fills;
  }

  private crosses(incoming: StoredOrder, resting: StoredOrder) {
    if (incoming.type === OrderType.Market) return true;
    if (!incoming.price || !resting.price) return false;
    return incoming.side === OrderSide.Buy ? money(incoming.price).gte(resting.price) : money(incoming.price).lte(resting.price);
  }

  private remaining(order: StoredOrder) {
    return money(order.quantity).minus(order.filledQuantity);
  }

  private async settleTrade(resting: StoredOrder, incoming: StoredOrder, trade: StoredTrade) {
    const [baseAsset, quoteAsset] = trade.symbol.split('-');
    const response = await fetch(`${this.walletUrl}/wallets/settle-trade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        makerUserId: resting.userId,
        takerUserId: incoming.userId,
        makerSide: resting.side,
        baseAsset,
        quoteAsset,
        price: trade.price,
        quantity: trade.quantity,
        referenceId: trade.id
      })
    });
    if (!response.ok) {
      const payload = await response.text();
      throw new Error(`wallet settlement failed: ${payload}`);
    }
  }
}

function DecimalMin(a: ReturnType<typeof money>, b: ReturnType<typeof money>) {
  return a.lte(b) ? a : b;
}

@Controller()
class TradingController {
  constructor(private readonly trading: TradingService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'trading-service' };
  }

  @Post('orders')
  placeOrder(@Body() dto: PlaceOrderDto) {
    return this.trading.placeOrder(dto);
  }

  @Delete('orders/:orderId')
  cancelOrder(@Param('orderId') orderId: string, @Query('symbol') symbol: string, @Query('userId') userId: string) {
    return this.trading.cancelOrder(orderId, symbol, userId);
  }

  @Get('orders')
  listOrders(@Query('userId') userId?: string) {
    return this.trading.listOrders(userId);
  }

  @Get('trades')
  listTrades(@Query('userId') userId?: string) {
    return this.trading.listTrades(userId);
  }
}

@Module({ controllers: [TradingController], providers: [TradingGateway, TradingService] })
class TradingModule {}

async function bootstrap() {
  const app = await NestFactory.create(TradingModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3003);
}

void bootstrap();
