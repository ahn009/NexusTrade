// services/withdrawal-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard, KafkaModule } from '@nexus/shared';
import { WithdrawalController } from './controllers/withdrawal.controller';
import { WithdrawalService } from './services/withdrawal.service';

@Module({ imports: [KafkaModule], controllers: [WithdrawalController], providers: [WithdrawalService, { provide: APP_GUARD, useClass: JwtAuthGuard }] })
export class WithdrawalModule {}
