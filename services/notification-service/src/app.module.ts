// services/notification-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule, JwtAuthGuard, KafkaModule } from '@nexus/shared';
import { NotificationController } from './controllers/notification.controller';
import { NotificationService } from './services/notification.service';

@Module({ imports: [DatabaseModule.forRoot(), KafkaModule], controllers: [NotificationController], providers: [NotificationService, { provide: APP_GUARD, useClass: JwtAuthGuard }] })
export class NotificationModule {}
