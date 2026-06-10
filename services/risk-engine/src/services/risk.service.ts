// services/risk-engine/src/services/risk.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createEvent, EventType, KafkaEvent, KafkaService, KafkaTopics, money, Trade } from '@nexus/shared';
import { PositionDto } from '../dto/risk.dto';

@Injectable()
export class RiskService implements OnModuleInit {
  private readonly logger = new Logger(RiskService.name);

  constructor(private readonly kafka: KafkaService) {}

  async onModuleInit() {
    await this.kafka.consume<KafkaEvent<Trade>>({ topic: KafkaTopics.Trades, groupId: 'risk-engine' }, async (event) => {
      if (event.eventType !== EventType.TradeExecuted) return;
      const notional = money(event.payload.price).mul(event.payload.quantity).toFixed();
      await this.evaluate({ userId: event.payload.takerUserId, symbol: event.payload.symbol, notional, equity: notional, maintenanceMargin: '0' });
    }).catch((error) => this.logger.warn(`trade consumer unavailable: ${(error as Error).message}`));
  }

  async evaluate(position: PositionDto) {
    const equity = money(position.equity);
    const maintenance = money(position.maintenanceMargin);
    const marginRatio = money(position.notional).eq(0) ? '0' : equity.div(position.notional).toFixed();
    const liquidatable = equity.minus(maintenance).lt(0);
    const payload = { ...position, marginRatio, liquidatable, insuranceFundAsset: 'USDT' };
    const event = liquidatable ? createEvent(EventType.LiquidationTriggered, `${position.userId}:${position.symbol}`, payload, 'risk-engine', { userId: position.userId }) : null;
    if (event) await this.kafka.produce(KafkaTopics.Risk, event, event.aggregateId);
    return { payload, event };
  }

  insuranceFund() {
    return { asset: 'USDT', balance: '25000000', stressScenarioCoverage: '30pct-1min' };
  }
}
