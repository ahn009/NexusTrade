// services/user-service/src/main.ts
import 'reflect-metadata';
import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { AccountTier, KycLevel, KycStatus } from '@nexus/shared';

class ProfileDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsString()
  @Length(2, 2)
  country!: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

class KycDto {
  @IsIn([1, 2, 3])
  level!: KycLevel;

  @IsString()
  provider!: string;
}

class AddressBookDto {
  @IsString()
  asset!: string;

  @IsString()
  network!: string;

  @IsString()
  address!: string;

  @IsString()
  label!: string;
}

class UserService {
  private profiles = new Map<string, ProfileDto>();
  private kyc = new Map<string, { level: KycLevel; status: KycStatus; provider: string; riskScore: number }>();
  private tiers = new Map<string, AccountTier>();
  private referrals = new Map<string, string[]>();
  private addressBook = new Map<string, AddressBookDto[]>();

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

  reviewKyc(userId: string, status: KycStatus) {
    const record = this.kyc.get(userId);
    if (!record) return { userId, status: KycStatus.NotStarted };
    record.status = status;
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

@Controller()
class UserController {
  constructor(private readonly users: UserService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'user-service' };
  }

  @Get('users/:userId/profile')
  getProfile(@Param('userId') userId: string) {
    return this.users.getProfile(userId);
  }

  @Post('users/:userId/profile')
  upsertProfile(@Param('userId') userId: string, @Body() dto: ProfileDto) {
    return this.users.upsertProfile(userId, dto);
  }

  @Post('users/:userId/kyc')
  submitKyc(@Param('userId') userId: string, @Body() dto: KycDto) {
    return this.users.submitKyc(userId, dto);
  }

  @Patch('users/:userId/kyc/:status')
  reviewKyc(@Param('userId') userId: string, @Param('status') status: KycStatus) {
    return this.users.reviewKyc(userId, status);
  }

  @Patch('users/:userId/tier/:tier')
  setTier(@Param('userId') userId: string, @Param('tier') tier: AccountTier) {
    return this.users.setTier(userId, tier);
  }

  @Post('users/:userId/referrals/:referredUserId')
  addReferral(@Param('userId') userId: string, @Param('referredUserId') referredUserId: string) {
    return this.users.addReferral(userId, referredUserId);
  }

  @Post('users/:userId/address-book')
  addWithdrawalAddress(@Param('userId') userId: string, @Body() dto: AddressBookDto) {
    return this.users.addWithdrawalAddress(userId, dto);
  }
}

@Module({ controllers: [UserController], providers: [UserService] })
class UserModule {}

async function bootstrap() {
  const app = await NestFactory.create(UserModule);
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3002);
}

void bootstrap();
