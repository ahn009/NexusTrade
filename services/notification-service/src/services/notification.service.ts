// services/notification-service/src/services/notification.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { NotificationEntity } from '@nexus/database';
import { createEvent, EventType, KafkaEvent, KafkaService, KafkaTopics } from '@nexus/shared';
import { Repository } from 'typeorm';
import { NotificationDto } from '../dto/notification.dto';

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(NotificationEntity) private readonly notifications: Repository<NotificationEntity>,
    private readonly kafka: KafkaService
  ) {}

  async onModuleInit() {
    const topics = [KafkaTopics.Users, KafkaTopics.Orders, KafkaTopics.Trades, KafkaTopics.Deposits, KafkaTopics.Withdrawals, KafkaTopics.Risk, KafkaTopics.Compliance];
    for (const topic of topics) {
      await this.kafka.consume<KafkaEvent<unknown>>({ topic, groupId: `notification-service-${topic}` }, async (event) => {
        const recipient = event.metadata.userId ? `${event.metadata.userId}@users.nexustrade.local` : 'ops@nexustrade.local';
        await this.persist({
          channel: 'in_app',
          recipient,
          template: event.eventType,
          message: `${event.eventType} received for ${event.aggregateId}`
        });
      }).catch((error) => this.logger.warn(`consumer unavailable for ${topic}: ${(error as Error).message}`));
    }
  }

  async enqueue(dto: NotificationDto) {
    const notification = await this.persist(dto);
    this.deliver(dto);
    const event = createEvent(EventType.NotificationRequested, dto.recipient, dto, 'notification-service');
    await this.kafka.produce(KafkaTopics.Notifications, event, dto.recipient);
    return { queued: true, notification, event };
  }

  list() {
    return this.notifications.find({ order: { createdAt: 'DESC' }, take: 100 });
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

  private persist(dto: NotificationDto) {
    return this.notifications.save(this.notifications.create({ ...dto, status: 'queued' }));
  }
}
