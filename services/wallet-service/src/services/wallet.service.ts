// services/wallet-service/src/services/wallet.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { LedgerTransactionEntity, WalletEntity } from '@nexus/database';
import { add, assertNonNegative, Deposit, EventType, KafkaEvent, KafkaService, KafkaTopics, money, subtract, TransactionStatus, TransactionType, WalletType, Withdrawal } from '@nexus/shared';
import { DataSource, EntityManager } from 'typeorm';
import { BalanceLeg, BalanceMutationDto, SettlementDto } from '../dto/wallet.dto';

@Injectable()
export class WalletService implements OnModuleInit {
  private readonly logger = new Logger(WalletService.name);
  private balances = new Map<string, { available: string; locked: string }>();
  private ledger: unknown[] = [];

  constructor(private readonly dataSource: DataSource, private readonly kafka: KafkaService) {}

  async onModuleInit() {
    if (process.env.WALLET_STORE === 'memory') this.logger.warn('wallet memory store requested; TypeORM remains configured by DatabaseModule');
    this.logger.log('wallet persistence enabled with shared DatabaseModule');
    await this.kafka.consume<KafkaEvent<Deposit>>({ topic: KafkaTopics.Deposits, groupId: 'wallet-service' }, async (event) => {
      if (event.eventType === EventType.DepositConfirmed && event.payload.status === TransactionStatus.Confirmed) {
        await this.credit({ userId: event.payload.userId, asset: event.payload.asset, amount: event.payload.amount, referenceId: event.payload.id }, TransactionType.Deposit);
      }
    }).catch((error) => this.logger.warn(`deposit consumer unavailable: ${(error as Error).message}`));
    await this.kafka.consume<KafkaEvent<Withdrawal>>({ topic: KafkaTopics.Withdrawals, groupId: 'wallet-service' }, async (event) => {
      if (event.eventType === EventType.WithdrawalApproved && event.payload.status === TransactionStatus.Confirmed) {
        await this.debit({
          userId: event.payload.userId,
          asset: event.payload.asset,
          amount: money(event.payload.amount).plus(event.payload.fee).toFixed(),
          referenceId: event.payload.id
        }, TransactionType.Withdrawal);
      }
    }).catch((error) => this.logger.warn(`withdrawal consumer unavailable: ${(error as Error).message}`));
  }

  async getBalance(userId: string, asset: string) {
    if (this.dataSource) {
      const wallet = await this.dataSource.getRepository(WalletEntity).findOne({ where: { userId, asset, walletType: WalletType.User } });
      return { userId, asset, available: wallet?.available ?? '0', locked: wallet?.locked ?? '0' };
    }
    return { userId, asset, ...(this.balances.get(`${userId}:${asset}`) ?? { available: '0', locked: '0' }) };
  }

