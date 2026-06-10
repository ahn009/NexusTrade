// services/risk-engine/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard, KafkaModule } from '@nexus/shared';
import { RiskController } from './controllers/risk.controller';
import { RiskService } from './services/risk.service';

@Module({ imports: [KafkaModule], controllers: [RiskController], providers: [RiskService, { provide: APP_GUARD, useClass: JwtAuthGuard }] })
export class RiskModule {}
