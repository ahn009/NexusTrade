// services/trading-service/src/services/trading.service.ts
import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AccountEntity, OrderEntity, TradeEntity, UserEntity } from '@nexus/database';
import { randomUUID } from 'crypto';
import {
  createEvent,
  EventType,
  GrpcMatchingClient,
  KafkaService,
  KafkaTopics,
  MatchFill,
  money,
  OrderSide,
  OrderStatus,
  OrderType,
  requireDecimalString,
  requireSymbol,
  Trade,
  UserStatus
} from '@nexus/shared';
import { In, Repository } from 'typeorm';
import { PlaceOrderDto } from '../dto/trading.dto';
import { TradingGateway } from '../gateways/trading.gateway';

export interface StoredOrder {
  id: string;
  userId: string;
  accountId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price?: string;
  stopPrice?: string;
  quantity: string;
  filledQuantity: string;
  status: OrderStatus;
  clientOrderId?: string;
  lockedAsset: string;
  lockedAmount: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class TradingService implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(TradingService.name);
  private readonly orders: StoredOrder[] = [];
  private readonly trades: Trade[] = [];
  private readonly walletUrl = process.env.WALLET_SERVICE_URL ?? 'http://localhost:3004';
  private readonly matching = new GrpcMatchingClient();
  private readonly makerFeeBps = requireDecimalString(process.env.MAKER_FEE_BPS ?? '2', 'MAKER_FEE_BPS');
  private readonly takerFeeBps = requireDecimalString(process.env.TAKER_FEE_BPS ?? '4', 'TAKER_FEE_BPS');

  constructor(
    @InjectRepository(OrderEntity) private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(TradeEntity) private readonly tradeRepository: Repository<TradeEntity>,
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(AccountEntity) private readonly accountRepository: Repository<AccountEntity>,
    private readonly gateway: TradingGateway,
    private readonly kafka: KafkaService
  ) {}

  async onModuleInit() {
    const activeOrders = await this.orderRepository.find({
      where: { status: In([OrderStatus.New, OrderStatus.PartiallyFilled]) },
      order: { createdAt: 'ASC' }
    });
    for (const entity of activeOrders) {
      const [baseAsset, quoteAsset] = splitSymbol(entity.symbol);
      const filledQuantity = entity.filledQuantity ?? '0';
      const remainingQuantity = money(entity.quantity).minus(filledQuantity).toFixed();
      if (money(remainingQuantity).lte(0)) continue;
      const restored: StoredOrder = {
        id: entity.id,
        userId: entity.userId,
        accountId: entity.accountId,
        symbol: entity.symbol,
        side: entity.side,
        type: entity.type,
        price: entity.price ?? undefined,
        stopPrice: entity.stopPrice ?? undefined,
        quantity: entity.quantity,
        filledQuantity,
        status: entity.status,
        clientOrderId: entity.clientOrderId ?? undefined,
        lockedAsset: entity.side === OrderSide.Buy ? quoteAsset : baseAsset,
        lockedAmount: '0',
        createdAt: entity.createdAt.toISOString(),
        updatedAt: entity.updatedAt.toISOString()
      };
      restored.lockedAmount = this.remainingLock(restored, quoteAsset);
      this.orders.push(restored);
    }
    if (this.orders.length > 0) {
      this.logger.log(`restored ${this.orders.length} active orders from database`);
    }
  }

