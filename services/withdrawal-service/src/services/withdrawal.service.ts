// services/withdrawal-service/src/services/withdrawal.service.ts
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createEvent, EventType, KafkaService, KafkaTopics, money, TransactionStatus, Withdrawal } from '@nexus/shared';
import { WithdrawalDto } from '../dto/withdrawal.dto';

@Injectable()
export class WithdrawalService {
  private withdrawals: Withdrawal[] = [];
  private whitelisted = new Map<string, Set<string>>();

  constructor(private readonly kafka: KafkaService) {}

  whitelist(userId: string, address: string) {
    const set = this.whitelisted.get(userId) ?? new Set<string>();
    set.add(address);
    this.whitelisted.set(userId, set);
    return { userId, address, whitelisted: true };
  }

  async request(dto: WithdrawalDto) {
    if (!this.whitelisted.get(dto.userId)?.has(dto.address)) {
      throw new HttpException('withdrawal address is not whitelisted', HttpStatus.FORBIDDEN);
    }
    const amount = money(dto.amount);
    const tier = amount.gte('1000000') ? 'COLD_CEREMONY' : amount.gte('100000') ? 'MULTI_PARTY' : amount.gte('10000') ? 'OPERATOR' : 'AUTO';
    const withdrawal: Withdrawal = {
      id: randomUUID(),
      userId: dto.userId,
      asset: dto.asset,
      network: dto.network,
      address: dto.address,
      amount: amount.toFixed(),
      fee: amount.mul('0.001').toFixed(),
      approvalTier: tier,
      status: tier === 'AUTO' ? TransactionStatus.Confirmed : TransactionStatus.Pending
    };
    this.withdrawals.push(withdrawal);
    const event = createEvent(EventType.WithdrawalRequested, withdrawal.id, withdrawal, 'withdrawal-service', { userId: dto.userId });
    await this.kafka.produce(KafkaTopics.Withdrawals, event, withdrawal.id).catch(() => undefined);
    return { withdrawal, event };
  }

  async approve(id: string, approverId: string) {
    const withdrawal = this.withdrawals.find((candidate) => candidate.id === id);
    if (!withdrawal) return { found: false };
    withdrawal.status = TransactionStatus.Confirmed;
    const event = createEvent(EventType.WithdrawalApproved, id, withdrawal, 'withdrawal-service', { userId: withdrawal.userId });
    await this.kafka.produce(KafkaTopics.Withdrawals, event, id).catch(() => undefined);
    return { approverId, withdrawal, event };
  }

  list(userId?: string) {
    return userId ? this.withdrawals.filter((withdrawal) => withdrawal.userId === userId) : this.withdrawals;
  }
}
