// services/market-data-service/src/main.ts
import 'reflect-metadata';
import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ namespace: '/market', cors: true })
class MarketDataGateway {
  @WebSocketServer()
  server!: Server;

  publish(channel: string, payload: unknown) {
    this.server?.emit(channel, payload);
  }
}

class MarketDataService {
  getKlines(symbol: string, interval: string) {
    return [{ symbol, interval, openTime: Date.now(), open: '100', high: '105', low: '99', close: '103', volume: '12.5' }];
  }

  getTicker(symbol: string) {
    return { symbol, priceChange: '3', priceChangePercent: '3.0', lastPrice: '103', volume: '120000', high: '106', low: '98' };
  }

  getDepth(symbol: string) {
    return { symbol, bids: [['102', '4.2']], asks: [['104', '3.8']] };
  }

  getTrades(symbol: string) {
    return [{ symbol, price: '103', quantity: '0.45', executedAt: new Date().toISOString() }];
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

@Module({ controllers: [MarketDataController], providers: [MarketDataGateway, MarketDataService] })
class MarketDataModule {}

async function bootstrap() {
  const app = await NestFactory.create(MarketDataModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3005);
}

void bootstrap();