  async placeOrder(dto: PlaceOrderDto) {
    await this.assertCanTrade(dto.userId, dto.accountId);
    const symbol = requireSymbol(dto.symbol);
    const [baseAsset, quoteAsset] = splitSymbol(symbol);
    const price = dto.price ? requireDecimalString(dto.price, 'price') : undefined;
    const quantity = requireDecimalString(dto.quantity, 'quantity');
    const order: StoredOrder = {
      id: randomUUID(),
      userId: dto.userId,
      accountId: dto.accountId,
      symbol,
      side: dto.side,
      type: dto.type,
      price,
      stopPrice: dto.stopPrice ? requireDecimalString(dto.stopPrice, 'stopPrice') : undefined,
      quantity,
      filledQuantity: '0',
      status: OrderStatus.New,
      clientOrderId: dto.clientOrderId,
      lockedAsset: dto.side === OrderSide.Buy ? quoteAsset : baseAsset,
      lockedAmount: '0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await this.orderRepository.save(this.orderRepository.create({
      id: order.id,
      userId: order.userId,
      accountId: order.accountId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      price: order.price,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      status: order.status,
      clientOrderId: order.clientOrderId
    }));

    order.lockedAmount = this.estimateLockAmount(order, quoteAsset, this.takerFeeBps);
    await this.lockBalance(order, order.lockedAmount);

    let matching;
    try {
      matching = await this.matching.submitOrder({
        orderId: order.id,
        userId: order.userId,
        symbol: order.symbol,
        side: order.side,
        orderType: order.type,
        price: order.price,
        stopPrice: order.stopPrice,
        quantity: order.quantity,
        clientOrderId: order.clientOrderId
      });
    } catch (error) {
      await this.unlockBalance(order, order.lockedAmount);
      throw new HttpException(`matching engine unavailable: ${(error as Error).message}`, HttpStatus.SERVICE_UNAVAILABLE);
    }

    if (!matching.accepted) {
      order.status = OrderStatus.Rejected;
      await this.orderRepository.update({ id: order.id }, { status: order.status });
      await this.unlockBalance(order, order.lockedAmount);
      return { order, matching };
    }

    const fills = this.toTrades(order, matching.fills, quoteAsset);
    for (const trade of fills) {
      await this.settleTrade(order, trade);
      await this.applyFillToLocalOrders(order, trade);
      const tradeEvent = createEvent(EventType.TradeExecuted, trade.id, trade, 'trading-service', { userId: order.userId });
      await this.kafka.produce(KafkaTopics.Trades, tradeEvent, trade.id);
    }

    order.filledQuantity = fills.reduce((filled, trade) => money(filled).plus(trade.quantity).toFixed(), order.filledQuantity);
    order.status = mapOrderStatus(matching.status);
    order.updatedAt = new Date().toISOString();
    await this.orderRepository.update({ id: order.id }, { filledQuantity: order.filledQuantity, status: order.status });
    await this.unlockUnusedIncomingLock(order, matching.fills, quoteAsset);

    const orderEvent = createEvent(EventType.OrderPlaced, order.id, order, 'trading-service', { userId: order.userId });
    await this.kafka.produce(KafkaTopics.Orders, orderEvent, order.id);

    if (fills.length > 0) {
      const matchedEvent = createEvent(EventType.OrderMatched, order.id, { orderId: order.id, trades: fills }, 'trading-service', { userId: order.userId });
      await this.kafka.produce(KafkaTopics.Orders, matchedEvent, order.id);
    }

    if (this.shouldRest(order)) {
      this.orders.push(order);
    }

    this.trades.push(...fills);
    this.gateway.publishUserOrder(order.userId, { order, matching: { ...matching, fills }, event: orderEvent });
    return { order, matching: { ...matching, fills }, event: orderEvent };
  }

  async cancelOrder(orderId: string, symbol: string, userId: string) {
    const normalizedSymbol = requireSymbol(symbol);
    const result = await this.matching.cancelOrder(orderId, normalizedSymbol, userId);
    const order = this.orders.find((candidate) => candidate.id === orderId && candidate.symbol === normalizedSymbol && candidate.userId === userId);
    if (result.cancelled && order) {
      await this.unlockBalance(order, order.lockedAmount);
      order.lockedAmount = '0';
      order.status = OrderStatus.Cancelled;
      order.updatedAt = new Date().toISOString();
      await this.orderRepository.update({ id: order.id }, { status: order.status });
      this.orders.splice(this.orders.indexOf(order), 1);
      const event = createEvent(EventType.OrderCancelled, order.id, order, 'trading-service', { userId });
      await this.kafka.produce(KafkaTopics.Orders, event, order.id);
    }
    this.gateway.publishUserOrder(userId, { orderId, status: result.cancelled ? OrderStatus.Cancelled : OrderStatus.Rejected });
    return result;
  }

  listOrders(userId?: string) {
    return this.orderRepository.find({ where: userId ? { userId } : {}, order: { createdAt: 'DESC' } });
  }

  listTrades(userId?: string) {
    if (!userId) return this.tradeRepository.find({ order: { executedAt: 'DESC' } });
    return this.tradeRepository
      .createQueryBuilder('trade')
      .where('trade.maker_user_id = :userId or trade.taker_user_id = :userId', { userId })
      .orderBy('trade.executed_at', 'DESC')
      .getMany();
  }

  async onModuleDestroy() {
    this.matching.close();
  }

  private estimateLockAmount(order: StoredOrder, quoteAsset: string, feeBps: string) {
    if (order.side === OrderSide.Sell) return order.quantity;
    if (!order.price) {
      throw new HttpException('buy orders require price for pre-trade balance locking', HttpStatus.BAD_REQUEST);
    }
    const notional = money(order.price).mul(order.quantity);
    return quoteAsset ? notional.plus(this.calculateFee(notional.toFixed(), feeBps)).toFixed() : notional.toFixed();
  }

  private async lockBalance(order: StoredOrder, amount: string) {
    await this.walletPost('/wallets/lock', {
      userId: order.userId,
      asset: order.lockedAsset,
      amount,
      referenceId: order.id
    });
  }

  private async unlockBalance(order: StoredOrder, amount: string) {
    if (money(amount).lte(0)) return;
    await this.walletPost('/wallets/unlock', {
      userId: order.userId,
      asset: order.lockedAsset,
      amount,
      referenceId: order.id
    });
  }

  private async unlockUnusedIncomingLock(order: StoredOrder, fills: MatchFill[], quoteAsset: string) {
    const consumed = fills.reduce((total, fill) => money(total).plus(this.consumedLockForFill(order.side, fill.price, fill.quantity, this.takerFeeBps)).toFixed(), '0');
    const restLock = this.shouldRest(order) ? this.remainingLock(order, quoteAsset) : '0';
    const unused = money(order.lockedAmount).minus(consumed).minus(restLock).toFixed();
    await this.unlockBalance(order, unused);
    order.lockedAmount = restLock;
  }

  private remainingLock(order: StoredOrder, quoteAsset: string) {
    const remainingQuantity = money(order.quantity).minus(order.filledQuantity).toFixed();
    if (order.side === OrderSide.Sell) return remainingQuantity;
    if (!order.price) return '0';
    const notional = money(order.price).mul(remainingQuantity).toFixed();
    return quoteAsset ? money(notional).plus(this.calculateFee(notional, this.takerFeeBps)).toFixed() : notional;
  }

  private consumedLockForFill(side: OrderSide, price: string, quantity: string, feeBps: string) {
    if (side === OrderSide.Sell) return quantity;
    const notional = money(price).mul(quantity).toFixed();
    return money(notional).plus(this.calculateFee(notional, feeBps)).toFixed();
  }

  private toTrades(incoming: StoredOrder, fills: MatchFill[], quoteAsset: string): Trade[] {
    return fills.map((fill) => {
      const notional = money(fill.price).mul(fill.quantity).toFixed();
      return {
        id: fill.tradeId,
        symbol: incoming.symbol,
        makerOrderId: fill.makerOrderId,
        takerOrderId: fill.takerOrderId,
        makerUserId: fill.makerUserId,
        takerUserId: fill.takerUserId,
        price: fill.price,
        quantity: fill.quantity,
        feeAsset: quoteAsset,
        makerFee: this.calculateFee(notional, this.makerFeeBps),
        takerFee: this.calculateFee(notional, this.takerFeeBps),
        executedAt: new Date().toISOString()
      };
    });
  }

  private async applyFillToLocalOrders(incoming: StoredOrder, trade: Trade) {
    const maker = this.orders.find((order) => order.id === trade.makerOrderId);
    if (!maker) return;
    maker.filledQuantity = money(maker.filledQuantity).plus(trade.quantity).toFixed();
    maker.lockedAmount = money(maker.lockedAmount)
      .minus(this.consumedLockForFill(maker.side, trade.price, trade.quantity, this.makerFeeBps))
      .toFixed();
    maker.status = money(maker.filledQuantity).gte(maker.quantity) ? OrderStatus.Filled : OrderStatus.PartiallyFilled;
    maker.updatedAt = new Date().toISOString();
    await this.orderRepository.update({ id: maker.id }, { filledQuantity: maker.filledQuantity, status: maker.status });
    if (maker.status === OrderStatus.Filled) {
      await this.unlockBalance(maker, maker.lockedAmount);
      maker.lockedAmount = '0';
      this.orders.splice(this.orders.indexOf(maker), 1);
    }
    this.gateway.publishUserOrder(maker.userId, { order: maker, trade });
    if (incoming.id === trade.takerOrderId) {
      this.logger.debug(`incoming order ${incoming.id} filled against maker ${maker.id}`);
    }
  }

  private async settleTrade(incoming: StoredOrder, trade: Trade) {
    const [baseAsset, quoteAsset] = splitSymbol(trade.symbol);
    const maker = this.orders.find((order) => order.id === trade.makerOrderId);
    const makerSide = maker?.side ?? (incoming.side === OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy);
    await this.walletPost('/wallets/settle-trade', {
      makerUserId: trade.makerUserId,
      takerUserId: trade.takerUserId,
      makerSide,
      baseAsset,
      quoteAsset,
      price: trade.price,
      quantity: trade.quantity,
      makerFee: trade.makerFee,
      takerFee: trade.takerFee,
      feeAsset: trade.feeAsset,
      referenceId: trade.id
    });
    await this.tradeRepository.save(this.tradeRepository.create({
      id: trade.id,
      symbol: trade.symbol,
      makerOrderId: trade.makerOrderId,
      takerOrderId: trade.takerOrderId,
      makerUserId: trade.makerUserId,
      takerUserId: trade.takerUserId,
      price: trade.price,
      quantity: trade.quantity,
      feeAsset: trade.feeAsset,
      makerFee: trade.makerFee,
      takerFee: trade.takerFee,
      executedAt: new Date(trade.executedAt)
    }));
  }

  private async walletPost(path: string, body: Record<string, string>) {
    const response = await fetch(`${this.walletUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const payload = await response.text();
      throw new HttpException(`wallet request failed: ${payload}`, HttpStatus.BAD_REQUEST);
    }
    return response.json().catch(() => ({}));
  }

  private calculateFee(notional: string, feeBps: string) {
    return money(notional).mul(feeBps).div('10000').toFixed();
  }

  private shouldRest(order: StoredOrder) {
    return money(order.quantity).minus(order.filledQuantity).gt(0) && [OrderStatus.New, OrderStatus.PartiallyFilled].includes(order.status);
  }

  private async assertCanTrade(userId: string, accountId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new HttpException('user not found', HttpStatus.NOT_FOUND);
    if ([UserStatus.Frozen, UserStatus.Closed].includes(user.status)) {
      throw new HttpException('account is not active', HttpStatus.FORBIDDEN);
    }
    const account = await this.accountRepository.findOne({ where: { id: accountId, userId } });
    if (!account) throw new HttpException('account not found', HttpStatus.NOT_FOUND);
    if (account.isFrozen) {
      throw new HttpException('account is frozen', HttpStatus.FORBIDDEN);
    }
  }
}

function splitSymbol(symbol: string): [string, string] {
  const [baseAsset, quoteAsset] = symbol.split('-');
  return [baseAsset, quoteAsset];
}

function mapOrderStatus(status: string): OrderStatus {
  const normalized = status.toUpperCase();
  switch (normalized) {
    case 'NEW':
      return OrderStatus.New;
    case 'PARTIALLY_FILLED':
      return OrderStatus.PartiallyFilled;
    case 'FILLED':
      return OrderStatus.Filled;
    case 'CANCELLED':
      return OrderStatus.Cancelled;
    case 'EXPIRED':
      return OrderStatus.Expired;
    default:
      return OrderStatus.Rejected;
  }
}
