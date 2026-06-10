// services/deposit-service/src/controllers/deposit.controller.ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Public } from '@nexus/shared';
import { AddressRequestDto, SimulateDepositDto } from '../dto/deposit.dto';
import { DepositService } from '../services/deposit.service';

@Controller()
export class DepositController {
  constructor(private readonly deposits: DepositService) {}

  @Public()
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
