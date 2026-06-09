// services/wallet-service/src/main.ts
import 'reflect-metadata';
import { Body, Controller, Get, Injectable, Logger, Module, OnModuleInit, Param, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IsString } from 'class-validator';
import { add, assertNonNegative, money, subtract, TransactionType } from '@nexus/shared';

const { Pool } = require('pg');

class BalanceMutationDto {
  @IsString()
  userId!: string;

  @IsString()
  asset!: string;

  @IsString()
  amount!: string;

  @IsString()
  referenceId!: string;
}

class SettlementDto {
  @IsString()
  makerUserId!: string;

  @IsString()
  takerUserId!: string;

  @IsString()
  makerSide!: 'BUY' | 'SELL';

  @IsString()
  baseAsset!: string;

  @IsString()
  quoteAsset!: string;

  @IsString()
  price!: string;

  @IsString()
  quantity!: string;

  @IsString()
  referenceId!: string;
}

@Injectable()
class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private balances = new Map<string, { available: string; locked: string }>();
  private ledger: unknown[] = [];
  private pool?: any;

  async onModuleInit() {
    if (process.env.WALLET_STORE === 'memory') return;
    const connectionString = process.env.DATABASE_URL ?? 'postgresql://nexus:nexus@localhost:5432/nexus';
    try {
      this.pool = new Pool({ connectionString });
      await this.pool.query('select 1');
      await this.pool.query(`
        create table if not exists wallet_balances (
          user_id text not null,
          asset text not null,
          available numeric(38,18) not null default 0 check (available >= 0),
          locked numeric(38,18) not null default 0 check (locked >= 0),
          updated_at timestamptz not null default now(),
          primary key (user_id, asset)
        );
        create table if not exists wallet_ledger (
          id bigserial primary key,
          user_id text not null,
          asset text not null,
          type text not null,
          amount numeric(38,18) not null,
          balance_after numeric(38,18) not null,
          reference_id text,
          created_at timestamptz not null default now()
        );
      `);
      this.logger.log('wallet persistence enabled with PostgreSQL');
    } catch (error) {
      this.pool = undefined;
      this.logger.warn(`wallet persistence unavailable, using memory store: ${(error as Error).message}`);
    }
  }

  async getBalance(userId: string, asset: string) {
    if (this.pool) {
      const result = await this.pool.query('select available, locked from wallet_balances where user_id = $1 and asset = $2', [userId, asset]);
      const row = result.rows[0];
      return { userId, asset, available: row?.available ?? '0', locked: row?.locked ?? '0' };
    }
    return { userId, asset, ...(this.balances.get(`${userId}:${asset}`) ?? { available: '0', locked: '0' }) };
  }

  async listBalances(userId: string) {
    if (this.pool) {
      const result = await this.pool.query('select asset, available, locked from wallet_balances where user_id = $1 order by asset', [userId]);
      return { userId, balances: result.rows };
    }
    const balances = [...this.balances.entries()]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([key, value]) => ({ asset: key.split(':')[1], ...value }));
    return { userId, balances };
  }

  async credit(dto: BalanceMutationDto, type: TransactionType = TransactionType.Deposit) {
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('begin');
        await this.ensureBalanceRow(client, dto.userId, dto.asset);
        const row = await this.adjustAvailable(client, dto.userId, dto.asset, dto.amount);
        await this.recordPg(client, dto, type, row.available);
        await client.query('commit');
        return { ...dto, type, balanceAfter: row.available, createdAt: new Date().toISOString() };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }
    const key = `${dto.userId}:${dto.asset}`;
    const current = this.balances.get(key) ?? { available: '0', locked: '0' };
    current.available = add(current.available, dto.amount);
    this.balances.set(key, current);
    return this.record(dto, type, current.available);
  }

  async lock(dto: BalanceMutationDto) {
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('begin');
        await this.ensureBalanceRow(client, dto.userId, dto.asset);
        const row = await this.adjustAvailable(client, dto.userId, dto.asset, money(dto.amount).negated().toFixed());
        await this.adjustLocked(client, dto.userId, dto.asset, dto.amount);
        await this.recordPg(client, dto, TransactionType.TradeSettlement, row.available);
        await client.query('commit');
        return { ...dto, type: TransactionType.TradeSettlement, balanceAfter: row.available, createdAt: new Date().toISOString() };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
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

  async internalTransfer(from: BalanceMutationDto, toUserId: string) {
    const key = `${from.userId}:${from.asset}`;
    const current = this.balances.get(key) ?? { available: '0', locked: '0' };
    const nextAvailable = subtract(current.available, from.amount);
    assertNonNegative(nextAvailable, 'available');
    current.available = nextAvailable;
    this.balances.set(key, current);
    return { debit: this.record(from, TransactionType.InternalTransfer, current.available), credit: this.credit({ ...from, userId: toUserId }, TransactionType.InternalTransfer) };
  }

  async settleTrade(dto: SettlementDto) {
    const quoteAmount = money(dto.price).mul(dto.quantity).toFixed();
    const legs = dto.makerSide === 'SELL'
      ? [
          { userId: dto.makerUserId, asset: dto.baseAsset, amount: money(dto.quantity).negated().toFixed() },
          { userId: dto.makerUserId, asset: dto.quoteAsset, amount: quoteAmount },
          { userId: dto.takerUserId, asset: dto.quoteAsset, amount: money(quoteAmount).negated().toFixed() },
          { userId: dto.takerUserId, asset: dto.baseAsset, amount: dto.quantity }
        ]
      : [
          { userId: dto.makerUserId, asset: dto.quoteAsset, amount: money(quoteAmount).negated().toFixed() },
          { userId: dto.makerUserId, asset: dto.baseAsset, amount: dto.quantity },
          { userId: dto.takerUserId, asset: dto.baseAsset, amount: money(dto.quantity).negated().toFixed() },
          { userId: dto.takerUserId, asset: dto.quoteAsset, amount: quoteAmount }
        ];

    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('begin');
        for (const leg of legs) await this.ensureBalanceRow(client, leg.userId, leg.asset);
        for (const leg of legs) {
          const row = await this.adjustAvailable(client, leg.userId, leg.asset, leg.amount);
          await this.recordPg(client, { ...leg, referenceId: dto.referenceId }, TransactionType.TradeSettlement, row.available);
        }
        await client.query('commit');
        return { settled: true, mode: 'postgres', referenceId: dto.referenceId, quoteAmount, legs };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }

    for (const leg of legs) {
      const key = `${leg.userId}:${leg.asset}`;
      const current = this.balances.get(key) ?? { available: '0', locked: '0' };
      const next = add(current.available, leg.amount);
      assertNonNegative(next, `${leg.userId}:${leg.asset}`);
      current.available = next;
      this.balances.set(key, current);
      this.record({ ...leg, referenceId: dto.referenceId }, TransactionType.TradeSettlement, current.available);
    }
    return { settled: true, mode: 'memory', referenceId: dto.referenceId, quoteAmount, legs };
  }

  private record(dto: BalanceMutationDto, type: TransactionType, balanceAfter: string) {
    const entry = { ...dto, type, balanceAfter, createdAt: new Date().toISOString() };
    this.ledger.push(entry);
    return entry;
  }

  private async ensureBalanceRow(client: any, userId: string, asset: string) {
    await client.query(
      'insert into wallet_balances (user_id, asset, available, locked) values ($1, $2, 0, 0) on conflict (user_id, asset) do nothing',
      [userId, asset]
    );
  }

  private async adjustAvailable(client: any, userId: string, asset: string, amount: string) {
    const result = await client.query(
      `update wallet_balances
       set available = available + $3::numeric, updated_at = now()
       where user_id = $1 and asset = $2 and available + $3::numeric >= 0
       returning available::text, locked::text`,
      [userId, asset, amount]
    );
    if (result.rowCount !== 1) throw new Error(`insufficient ${asset} balance for ${userId}`);
    return result.rows[0];
  }

  private async adjustLocked(client: any, userId: string, asset: string, amount: string) {
    await client.query(
      `update wallet_balances
       set locked = locked + $3::numeric, updated_at = now()
       where user_id = $1 and asset = $2 and locked + $3::numeric >= 0`,
      [userId, asset, amount]
    );
  }

  private async recordPg(client: any, dto: BalanceMutationDto, type: TransactionType, balanceAfter: string) {
    await client.query(
      'insert into wallet_ledger (user_id, asset, type, amount, balance_after, reference_id) values ($1, $2, $3, $4, $5, $6)',
      [dto.userId, dto.asset, type, dto.amount, balanceAfter, dto.referenceId]
    );
  }
}

@Controller()
class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'wallet-service' };
  }

  @Get('wallets/:userId/:asset')
  getBalance(@Param('userId') userId: string, @Param('asset') asset: string) {
    return this.wallet.getBalance(userId, asset);
  }

  @Get('wallets/:userId')
  listBalances(@Param('userId') userId: string) {
    return this.wallet.listBalances(userId);
  }

  @Post('wallets/credit')
  credit(@Body() dto: BalanceMutationDto) {
    return this.wallet.credit(dto);
  }

  @Post('wallets/lock')
  lock(@Body() dto: BalanceMutationDto) {
    return this.wallet.lock(dto);
  }

  @Post('wallets/transfer/:toUserId')
  transfer(@Param('toUserId') toUserId: string, @Body() dto: BalanceMutationDto) {
    return this.wallet.internalTransfer(dto, toUserId);
  }

  @Post('wallets/settle-trade')
  settleTrade(@Body() dto: SettlementDto) {
    return this.wallet.settleTrade(dto);
  }
}

@Module({ controllers: [WalletController], providers: [WalletService] })
class WalletModule {}

async function bootstrap() {
  const app = await NestFactory.create(WalletModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3004);
}

void bootstrap();
