// services/notification-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard, KafkaModule } from '@nexus/shared';
import { NotificationController } from './controllers/notification.controller';
import { NotificationService } from './services/notification.service';

@Module({ imports: [KafkaModule], controllers: [NotificationController], providers: [NotificationService, { provide: APP_GUARD, useClass: JwtAuthGuard }] })
export class NotificationModule {}
