// services/risk-engine/src/services/risk.service.ts
import { Injectable } from '@nestjs/common';
import { createEvent, EventType, KafkaService, KafkaTopics, money } from '@nexus/shared';
import { PositionDto } from '../dto/risk.dto';

@Injectable()
export class RiskService {
  constructor(private readonly kafka: KafkaService) {}

  async evaluate(position: PositionDto) {
    const equity = money(position.equity);
    const maintenance = money(position.maintenanceMargin);
    const marginRatio = equity.div(position.notional).toFixed();
    const liquidatable = equity.minus(maintenance).lt(0);
    const payload = { ...position, marginRatio, liquidatable, insuranceFundAsset: 'USDT' };
    const event = liquidatable ? createEvent(EventType.LiquidationTriggered, `${position.userId}:${position.symbol}`, payload, 'risk-engine', { userId: position.userId }) : null;
    if (event) await this.kafka.produce(KafkaTopics.Risk, event, event.aggregateId).catch(() => undefined);
    return { payload, event };
  }

  insuranceFund() {
    return { asset: 'USDT', balance: '25000000', stressScenarioCoverage: '30pct-1min' };
  }
}
