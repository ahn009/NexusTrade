// services/deposit-service/src/main.ts
import 'reflect-metadata';
import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IsIn, IsString } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import { createEvent, Deposit, EventType, TransactionStatus } from '@nexus/shared';

class AddressRequestDto {
  @IsString()
  userId!: string;

  @IsIn(['BTC', 'ETH', 'USDT', 'SOL'])
  asset!: string;

  @IsIn(['bitcoin', 'ethereum', 'erc20', 'solana'])
  network!: string;
}

class SimulateDepositDto extends AddressRequestDto {
  @IsString()
  txHash!: string;

  @IsString()
  amount!: string;
}

class DepositService {
  private deposits: Deposit[] = [];

  generateAddress(dto: AddressRequestDto) {
    const digest = createHash('sha256').update(`${dto.userId}:${dto.asset}:${dto.network}`).digest('hex');
    const prefix = dto.network === 'bitcoin' ? 'bc1' : dto.network === 'solana' ? 'SoL' : '0x';
    return { userId: dto.userId, asset: dto.asset, network: dto.network, address: `${prefix}${digest.slice(0, 40)}` };
  }

  simulateDeposit(dto: SimulateDepositDto) {
    const address = this.generateAddress(dto).address;
    const requiredConfirmations = dto.asset === 'BTC' ? 3 : dto.asset === 'SOL' ? 32 : 12;
    const deposit: Deposit = {
      id: randomUUID(),
      userId: dto.userId,
      asset: dto.asset,
      network: dto.network,
      address,
      txHash: dto.txHash,
      amount: dto.amount,
      confirmations: 0,
      requiredConfirmations,
      status: TransactionStatus.Pending
    };
    this.deposits.push(deposit);
    return { deposit, event: createEvent(EventType.DepositDetected, deposit.id, deposit, 'deposit-service', { userId: dto.userId }) };
  }

  confirm(id: string, confirmations: number) {
    const deposit = this.deposits.find((candidate) => candidate.id === id);
    if (!deposit) return { found: false };
    deposit.confirmations = confirmations;
    if (confirmations >= deposit.requiredConfirmations) deposit.status = TransactionStatus.Confirmed;
    return { deposit, event: createEvent(EventType.DepositConfirmed, deposit.id, deposit, 'deposit-service', { userId: deposit.userId }) };
  }

  list(userId?: string) {
    return userId ? this.deposits.filter((deposit) => deposit.userId === userId) : this.deposits;
  }
}

@Controller()
class DepositController {
  constructor(private readonly deposits: DepositService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'deposit-service' };
  }

  @Post('deposits/address')
  address(@Body() dto: AddressRequestDto) {
    return this.deposits.generateAddress(dto);
  }

  @Post('deposits/simulate')
  simulate(@Body() dto: SimulateDepositDto) {
    return this.deposits.simulateDeposit(dto);
  }

  @Post('deposits/:id/confirm/:confirmations')
  confirm(@Param('id') id: string, @Param('confirmations') confirmations: string) {
    return this.deposits.confirm(id, Number(confirmations));
  }

  @Get('deposits')
  list(@Query('userId') userId?: string) {
    return this.deposits.list(userId);
  }
}

@Module({ controllers: [DepositController], providers: [DepositService] })
class DepositModule {}

async function bootstrap() {
  const app = await NestFactory.create(DepositModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3007);
}

void bootstrap();
