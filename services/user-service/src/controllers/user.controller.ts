// services/user-service/src/controllers/user.controller.ts
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AccountTier, KycStatus, Public } from '@nexus/shared';
import { AddressBookDto, KycDto, ProfileDto } from '../dto/user.dto';
import { UserService } from '../services/user.service';

@Controller()
export class UserController {
  constructor(private readonly users: UserService) {}

  @Public()
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
