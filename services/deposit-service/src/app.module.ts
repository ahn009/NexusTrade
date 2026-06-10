// services/deposit-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard, KafkaModule } from '@nexus/shared';
import { DepositController } from './controllers/deposit.controller';
import { DepositService } from './services/deposit.service';

@Module({ imports: [KafkaModule], controllers: [DepositController], providers: [DepositService, { provide: APP_GUARD, useClass: JwtAuthGuard }] })
export class DepositModule {}
