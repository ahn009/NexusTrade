// services/withdrawal-service/src/controllers/withdrawal.controller.ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Public } from '@nexus/shared';
import { WithdrawalDto } from '../dto/withdrawal.dto';
import { WithdrawalService } from '../services/withdrawal.service';

@Controller()
export class WithdrawalController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Public()
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
