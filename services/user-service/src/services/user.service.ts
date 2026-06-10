// services/user-service/src/services/user.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { KycRecordEntity, ReferralEntity, UserEntity, UserProfileEntity, WithdrawalAddressEntity } from '@nexus/database';
import { AccountTier, createEvent, EventType, KafkaService, KafkaTopics, KycLevel, KycStatus, UserStatus } from '@nexus/shared';
import { Repository } from 'typeorm';
import { AddressBookDto, KycDto, ProfileDto } from '../dto/user.dto';

@Injectable()
export class UserService implements OnModuleInit {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(UserProfileEntity) private readonly profiles: Repository<UserProfileEntity>,
    @InjectRepository(KycRecordEntity) private readonly kyc: Repository<KycRecordEntity>,
    @InjectRepository(ReferralEntity) private readonly referrals: Repository<ReferralEntity>,
    @InjectRepository(WithdrawalAddressEntity) private readonly addresses: Repository<WithdrawalAddressEntity>,
    private readonly kafka: KafkaService
  ) {}

  async onModuleInit() {
    await this.kafka.consume<{ eventType: EventType; payload: { userId: string; email: string; status?: UserStatus } }>({
      topic: KafkaTopics.Users,
      groupId: 'user-service'
    }, async (event) => {
      if (event.eventType !== EventType.UserRegistered) return;
      const existing = await this.users.findOne({ where: { id: event.payload.userId } });
      if (!existing) {
        await this.users.save(this.users.create({
          id: event.payload.userId,
          email: event.payload.email,
          passwordHash: 'external-auth-service',
          status: event.payload.status ?? UserStatus.Active,
          referralCode: event.payload.userId.replace(/-/g, '').slice(0, 12)
        }));
      }
    }).catch((error) => this.logger.warn(`Kafka consumer unavailable: ${(error as Error).message}`));
  }

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

  async addReferral(referrerId: string, referredUserId: string) {
    const existing = await this.referrals.findOne({ where: { referrerId, referredUserId } });
    if (!existing) {
      await this.referrals.save(this.referrals.create({ referrerId, referredUserId }));
    }
    const referredCount = await this.referrals.count({ where: { referrerId } });
    return { referrerId, referredCount };
  }

  async addWithdrawalAddress(userId: string, dto: AddressBookDto) {
    const existing = await this.addresses.findOne({ where: { userId, asset: dto.asset, network: dto.network, address: dto.address } });
    if (!existing) {
      await this.addresses.save(this.addresses.create({ userId, ...dto }));
    }
    const addresses = await this.addresses.find({ where: { userId }, order: { createdAt: 'DESC' } });
    return { userId, addresses };
  }
}
