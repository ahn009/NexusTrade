// services/compliance-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { KafkaModule } from '@nexus/shared';
import { ComplianceController } from './controllers/compliance.controller';
import { ComplianceService } from './services/compliance.service';

@Module({ imports: [KafkaModule], controllers: [ComplianceController], providers: [ComplianceService] })
export class ComplianceModule {}
