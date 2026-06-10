// services/compliance-service/src/services/compliance.service.ts
import { Injectable } from '@nestjs/common';
import { createEvent, EventType, KafkaService, KafkaTopics, money } from '@nexus/shared';
import { TransactionScreenDto } from '../dto/compliance.dto';

@Injectable()
export class ComplianceService {
  private watchlist = new Set(['blocked-address', 'sanctioned-entity']);

  constructor(private readonly kafka: KafkaService) {}

  async screen(dto: TransactionScreenDto) {
    const highValue = money(dto.amountUsd).gte('10000');
    const sanctionsHit = this.watchlist.has(dto.counterparty);
    const suspicious = highValue || sanctionsHit;
    const payload = { ...dto, highValue, sanctionsHit, suspicious, travelRuleRequired: money(dto.amountUsd).gte('1000') };
    const event = suspicious ? createEvent(EventType.SuspiciousActivityDetected, dto.userId, payload, 'compliance-service', { userId: dto.userId }) : null;
    if (event) await this.kafka.produce(KafkaTopics.Compliance, event, dto.userId).catch(() => undefined);
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
