// services/notification-service/src/controllers/notification.controller.ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { Public } from '@nexus/shared';
import { NotificationDto } from '../dto/notification.dto';
import { NotificationService } from '../services/notification.service';

@Controller()
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Public()
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
