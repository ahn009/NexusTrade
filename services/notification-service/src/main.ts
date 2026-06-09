// services/notification-service/src/main.ts
import 'reflect-metadata';
import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IsEmail, IsIn, IsString } from 'class-validator';
import { createEvent, EventType } from '@nexus/shared';

class NotificationDto {
  @IsIn(['email', 'sms', 'push', 'in_app'])
  channel!: 'email' | 'sms' | 'push' | 'in_app';

  @IsEmail()
  recipient!: string;

  @IsString()
  template!: string;

  @IsString()
  message!: string;
}

class NotificationService {
  private queue: NotificationDto[] = [];

  enqueue(dto: NotificationDto) {
    this.queue.push(dto);
    return { queued: true, position: this.queue.length, event: createEvent(EventType.NotificationRequested, dto.recipient, dto, 'notification-service') };
  }

  list() {
    return this.queue;
  }
}

@Controller()
class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'notification-service' };
  }

  @Post('notifications')
  enqueue(@Body() dto: NotificationDto) {
    return this.notifications.enqueue(dto);
  }

  @Get('notifications')
  list() {
    return this.notifications.list();
  }
}

@Module({ controllers: [NotificationController], providers: [NotificationService] })
class NotificationModule {}

async function bootstrap() {
  const app = await NestFactory.create(NotificationModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3010);
}

void bootstrap();
