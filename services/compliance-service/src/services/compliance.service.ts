// services/compliance-service/src/services/compliance.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createEvent, EventType, KafkaEvent, KafkaService, KafkaTopics, money, Withdrawal } from '@nexus/shared';
import { TransactionScreenDto } from '../dto/compliance.dto';

@Injectable()
export class ComplianceService implements OnModuleInit {
  private readonly logger = new Logger(ComplianceService.name);
  private watchlist = new Set((process.env.COMPLIANCE_WATCHLIST ?? 'blocked-address,sanctioned-entity').split(',').map((entry) => entry.trim()).filter(Boolean));

  constructor(private readonly kafka: KafkaService) {}

  async onModuleInit() {
    await this.kafka.consume<KafkaEvent<Withdrawal>>({ topic: KafkaTopics.Withdrawals, groupId: 'compliance-service' }, async (event) => {
      if (event.eventType !== EventType.WithdrawalRequested) return;
      await this.screen({
        userId: event.payload.userId,
        asset: event.payload.asset,
        amountUsd: event.payload.amount,
        counterparty: event.payload.address
      });
    }).catch((error) => this.logger.warn(`withdrawal consumer unavailable: ${(error as Error).message}`));
  }

  async screen(dto: TransactionScreenDto) {
    const highValue = money(dto.amountUsd).gte('10000');
    const sanctionsHit = this.watchlist.has(dto.counterparty);
    const suspicious = highValue || sanctionsHit;
    const payload = { ...dto, highValue, sanctionsHit, suspicious, travelRuleRequired: money(dto.amountUsd).gte('1000') };
    const event = suspicious ? createEvent(EventType.SuspiciousActivityDetected, dto.userId, payload, 'compliance-service', { userId: dto.userId }) : null;
    if (event) await this.kafka.produce(KafkaTopics.Compliance, event, dto.userId);
    return { payload, event };
  }

  regulatoryMatrix() {
    return [
      { region: 'Singapore', regulations: ['PSA', 'MAS Guidelines'], license: 'MPI License', phase: 1 },
      { region: 'European Union', regulations: ['MiCA', 'AMLD6', 'GDPR'], license: 'CASP License', phase: 2 },
      { region: 'United States', regulations: ['BSA', 'SEC', 'CFTC', 'FinCEN'], license: 'MTS + Broker-Dealer', phase: 3 }
    ];
  }
}
