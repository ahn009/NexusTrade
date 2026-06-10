// services/trading-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { KafkaModule } from '@nexus/shared';
import { TradingController } from './controllers/trading.controller';
import { TradingGateway } from './gateways/trading.gateway';
import { TradingService } from './services/trading.service';

@Module({ imports: [KafkaModule], controllers: [TradingController], providers: [TradingGateway, TradingService] })
export class TradingModule {}
