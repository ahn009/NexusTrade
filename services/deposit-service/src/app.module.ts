// services/deposit-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { KafkaModule } from '@nexus/shared';
import { DepositController } from './controllers/deposit.controller';
import { DepositService } from './services/deposit.service';

@Module({ imports: [KafkaModule], controllers: [DepositController], providers: [DepositService] })
export class DepositModule {}
