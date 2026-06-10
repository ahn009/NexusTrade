// services/withdrawal-service/src/services/withdrawal.service.ts
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WithdrawalEntity } from '@nexus/database';
import { randomUUID } from 'crypto';
import { createEvent, EventType, KafkaService, KafkaTopics, money, TransactionStatus, Withdrawal } from '@nexus/shared';
import { Repository } from 'typeorm';
import { WithdrawalDto } from '../dto/withdrawal.dto';

@Injectable()
export class WithdrawalService {
  private whitelisted = new Map<string, Map<string, number>>();
  private readonly authUrl = process.env.AUTH_SERVICE_URL ?? 'http://localhost:3001';
  private readonly walletUrl = process.env.WALLET_SERVICE_URL ?? 'http://localhost:3004';

  constructor(
    @InjectRepository(WithdrawalEntity) private readonly withdrawals: Repository<WithdrawalEntity>,
    private readonly kafka: KafkaService
  ) {}

  whitelist(userId: string, address: string) {
    const addresses = this.whitelisted.get(userId) ?? new Map<string, number>();
    addresses.set(address, Date.now());
    this.whitelisted.set(userId, addresses);
    return { userId, address, whitelisted: true };
  }

  async request(dto: WithdrawalDto) {
    await this.verifyTotp(dto.userId, dto.totpCode);
    const whitelistedAt = this.whitelisted.get(dto.userId)?.get(dto.address);
    if (!whitelistedAt) {
      throw new HttpException('withdrawal address is not whitelisted', HttpStatus.FORBIDDEN);
    }
    const cooldownMs = Number(process.env.WITHDRAWAL_WHITELIST_COOLDOWN_MS ?? String(24 * 60 * 60 * 1000));
    if (Date.now() - whitelistedAt < cooldownMs) {
      throw new HttpException('withdrawal address cooldown is active', HttpStatus.FORBIDDEN);
    }
    const amount = money(dto.amount);
    await this.verifyBalance(dto.userId, dto.asset, amount.plus(amount.mul('0.001')).toFixed());
    const tier = amount.gte('1000000') ? 'COLD_CEREMONY' : amount.gte('100000') ? 'MULTI_PARTY' : amount.gte('10000') ? 'OPERATOR' : 'AUTO';
    const withdrawal = await this.withdrawals.save(this.withdrawals.create({
      id: randomUUID(),
      userId: dto.userId,
      asset: dto.asset,
      network: dto.network,
      address: dto.address,
      amount: amount.toFixed(),
      fee: amount.mul('0.001').toFixed(),
      approvalTier: tier,
      status: tier === 'AUTO' ? TransactionStatus.Confirmed : TransactionStatus.Pending
    }));
    const event = createEvent(EventType.WithdrawalRequested, withdrawal.id, withdrawal, 'withdrawal-service', { userId: dto.userId });
    await this.kafka.produce(KafkaTopics.Withdrawals, event, withdrawal.id).catch(() => undefined);
    return { withdrawal, event };
  }

  async approve(id: string, approverId: string) {
    const withdrawal = await this.withdrawals.findOne({ where: { id } });
    if (!withdrawal) return { found: false };
    withdrawal.status = TransactionStatus.Confirmed;
    await this.withdrawals.save(withdrawal);
    const event = createEvent(EventType.WithdrawalApproved, id, withdrawal, 'withdrawal-service', { userId: withdrawal.userId });
    await this.kafka.produce(KafkaTopics.Withdrawals, event, id).catch(() => undefined);
    return { approverId, withdrawal, event };
  }

  async reject(id: string, approverId: string) {
    const withdrawal = await this.withdrawals.findOne({ where: { id } });
    if (!withdrawal) return { found: false };
    withdrawal.status = TransactionStatus.Failed;
    await this.withdrawals.save(withdrawal);
    return { approverId, withdrawal };
  }

  list(userId?: string) {
    return this.withdrawals.find({ where: userId ? { userId } : {}, order: { createdAt: 'DESC' } });
  }

  private async verifyTotp(userId: string, code: string) {
    if (process.env.WITHDRAWAL_TOTP_REQUIRED === 'false') return;
    const response = await fetch(`${this.authUrl}/auth/totp/verify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.SERVICE_AUTH_TOKEN ? { 'x-service-token': process.env.SERVICE_AUTH_TOKEN } : {})
      },
      body: JSON.stringify({ userId, code })
    }).catch((error: Error) => {
      throw new HttpException(`totp verification unavailable: ${error.message}`, HttpStatus.SERVICE_UNAVAILABLE);
    });
    if (!response.ok) {
      throw new HttpException('totp verification failed', HttpStatus.UNAUTHORIZED);
    }
    const payload = await response.json().catch(() => ({ verified: false }));
    if (!payload.verified) {
      throw new HttpException('invalid totp code', HttpStatus.UNAUTHORIZED);
    }
  }

  private async verifyBalance(userId: string, asset: string, amount: string) {
    const response = await fetch(`${this.walletUrl}/wallets/${encodeURIComponent(userId)}/${encodeURIComponent(asset)}`, {
      headers: process.env.SERVICE_AUTH_TOKEN ? { 'x-service-token': process.env.SERVICE_AUTH_TOKEN } : {}
    }).catch((error: Error) => {
      throw new HttpException(`wallet balance check unavailable: ${error.message}`, HttpStatus.SERVICE_UNAVAILABLE);
    });
    if (!response.ok) throw new HttpException('wallet balance check failed', HttpStatus.BAD_REQUEST);
    const balance = await response.json() as { available?: string };
    if (money(balance.available ?? '0').lt(amount)) {
      throw new HttpException('insufficient balance', HttpStatus.BAD_REQUEST);
    }
  }
}
