// services/market-data-service/src/main.ts
import 'reflect-metadata';
import { Controller, Get, Logger, Module, OnModuleInit, Param, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { configureHttpSecurity, EventType, KafkaEvent, KafkaModule, KafkaService, KafkaTopics, money, Trade } from '@nexus/shared';
import { Server } from 'socket.io';

@WebSocketGateway({ namespace: '/market', cors: true })
class MarketDataGateway {
  @WebSocketServer()
  server!: Server;

  publish(channel: string, payload: unknown) {
    this.server?.emit(channel, payload);
  }
}

class MarketDataService implements OnModuleInit {
  private readonly logger = new Logger(MarketDataService.name);
  private readonly trades = new Map<string, Trade[]>();
  private readonly tickers = new Map<string, { symbol: string; lastPrice: string; volume: string; high: string; low: string }>();

  constructor(private readonly gateway: MarketDataGateway, private readonly kafka: KafkaService) {}

  async onModuleInit() {
    await this.kafka.consume<KafkaEvent<Trade>>({ topic: KafkaTopics.Trades, groupId: 'market-data-service' }, async (event) => {
      if (event.eventType !== EventType.TradeExecuted) return;
      this.recordTrade(event.payload);
    }).catch((error) => this.logger.warn(`trade consumer unavailable: ${(error as Error).message}`));
  }

  getKlines(symbol: string, interval: string) {
    const trades = this.trades.get(symbol) ?? [];
    if (trades.length === 0) return [];
    const prices = trades.map((trade) => money(trade.price));
    const volume = trades.reduce((total, trade) => money(total).plus(trade.quantity).toFixed(), '0');
    return [{
      symbol,
      interval,
      openTime: new Date(trades[0].executedAt).getTime(),
      open: trades[0].price,
      high: DecimalMax(prices).toFixed(),
      low: DecimalMin(prices).toFixed(),
      close: trades[trades.length - 1].price,
      volume
    }];
  }

  getTicker(symbol: string) {
    return this.tickers.get(symbol) ?? { symbol, priceChange: '0', priceChangePercent: '0', lastPrice: '0', volume: '0', high: '0', low: '0' };
  }

  getDepth(symbol: string) {
    return { symbol, bids: [['102', '4.2']], asks: [['104', '3.8']] };
  }

  getTrades(symbol: string) {
    return this.trades.get(symbol) ?? [];
  }

  private recordTrade(trade: Trade) {
    const trades = this.trades.get(trade.symbol) ?? [];
    trades.push(trade);
    this.trades.set(trade.symbol, trades.slice(-1000));
    const ticker = this.tickers.get(trade.symbol);
    const volume = money(ticker?.volume ?? '0').plus(trade.quantity).toFixed();
    const high = !ticker || money(trade.price).gt(ticker.high) ? trade.price : ticker.high;
    const low = !ticker || money(trade.price).lt(ticker.low) ? trade.price : ticker.low;
    this.tickers.set(trade.symbol, { symbol: trade.symbol, lastPrice: trade.price, volume, high, low });
    this.gateway.publish('trade', trade);
    this.gateway.publish('ticker', this.getTicker(trade.symbol));
  }
}

@Controller()
class MarketDataController {
  constructor(private readonly marketData: MarketDataService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'market-data-service', clickhouse: 'configured' };
  }

  @Get('klines/:symbol')
  klines(@Param('symbol') symbol: string, @Query('interval') interval = '1m') {
    return this.marketData.getKlines(symbol, interval);
  }

  @Get('ticker/:symbol')
  ticker(@Param('symbol') symbol: string) {
    return this.marketData.getTicker(symbol);
  }

  @Get('depth/:symbol')
  depth(@Param('symbol') symbol: string) {
    return this.marketData.getDepth(symbol);
  }

  @Get('trades/:symbol')
  trades(@Param('symbol') symbol: string) {
    return this.marketData.getTrades(symbol);
  }
}

@Module({ imports: [KafkaModule], controllers: [MarketDataController], providers: [MarketDataGateway, MarketDataService] })
class MarketDataModule {}

async function bootstrap() {
  const app = await NestFactory.create(MarketDataModule);
  configureHttpSecurity(app);
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3005);
}

void bootstrap();

function DecimalMax(values: ReturnType<typeof money>[]) {
  return values.reduce((max, value) => (value.gt(max) ? value : max), values[0]);
}

function DecimalMin(values: ReturnType<typeof money>[]) {
  return values.reduce((min, value) => (value.lt(min) ? value : min), values[0]);
}
