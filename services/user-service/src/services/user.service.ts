// services/user-service/src/services/user.service.ts
import { Injectable } from '@nestjs/common';
import { AccountTier, createEvent, EventType, KafkaService, KafkaTopics, KycLevel, KycStatus } from '@nexus/shared';
import { AddressBookDto, KycDto, ProfileDto } from '../dto/user.dto';

@Injectable()
export class UserService {
  private profiles = new Map<string, ProfileDto>();
  private kyc = new Map<string, { level: KycLevel; status: KycStatus; provider: string; riskScore: number }>();
  private tiers = new Map<string, AccountTier>();
  private referrals = new Map<string, string[]>();
  private addressBook = new Map<string, AddressBookDto[]>();

  constructor(private readonly kafka: KafkaService) {}

  upsertProfile(userId: string, dto: ProfileDto) {
    this.profiles.set(userId, dto);
    return { userId, ...dto };
  }

  getProfile(userId: string) {
    return { userId, profile: this.profiles.get(userId) ?? null, tier: this.tiers.get(userId) ?? AccountTier.Retail };
  }

  submitKyc(userId: string, dto: KycDto) {
    const riskScore = dto.level === KycLevel.Level3 ? 20 : 35;
    this.kyc.set(userId, { level: dto.level, provider: dto.provider, riskScore, status: KycStatus.Pending });
    return { userId, ...this.kyc.get(userId) };
  }

  async reviewKyc(userId: string, status: KycStatus) {
    const record = this.kyc.get(userId);
    if (!record) return { userId, status: KycStatus.NotStarted };
    record.status = status;
    if (status === KycStatus.Approved) {
      const event = createEvent(EventType.KYCVerified, userId, { userId, ...record }, 'user-service', { userId });
      await this.kafka.produce(KafkaTopics.Users, event, userId).catch(() => undefined);
    }
    return { userId, ...record };
  }

  setTier(userId: string, tier: AccountTier) {
    this.tiers.set(userId, tier);
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
