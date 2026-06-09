// services/withdrawal-service/src/main.ts
import 'reflect-metadata';
import { Body, Controller, Get, HttpException, HttpStatus, Module, Param, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IsIn, IsString } from 'class-validator';
import { randomUUID } from 'crypto';
import { createEvent, EventType, money, TransactionStatus, Withdrawal } from '@nexus/shared';

class WithdrawalDto {
  @IsString()
  userId!: string;

  @IsString()
  asset!: string;

  @IsString()
  network!: string;

  @IsString()
  address!: string;

  @IsString()
  amount!: string;

  @IsString()
  totpCode!: string;
}

class WithdrawalService {
  private withdrawals: Withdrawal[] = [];
  private whitelisted = new Map<string, Set<string>>();

  whitelist(userId: string, address: string) {
    const set = this.whitelisted.get(userId) ?? new Set<string>();
    set.add(address);
    this.whitelisted.set(userId, set);
    return { userId, address, whitelisted: true };
  }

  request(dto: WithdrawalDto) {
    if (!this.whitelisted.get(dto.userId)?.has(dto.address)) {
      throw new HttpException('withdrawal address is not whitelisted', HttpStatus.FORBIDDEN);
    }
    const amount = money(dto.amount);
    const tier = amount.gte(1_000_000) ? 'COLD_CEREMONY' : amount.gte(100_000) ? 'MULTI_PARTY' : amount.gte(10_000) ? 'OPERATOR' : 'AUTO';
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
    return { withdrawal, event: createEvent(EventType.WithdrawalRequested, withdrawal.id, withdrawal, 'withdrawal-service', { userId: dto.userId }) };
  }

  approve(id: string, approverId: string) {
    const withdrawal = this.withdrawals.find((candidate) => candidate.id === id);
    if (!withdrawal) return { found: false };
    withdrawal.status = TransactionStatus.Confirmed;
    return { approverId, withdrawal, event: createEvent(EventType.WithdrawalApproved, id, withdrawal, 'withdrawal-service', { userId: withdrawal.userId }) };
  }

  list(userId?: string) {
    return userId ? this.withdrawals.filter((withdrawal) => withdrawal.userId === userId) : this.withdrawals;
  }
}

@Controller()
class WithdrawalController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'withdrawal-service' };
  }

  @Post('withdrawals/whitelist/:userId')
  whitelist(@Param('userId') userId: string, @Body('address') address: string) {
    return this.withdrawals.whitelist(userId, address);
  }

  @Post('withdrawals')
  request(@Body() dto: WithdrawalDto) {
    return this.withdrawals.request(dto);
  }

  @Post('withdrawals/:id/approve')
  approve(@Param('id') id: string, @Body('approverId') approverId: string) {
    return this.withdrawals.approve(id, approverId);
  }

  @Get('withdrawals')
  list(@Query('userId') userId?: string) {
    return this.withdrawals.list(userId);
  }
}

@Module({ controllers: [WithdrawalController], providers: [WithdrawalService] })
class WithdrawalModule {}

async function bootstrap() {
  const app = await NestFactory.create(WithdrawalModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3008);
}

void bootstrap();
