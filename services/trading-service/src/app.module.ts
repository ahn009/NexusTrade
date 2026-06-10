// services/trading-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard, KafkaModule } from '@nexus/shared';
import { TradingController } from './controllers/trading.controller';
import { TradingGateway } from './gateways/trading.gateway';
import { TradingService } from './services/trading.service';

@Module({ imports: [KafkaModule], controllers: [TradingController], providers: [TradingGateway, TradingService, { provide: APP_GUARD, useClass: JwtAuthGuard }] })
export class TradingModule {}
