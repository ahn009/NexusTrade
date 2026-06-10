// services/risk-engine/src/app.module.ts
import { Module } from '@nestjs/common';
import { KafkaModule } from '@nexus/shared';
import { RiskController } from './controllers/risk.controller';
import { RiskService } from './services/risk.service';

@Module({ imports: [KafkaModule], controllers: [RiskController], providers: [RiskService] })
export class RiskModule {}
