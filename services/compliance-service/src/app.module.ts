// services/compliance-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard, KafkaModule } from '@nexus/shared';
import { ComplianceController } from './controllers/compliance.controller';
import { ComplianceService } from './services/compliance.service';

@Module({ imports: [KafkaModule], controllers: [ComplianceController], providers: [ComplianceService, { provide: APP_GUARD, useClass: JwtAuthGuard }] })
export class ComplianceModule {}
