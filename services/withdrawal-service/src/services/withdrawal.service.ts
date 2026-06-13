// services/withdrawal-service/src/services/withdrawal.service.ts
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity, WithdrawalAddressEntity, WithdrawalEntity } from '@nexus/database';
import { randomUUID } from 'crypto';
import { createEvent, EventType, KafkaService, KafkaTopics, money, TransactionStatus, UserStatus, Withdrawal } from '@nexus/shared';
import { Repository } from 'typeorm';
import { WithdrawalDto } from '../dto/withdrawal.dto';

@Injectable()
export class WithdrawalService {
  private readonly authUrl = process.env.AUTH_SERVICE_URL ?? 'http://localhost:3001';
  private readonly walletUrl = process.env.WALLET_SERVICE_URL ?? 'http://localhost:3004';

  constructor(
    @InjectRepository(WithdrawalEntity) private readonly withdrawals: Repository<WithdrawalEntity>,
    @InjectRepository(WithdrawalAddressEntity) private readonly addresses: Repository<WithdrawalAddressEntity>,
    private readonly kafka: KafkaService,
    @InjectRepository(UserEntity) private readonly users?: Repository<UserEntity>
  ) {}

  async whitelist(userId: string, body: { asset?: string; network?: string; address: string; label?: string }) {
    await this.assertUserCanTransact(userId);
    const asset = body.asset ?? 'USDT';
    const network = body.network ?? 'ETH';
    const existing = await this.addresses.findOne({ where: { userId, asset, network, address: body.address } });
    const entry = existing ?? await this.addresses.save(this.addresses.create({ userId, asset, network, address: body.address, label: body.label ?? 'Withdrawal whitelist' }));
    return { userId, address: entry.address, whitelisted: true, createdAt: entry.createdAt };
  }

  async request(dto: WithdrawalDto) {
    await this.assertUserCanTransact(dto.userId);
    await this.verifyTotp(dto.userId, dto.totpCode);
    const whitelistedAddress = await this.addresses.findOne({ where: { userId: dto.userId, asset: dto.asset, network: dto.network, address: dto.address } });
    if (!whitelistedAddress) {
      throw new HttpException('withdrawal address is not whitelisted', HttpStatus.FORBIDDEN);
    }
    const cooldownMs = Number(process.env.WITHDRAWAL_WHITELIST_COOLDOWN_MS ?? String(24 * 60 * 60 * 1000));
    if (Date.now() - whitelistedAddress.createdAt.getTime() < cooldownMs) {
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
    await this.kafka.produce(KafkaTopics.Withdrawals, event, withdrawal.id);
    if (withdrawal.status === TransactionStatus.Confirmed) {
      const approvalEvent = createEvent(EventType.WithdrawalApproved, withdrawal.id, withdrawal, 'withdrawal-service', { userId: dto.userId });
      await this.kafka.produce(KafkaTopics.Withdrawals, approvalEvent, withdrawal.id);
      return { withdrawal, event, approvalEvent };
    }
    return { withdrawal, event };
  }

  async approve(id: string, approverId: string) {
    const withdrawal = await this.withdrawals.findOne({ where: { id } });
    if (!withdrawal) return { found: false };
    await this.assertUserCanTransact(withdrawal.userId);
    withdrawal.status = TransactionStatus.Confirmed;
    await this.withdrawals.save(withdrawal);
    const event = createEvent(EventType.WithdrawalApproved, id, withdrawal, 'withdrawal-service', { userId: withdrawal.userId });
    await this.kafka.produce(KafkaTopics.Withdrawals, event, id);
    return { approverId, withdrawal, event };
  }

  async reject(id: string, approverId: string) {
    const withdrawal = await this.withdrawals.findOne({ where: { id } });
    if (!withdrawal) return { found: false };
    await this.assertUserCanTransact(withdrawal.userId);
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

  private async assertUserCanTransact(userId: string) {
    if (!this.users) return;
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new HttpException('user not found', HttpStatus.NOT_FOUND);
    if ([UserStatus.Frozen, UserStatus.Closed].includes(user.status)) {
      throw new HttpException('account is not active', HttpStatus.FORBIDDEN);
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
