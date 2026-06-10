// services/notification-service/src/services/notification.service.ts
import { Injectable } from '@nestjs/common';
import { createEvent, EventType } from '@nexus/shared';
import { NotificationDto } from '../dto/notification.dto';

@Injectable()
export class NotificationService {
  private queue: NotificationDto[] = [];

  enqueue(dto: NotificationDto) {
    this.queue.push(dto);
    return { queued: true, position: this.queue.length, event: createEvent(EventType.NotificationRequested, dto.recipient, dto, 'notification-service') };
  }

  list() {
    return this.queue;
  }
}
