// services/withdrawal-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { KafkaModule } from '@nexus/shared';
import { WithdrawalController } from './controllers/withdrawal.controller';
import { WithdrawalService } from './services/withdrawal.service';

@Module({ imports: [KafkaModule], controllers: [WithdrawalController], providers: [WithdrawalService] })
export class WithdrawalModule {}
