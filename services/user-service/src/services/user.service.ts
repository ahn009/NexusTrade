// services/user-service/src/services/user.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { KycRecordEntity, UserEntity, UserProfileEntity } from '@nexus/database';
import { AccountTier, createEvent, EventType, KafkaService, KafkaTopics, KycLevel, KycStatus } from '@nexus/shared';
import { Repository } from 'typeorm';
import { AddressBookDto, KycDto, ProfileDto } from '../dto/user.dto';

@Injectable()
export class UserService {
  private referrals = new Map<string, string[]>();
  private addressBook = new Map<string, AddressBookDto[]>();

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(UserProfileEntity) private readonly profiles: Repository<UserProfileEntity>,
    @InjectRepository(KycRecordEntity) private readonly kyc: Repository<KycRecordEntity>,
    private readonly kafka: KafkaService
  ) {}

  async upsertProfile(userId: string, dto: ProfileDto) {
    const existing = await this.profiles.findOne({ where: { userId } });
    const profile = await this.profiles.save(this.profiles.create({ ...existing, userId, ...dto }));
    return { userId, firstName: profile.firstName, lastName: profile.lastName, country: profile.country, phoneNumber: profile.phoneNumber };
  }

  async getProfile(userId: string) {
    const [profile, user] = await Promise.all([
      this.profiles.findOne({ where: { userId } }),
      this.users.findOne({ where: { id: userId } })
    ]);
    return { userId, profile: profile ?? null, tier: user?.accountTier ?? AccountTier.Retail };
  }

  async submitKyc(userId: string, dto: KycDto) {
    const riskScore = dto.level === KycLevel.Level3 ? 20 : 35;
    const record = await this.kyc.save(this.kyc.create({ userId, level: dto.level, provider: dto.provider, riskScore, status: KycStatus.Pending }));
    return { userId, level: record.level, provider: record.provider, riskScore: record.riskScore, status: record.status };
  }

  async reviewKyc(userId: string, status: KycStatus) {
    const record = await this.kyc.findOne({ where: { userId }, order: { createdAt: 'DESC' } });
    if (!record) return { userId, status: KycStatus.NotStarted };
    record.status = status;
    await this.kyc.save(record);
    const payload = { id: record.id, userId: record.userId, level: record.level, status: record.status, provider: record.provider, riskScore: record.riskScore };
    if (status === KycStatus.Approved) {
      const event = createEvent(EventType.KYCVerified, userId, payload, 'user-service', { userId });
      await this.kafka.produce(KafkaTopics.Users, event, userId).catch(() => undefined);
    }
    return payload;
  }

  async setTier(userId: string, tier: AccountTier) {
    await this.users.update({ id: userId }, { accountTier: tier });
    return { userId, tier };
  }

  addReferral(referrerId: string, referredUserId: string) {
    const list = this.referrals.get(referrerId) ?? [];
    list.push(referredUserId);
    this.referrals.set(referrerId, list);
    return { referrerId, referredCount: list.length };
  }

  addWithdrawalAddress(userId: string, dto: AddressBookDto) {
    const entries = this.addressBook.get(userId) ?? [];
    entries.push(dto);
    this.addressBook.set(userId, entries);
    return { userId, addresses: entries };
  }
}
