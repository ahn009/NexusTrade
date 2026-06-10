// services/deposit-service/src/services/deposit.service.ts
import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { createEvent, Deposit, EventType, KafkaService, KafkaTopics, TransactionStatus } from '@nexus/shared';
import { AddressRequestDto, SimulateDepositDto } from '../dto/deposit.dto';

@Injectable()
export class DepositService {
  private deposits: Deposit[] = [];

  constructor(private readonly kafka: KafkaService) {}

  generateAddress(dto: AddressRequestDto) {
    const digest = createHash('sha256').update(`${dto.userId}:${dto.asset}:${dto.network}`).digest('hex');
    const prefix = dto.network === 'bitcoin' ? 'bc1' : dto.network === 'solana' ? 'SoL' : '0x';
    return { userId: dto.userId, asset: dto.asset, network: dto.network, address: `${prefix}${digest.slice(0, 40)}` };
  }

  async simulateDeposit(dto: SimulateDepositDto) {
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
    const event = createEvent(EventType.DepositDetected, deposit.id, deposit, 'deposit-service', { userId: dto.userId });
    await this.kafka.produce(KafkaTopics.Deposits, event, deposit.id).catch(() => undefined);
    return { deposit, event };
  }

  async confirm(id: string, confirmations: number) {
    const deposit = this.deposits.find((candidate) => candidate.id === id);
    if (!deposit) return { found: false };
    deposit.confirmations = confirmations;
    if (confirmations >= deposit.requiredConfirmations) deposit.status = TransactionStatus.Confirmed;
    const event = createEvent(EventType.DepositConfirmed, deposit.id, deposit, 'deposit-service', { userId: deposit.userId });
    await this.kafka.produce(KafkaTopics.Deposits, event, deposit.id).catch(() => undefined);
    return { deposit, event };
  }

  list(userId?: string) {
    return userId ? this.deposits.filter((deposit) => deposit.userId === userId) : this.deposits;
  }
}
