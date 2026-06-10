// services/wallet-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule, JwtAuthGuard, KafkaModule } from '@nexus/shared';
import { WalletController } from './controllers/wallet.controller';
import { WalletService } from './services/wallet.service';

@Module({ imports: [DatabaseModule.forRoot(), KafkaModule], controllers: [WalletController], providers: [WalletService, { provide: APP_GUARD, useClass: JwtAuthGuard }] })
export class WalletModule {}
