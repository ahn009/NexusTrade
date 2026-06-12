// services/deposit-service/src/services/deposit.service.ts
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DepositEntity } from '@nexus/database';
import { createHash, randomUUID } from 'crypto';
import { createEvent, Deposit, EventType, KafkaService, KafkaTopics, money, TransactionStatus } from '@nexus/shared';
import { Repository } from 'typeorm';
import { AddressRequestDto, SimulateDepositDto } from '../dto/deposit.dto';

@Injectable()
export class DepositService {
  constructor(
    @InjectRepository(DepositEntity) private readonly deposits: Repository<DepositEntity>,
    private readonly kafka: KafkaService
  ) {}

  generateAddress(dto: AddressRequestDto) {
    const digest = createHash('sha256').update(`${dto.userId}:${dto.asset}:${dto.network}`).digest('hex');
    const prefix = dto.network === 'bitcoin' ? 'bc1' : dto.network === 'solana' ? 'SoL' : '0x';
    return { userId: dto.userId, asset: dto.asset, network: dto.network, address: `${prefix}${digest.slice(0, 40)}` };
  }

  async simulateDeposit(dto: SimulateDepositDto) {
    const duplicate = await this.deposits.findOne({ where: { txHash: dto.txHash } });
    if (duplicate) throw new HttpException('deposit txHash already processed', HttpStatus.CONFLICT);
    const minimum = money(process.env.MIN_DEPOSIT_AMOUNT ?? '0.00000001');
    if (money(dto.amount).lt(minimum)) throw new HttpException('deposit below minimum amount', HttpStatus.BAD_REQUEST);
    const address = this.generateAddress(dto).address;
    const requiredConfirmations = dto.asset === 'BTC' ? 3 : dto.asset === 'SOL' ? 32 : 12;
    const deposit = await this.deposits.save(this.deposits.create({
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
    }));
    const event = createEvent(EventType.DepositDetected, deposit.id, deposit, 'deposit-service', { userId: dto.userId });
    await this.kafka.produce(KafkaTopics.Deposits, event, deposit.id);
    return { deposit, event };
  }

  async confirm(id: string, confirmations: number) {
    const deposit = await this.deposits.findOne({ where: { id } });
    if (!deposit) return { found: false };
    deposit.confirmations = confirmations;
    if (confirmations >= deposit.requiredConfirmations) deposit.status = TransactionStatus.Confirmed;
    await this.deposits.save(deposit);
    const eventType = deposit.status === TransactionStatus.Confirmed ? EventType.DepositConfirmed : EventType.DepositDetected;
    const event = createEvent(eventType, deposit.id, deposit, 'deposit-service', { userId: deposit.userId });
    await this.kafka.produce(KafkaTopics.Deposits, event, deposit.id);
    return { deposit, event };
  }

  list(userId?: string) {
    return this.deposits.find({ where: userId ? { userId } : {}, order: { createdAt: 'DESC' } });
  }
}