  async listBalances(userId: string) {
    if (this.dataSource) {
      const wallets = await this.dataSource.getRepository(WalletEntity).find({ where: { userId, walletType: WalletType.User }, order: { asset: 'ASC' } });
      return { userId, balances: wallets.map((wallet) => ({ asset: wallet.asset, available: wallet.available, locked: wallet.locked })) };
    }
    const balances = [...this.balances.entries()]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([key, value]) => ({ asset: key.split(':')[1], ...value }));
    return { userId, balances };
  }

  async credit(dto: BalanceMutationDto, type: TransactionType = TransactionType.Deposit) {
    if (this.dataSource) {
      return this.withTransaction(async (manager) => {
        const wallet = await this.adjustAvailable(manager, dto.userId, dto.asset, dto.amount);
        await this.recordTypeOrm(manager, dto, type, wallet.available);
        return { ...dto, type, balanceAfter: wallet.available, createdAt: new Date().toISOString() };
      });
    }
    const key = `${dto.userId}:${dto.asset}`;
    const current = this.balances.get(key) ?? { available: '0', locked: '0' };
    current.available = add(current.available, dto.amount);
    this.balances.set(key, current);
    return this.record(dto, type, current.available);
  }

  async debit(dto: BalanceMutationDto, type: TransactionType = TransactionType.Withdrawal) {
    if (this.dataSource) {
      return this.withTransaction(async (manager) => {
        const wallet = await this.adjustAvailable(manager, dto.userId, dto.asset, money(dto.amount).negated().toFixed());
        await this.recordTypeOrm(manager, { ...dto, amount: money(dto.amount).negated().toFixed() }, type, wallet.available);
        return { ...dto, type, balanceAfter: wallet.available, createdAt: new Date().toISOString() };
      });
    }
    const key = `${dto.userId}:${dto.asset}`;
    const current = this.balances.get(key) ?? { available: '0', locked: '0' };
    const next = subtract(current.available, dto.amount);
    assertNonNegative(next, 'available');
    current.available = next;
    this.balances.set(key, current);
    return this.record({ ...dto, amount: money(dto.amount).negated().toFixed() }, type, current.available);
  }

  async lock(dto: BalanceMutationDto) {
    if (this.dataSource) {
      return this.withTransaction(async (manager) => {
        const wallet = await this.adjustAvailable(manager, dto.userId, dto.asset, money(dto.amount).negated().toFixed());
        wallet.locked = add(wallet.locked, dto.amount);
        await manager.getRepository(WalletEntity).save(wallet);
        await this.recordTypeOrm(manager, dto, TransactionType.TradeSettlement, wallet.available);
        return { ...dto, type: TransactionType.TradeSettlement, balanceAfter: wallet.available, createdAt: new Date().toISOString() };
      });
    }
    const key = `${dto.userId}:${dto.asset}`;
    const current = this.balances.get(key) ?? { available: '0', locked: '0' };
    const nextAvailable = subtract(current.available, dto.amount);
    assertNonNegative(nextAvailable, 'available');
    current.available = nextAvailable;
    current.locked = add(current.locked, dto.amount);
    this.balances.set(key, current);
    return this.record(dto, TransactionType.TradeSettlement, current.available);
  }

  async unlock(dto: BalanceMutationDto) {
    if (this.dataSource) {
      return this.withTransaction(async (manager) => {
        const wallet = await this.adjustLocked(manager, dto.userId, dto.asset, money(dto.amount).negated().toFixed());
        wallet.available = add(wallet.available, dto.amount);
        await manager.getRepository(WalletEntity).save(wallet);
        await this.recordTypeOrm(manager, dto, TransactionType.TradeSettlement, wallet.available);
        return { ...dto, type: TransactionType.TradeSettlement, balanceAfter: wallet.available, createdAt: new Date().toISOString() };
      });
    }
    const key = `${dto.userId}:${dto.asset}`;
    const current = this.balances.get(key) ?? { available: '0', locked: '0' };
    const nextLocked = subtract(current.locked, dto.amount);
    assertNonNegative(nextLocked, 'locked');
    current.locked = nextLocked;
    current.available = add(current.available, dto.amount);
    this.balances.set(key, current);
    return this.record(dto, TransactionType.TradeSettlement, current.available);
  }

  async internalTransfer(from: BalanceMutationDto, toUserId: string) {
    if (this.dataSource) {
      return this.withTransaction(async (manager) => {
        const debitWallet = await this.adjustAvailable(manager, from.userId, from.asset, money(from.amount).negated().toFixed());
        const creditWallet = await this.adjustAvailable(manager, toUserId, from.asset, from.amount);
        await this.recordTypeOrm(manager, from, TransactionType.InternalTransfer, debitWallet.available);
        await this.recordTypeOrm(manager, { ...from, userId: toUserId }, TransactionType.InternalTransfer, creditWallet.available);
        return {
          debit: { ...from, type: TransactionType.InternalTransfer, balanceAfter: debitWallet.available, createdAt: new Date().toISOString() },
          credit: { ...from, userId: toUserId, type: TransactionType.InternalTransfer, balanceAfter: creditWallet.available, createdAt: new Date().toISOString() }
        };
      });
    }
    const key = `${from.userId}:${from.asset}`;
    const current = this.balances.get(key) ?? { available: '0', locked: '0' };
    const nextAvailable = subtract(current.available, from.amount);
    assertNonNegative(nextAvailable, 'available');
    current.available = nextAvailable;
    this.balances.set(key, current);
    const credit = await this.credit({ ...from, userId: toUserId }, TransactionType.InternalTransfer);
    return { debit: this.record(from, TransactionType.InternalTransfer, current.available), credit };
  }

  async settleTrade(dto: SettlementDto) {
    const quoteAmount = money(dto.price).mul(dto.quantity).toFixed();
    const makerFee = dto.makerFee ?? '0';
    const takerFee = dto.takerFee ?? '0';
    const legs: BalanceLeg[] = dto.makerSide === 'SELL'
      ? [
          { userId: dto.makerUserId, asset: dto.baseAsset, amount: money(dto.quantity).negated().toFixed(), bucket: 'locked' },
          { userId: dto.makerUserId, asset: dto.quoteAsset, amount: money(quoteAmount).minus(makerFee).toFixed(), bucket: 'available' },
          { userId: dto.takerUserId, asset: dto.quoteAsset, amount: money(quoteAmount).plus(takerFee).negated().toFixed(), bucket: 'locked' },
          { userId: dto.takerUserId, asset: dto.baseAsset, amount: dto.quantity, bucket: 'available' }
        ]
      : [
          { userId: dto.makerUserId, asset: dto.quoteAsset, amount: money(quoteAmount).plus(makerFee).negated().toFixed(), bucket: 'locked' },
          { userId: dto.makerUserId, asset: dto.baseAsset, amount: dto.quantity, bucket: 'available' },
          { userId: dto.takerUserId, asset: dto.baseAsset, amount: money(dto.quantity).negated().toFixed(), bucket: 'locked' },
          { userId: dto.takerUserId, asset: dto.quoteAsset, amount: money(quoteAmount).minus(takerFee).toFixed(), bucket: 'available' }
        ];

    if (this.dataSource) {
      await this.withTransaction(async (manager) => {
        for (const leg of legs) {
          const wallet = leg.bucket === 'available'
            ? await this.adjustAvailable(manager, leg.userId, leg.asset, leg.amount)
            : await this.adjustLocked(manager, leg.userId, leg.asset, leg.amount);
          await this.recordTypeOrm(manager, { ...leg, referenceId: dto.referenceId }, TransactionType.TradeSettlement, wallet.available);
        }
      });
      return { settled: true, mode: 'typeorm', referenceId: dto.referenceId, quoteAmount, legs };
    }

    for (const leg of legs) {
      const key = `${leg.userId}:${leg.asset}`;
      const current = this.balances.get(key) ?? { available: '0', locked: '0' };
      if (leg.bucket === 'available') {
        const next = add(current.available, leg.amount);
        assertNonNegative(next, `${leg.userId}:${leg.asset}:available`);
        current.available = next;
      } else {
        const next = add(current.locked, leg.amount);
        assertNonNegative(next, `${leg.userId}:${leg.asset}:locked`);
        current.locked = next;
      }
      this.balances.set(key, current);
      this.record({ ...leg, referenceId: dto.referenceId }, TransactionType.TradeSettlement, current.available);
    }
    return { settled: true, mode: 'memory', referenceId: dto.referenceId, quoteAmount, legs };
  }

  private async withTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    if (!this.dataSource) throw new Error('data source is not initialized');
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('SERIALIZABLE');
    try {
      const result = await work(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async findOrCreateWallet(manager: EntityManager, userId: string, asset: string) {
    const repository = manager.getRepository(WalletEntity);
    let wallet = await repository.findOne({
      where: { userId, asset, walletType: WalletType.User },
      lock: { mode: 'pessimistic_write' }
    });
    if (!wallet) {
      wallet = repository.create({ userId, asset, walletType: WalletType.User, available: '0', locked: '0' });
      await repository.save(wallet);
    }
    return wallet;
  }

  private async adjustAvailable(manager: EntityManager, userId: string, asset: string, amount: string) {
    const wallet = await this.findOrCreateWallet(manager, userId, asset);
    const next = add(wallet.available, amount);
    assertNonNegative(next, `${userId}:${asset}:available`);
    wallet.available = next;
    return manager.getRepository(WalletEntity).save(wallet);
  }

  private async adjustLocked(manager: EntityManager, userId: string, asset: string, amount: string) {
    const wallet = await this.findOrCreateWallet(manager, userId, asset);
    const next = add(wallet.locked, amount);
    assertNonNegative(next, `${userId}:${asset}:locked`);
    wallet.locked = next;
    return manager.getRepository(WalletEntity).save(wallet);
  }

  private async recordTypeOrm(manager: EntityManager, dto: BalanceMutationDto, type: TransactionType, balanceAfter: string) {
    const repository = manager.getRepository(LedgerTransactionEntity);
    await repository.save(repository.create({
      userId: dto.userId,
      asset: dto.asset,
      type,
      status: TransactionStatus.Confirmed,
      amount: dto.amount,
      balanceAfter,
      referenceId: dto.referenceId
    }));
  }

  private record(dto: BalanceMutationDto, type: TransactionType, balanceAfter: string) {
    const entry = { ...dto, type, balanceAfter, createdAt: new Date().toISOString() };
    this.ledger.push(entry);
    return entry;
  }
}
