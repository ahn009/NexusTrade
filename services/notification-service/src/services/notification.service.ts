// services/notification-service/src/services/notification.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createEvent, EventType, KafkaEvent, KafkaService, KafkaTopics } from '@nexus/shared';
import { NotificationDto } from '../dto/notification.dto';

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);
  private queue: NotificationDto[] = [];

  constructor(private readonly kafka: KafkaService) {}

  async onModuleInit() {
    const topics = [KafkaTopics.Users, KafkaTopics.Orders, KafkaTopics.Trades, KafkaTopics.Deposits, KafkaTopics.Withdrawals, KafkaTopics.Risk, KafkaTopics.Compliance];
    for (const topic of topics) {
      await this.kafka.consume<KafkaEvent<unknown>>({ topic, groupId: `notification-service-${topic}` }, async (event) => {
        const recipient = event.metadata.userId ? `${event.metadata.userId}@users.nexustrade.local` : 'ops@nexustrade.local';
        this.queue.push({
          channel: 'in_app',
          recipient,
          template: event.eventType,
          message: `${event.eventType} received for ${event.aggregateId}`
        });
      }).catch((error) => this.logger.warn(`consumer unavailable for ${topic}: ${(error as Error).message}`));
    }
  }

  enqueue(dto: NotificationDto) {
    this.queue.push(dto);
    this.deliver(dto);
    return { queued: true, position: this.queue.length, event: createEvent(EventType.NotificationRequested, dto.recipient, dto, 'notification-service') };
  }

  list() {
    return this.queue;
  }

  private deliver(dto: NotificationDto) {
    const provider = {
      email: process.env.EMAIL_PROVIDER ?? 'log',
      sms: process.env.SMS_PROVIDER ?? 'log',
      push: process.env.PUSH_PROVIDER ?? 'log',
      in_app: 'queue'
    }[dto.channel];
    this.logger.log(`notification queued via ${provider}: ${dto.template} -> ${dto.recipient}`);
  }
}
